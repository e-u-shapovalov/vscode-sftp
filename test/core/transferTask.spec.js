jest.mock('../../src/logger', () => ({
  default: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), trace: jest.fn() },
}));

const TransferTaskModule = require('../../src/core/transferTask');
const TransferTask = TransferTaskModule.default;
const { TransferDirection } = TransferTaskModule;
const { Readable } = require('stream');

// FileType.File === 2 (Directory=1, File=2, SymbolicLink=3, Unknown=4 in src/core/fs/fileSystem.ts).
const FILE = 2;

// Minimal in-memory FileSystem covering only what TransferTask._transferFile touches. `files` is the
// source of truth; `opens` records every path opened for WRITE so a test can assert whether the task
// staged into a temp file or wrote the target directly. A path added to `broken` resolves get() but
// errors the stream when piped — mimicking a source whose lazy createReadStream resolved yet fails on
// the first read (vanished file / lost permission / dropped connection mid-transfer).
function makeMemFs(initial) {
  const files = new Map(Object.entries(initial || {}));
  const opens = [];
  const broken = new Set();
  return {
    files,
    opens,
    broken,
    lstat(p) {
      if (!files.has(p)) {
        return Promise.reject(Object.assign(new Error('not found'), { code: 2 }));
      }
      return Promise.resolve({ type: FILE, mode: 0o644, size: files.get(p).length, mtime: 0, atime: 0 });
    },
    get(p) {
      if (broken.has(p) || !files.has(p)) {
        return Promise.resolve(
          new Readable({
            read() {
              this.destroy(Object.assign(new Error('source unreadable'), { code: 'EIO' }));
            },
          })
        );
      }
      return Promise.resolve(Readable.from([Buffer.from(files.get(p))]));
    },
    open(p, flags) {
      if (flags === 'r') {
        if (!files.has(p)) {
          return Promise.reject(Object.assign(new Error('not found'), { code: 2 }));
        }
        return Promise.resolve({ path: p, flags });
      }
      opens.push(p); // write: truncate/create
      files.set(p, '');
      return Promise.resolve({ path: p, flags });
    },
    close() {
      return Promise.resolve();
    },
    fstat(fd) {
      const c = files.get(fd.path) || '';
      return Promise.resolve({ type: FILE, mode: 0o644, size: c.length, mtime: 0, atime: 0 });
    },
    futimes() {
      return Promise.resolve();
    },
    put(input, p) {
      return new Promise((resolve, reject) => {
        const chunks = [];
        input.on('data', c => chunks.push(Buffer.from(c)));
        input.once('error', reject);
        input.once('end', () => {
          files.set(p, Buffer.concat(chunks).toString());
          resolve();
        });
      });
    },
    rename(src, dst) {
      if (!files.has(src)) {
        return Promise.reject(Object.assign(new Error('no src'), { code: 2 }));
      }
      files.set(dst, files.get(src));
      files.delete(src);
      return Promise.resolve();
    },
    renameAtomic(src, dst) {
      return this.rename(src, dst);
    },
    unlink(p) {
      files.delete(p);
      return Promise.resolve();
    },
  };
}

function runTransfer(srcFs, targetFs, opt) {
  const task = new TransferTask(
    { fsPath: '/src/file.txt', fileSystem: srcFs },
    { fsPath: '/dst/file.txt', fileSystem: targetFs },
    {
      fileType: FILE,
      transferDirection: TransferDirection.LOCAL_TO_REMOTE,
      transferOption: Object.assign({ perserveTargetMode: false, atime: 0, mtime: 0 }, opt),
    }
  );
  return task.run();
}

const stagedTemps = fs => fs.opens.filter(p => p.includes('.wf-'));

describe('TransferTask atomicity', () => {
  test('staging: a successful upload replaces the target and leaves no temp behind', async () => {
    const src = makeMemFs({ '/src/file.txt': 'NEW' });
    const target = makeMemFs({ '/dst/file.txt': 'OLD' });

    await runTransfer(src, target, { useTempFile: true });

    expect(target.files.get('/dst/file.txt')).toBe('NEW');
    expect(stagedTemps(target).length).toBe(1); // it really staged
    expect([...target.files.keys()].some(k => k.includes('.wf-'))).toBe(false); // temp cleaned up
  });

  test('staging: an unreadable source leaves the existing target intact', async () => {
    const src = makeMemFs({ '/src/file.txt': 'whatever' });
    src.broken.add('/src/file.txt');
    const target = makeMemFs({ '/dst/file.txt': 'OLD' });

    await expect(runTransfer(src, target, { useTempFile: true })).rejects.toBeDefined();

    // The core invariant: a failed transfer never truncates the existing target.
    expect(target.files.get('/dst/file.txt')).toBe('OLD');
    expect([...target.files.keys()].some(k => k.includes('.wf-'))).toBe(false); // staging removed
  });

  test('unique temp name: two concurrent uploads to one target never share a staging file', async () => {
    const src = makeMemFs({ '/src/file.txt': 'NEW' });
    const target = makeMemFs({ '/dst/file.txt': 'OLD' });

    await Promise.all([
      runTransfer(src, target, { useTempFile: true }),
      runTransfer(src, target, { useTempFile: true }),
    ]);

    const staged = stagedTemps(target);
    expect(staged.length).toBe(2);
    expect(new Set(staged).size).toBe(2); // distinct names, no shared .new
  });

  test('opt-out: useTempFile=false writes the target directly (no temp)', async () => {
    const src = makeMemFs({ '/src/file.txt': 'NEW' });
    const target = makeMemFs({ '/dst/file.txt': 'OLD' });

    await runTransfer(src, target, { useTempFile: false });

    expect(target.files.get('/dst/file.txt')).toBe('NEW');
    expect(stagedTemps(target).length).toBe(0);
  });
});

describe('TransferTask mtime-permission warning', () => {
  const logger = require('../../src/logger').default;

  function targetThatRejectsFutimes() {
    const t = makeMemFs({ '/dst/file.txt': 'OLD' });
    t.futimes = () => Promise.reject(Object.assign(new Error('EPERM'), { code: 'EPERM' }));
    return t;
  }

  test('warns once per target filesystem, not once per session', async () => {
    logger.warn.mockClear();
    const src = makeMemFs({ '/src/file.txt': 'NEW' });

    // First server: warns once, and a second transfer to the SAME fs stays quiet.
    const serverA = targetThatRejectsFutimes();
    await runTransfer(src, serverA, { useTempFile: true });
    await runTransfer(src, serverA, { useTempFile: true });
    expect(logger.warn).toHaveBeenCalledTimes(1);

    // A different server with the same restriction must surface its own warning (the old
    // module-level flag stayed silent here after the first server ever warned).
    const serverB = targetThatRejectsFutimes();
    await runTransfer(src, serverB, { useTempFile: true });
    expect(logger.warn).toHaveBeenCalledTimes(2);
  });
});
