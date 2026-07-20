const {
  alignLocalMtimeIfUnchanged,
  ancestorPaths,
  contextValueFor,
  decideStatus,
  NodeStatus,
} = require('../src/modules/remoteExplorer/treeStatus');
const { FileType } = require('../src/core/fs/fileSystem');

function entry(overrides = {}) {
  return {
    type: FileType.File,
    mode: 0o644,
    size: 10,
    mtime: 10_000,
    atime: 9_000,
    fspath: '/remote/a.txt',
    name: 'a.txt',
    ...overrides,
  };
}

describe('Remote Explorer content status', () => {
  test('uses type and size as definitive cheap differences', () => {
    const remote = entry();
    expect(decideStatus(remote).status).toBe(NodeStatus.RemoteOnly);
    expect(decideStatus(remote, entry({ fspath: 'C:/a.txt', size: 11 })).status).toBe(
      NodeStatus.Modified
    );
    expect(
      decideStatus(
        entry({ type: FileType.Directory }),
        entry({ type: FileType.File, fspath: 'C:/a.txt' })
      ).status
    ).toBe(NodeStatus.Conflict);
  });

  test('equal size and mtime-second is the no-hash fast path', () => {
    const decision = decideStatus(entry({ mtime: 10_100 }), entry({ fspath: 'C:/a.txt', mtime: 10_999 }));
    expect(decision).toEqual({ status: NodeStatus.Synced });
  });

  test('different mtime queues MD5 and only a non-equal verdict becomes M', () => {
    const remote = entry({ mtime: 10_000 });
    const local = entry({ fspath: 'C:/a.txt', mtime: 20_000 });
    const pending = decideStatus(remote, local);
    expect(pending.status).toBe(NodeStatus.Synced);
    expect(pending.verificationKey).toEqual(expect.any(String));

    expect(
      decideStatus(remote, local, { key: pending.verificationKey, verdict: 'equal' }).status
    ).toBe(NodeStatus.Synced);
    expect(
      decideStatus(remote, local, { key: pending.verificationKey, verdict: 'different' }).status
    ).toBe(NodeStatus.Modified);
    expect(
      decideStatus(remote, local, { key: pending.verificationKey, verdict: 'unavailable' }).status
    ).toBe(NodeStatus.Modified);
  });

  test('a verdict is invalidated by fresh metadata', () => {
    const remote = entry({ mtime: 10_000 });
    const local = entry({ fspath: 'C:/a.txt', mtime: 20_000 });
    const old = decideStatus(remote, local);
    const fresh = decideStatus(remote, entry({ fspath: 'C:/a.txt', mtime: 30_000 }), {
      key: old.verificationKey,
      verdict: 'equal',
    });
    expect(fresh.status).toBe(NodeStatus.Synced);
    expect(fresh.verificationKey).not.toBe(old.verificationKey);
  });
});

describe('recursive modified ancestors', () => {
  test('returns every parent through the configured root', () => {
    expect(ancestorPaths('/etc/maddy/lists/forward.list', '/etc')).toEqual([
      '/etc/maddy/lists',
      '/etc/maddy',
      '/etc',
    ]);
    expect(ancestorPaths('/etc/forward.list', '/etc')).toEqual(['/etc']);
  });

  test('never walks above or into an unrelated root', () => {
    expect(ancestorPaths('/var/log/a', '/etc')).toEqual([]);
    expect(ancestorPaths('/etc', '/etc')).toEqual([]);
  });

  test('a root with a trailing slash behaves exactly like the no-slash form (the "/var/www/" config case)', () => {
    const expected = ['/var/www/app.link.kg/mail', '/var/www/app.link.kg', '/var/www'];
    expect(ancestorPaths('/var/www/app.link.kg/mail/configMail.php', '/var/www/')).toEqual(expected);
    expect(ancestorPaths('/var/www/app.link.kg/mail/configMail.php', '/var/www')).toEqual(expected);
  });

  test('the relative default root "./" / "." resolves ancestors instead of collapsing to []', () => {
    expect(ancestorPaths('app/mail/x.php', './')).toEqual(['app/mail', 'app', '.']);
    expect(ancestorPaths('app/mail/x.php', '.')).toEqual(['app/mail', 'app', '.']);
  });

  test('the server root "/" resolves ancestors up to and including "/"', () => {
    expect(ancestorPaths('/a/b/c', '/')).toEqual(['/a/b', '/a', '/']);
  });
});

describe('local mtime alignment', () => {
  function fakeFs(stat) {
    return {
      open: jest.fn().mockResolvedValue(7),
      fstat: jest.fn().mockResolvedValue(stat),
      futimes: jest.fn().mockResolvedValue(undefined),
      close: jest.fn().mockResolvedValue(undefined),
    };
  }

  test('preserves atime and applies the server mtime to an unchanged file', async () => {
    const fs = fakeFs({
      type: FileType.File,
      size: 10,
      mtime: 20_000,
      atime: 12_345,
    });
    const beforeWrite = jest.fn();
    await expect(
      alignLocalMtimeIfUnchanged(fs, 'C:/a.txt', 10, 20_000, 30_000, beforeWrite)
    ).resolves.toBe(true);
    expect(beforeWrite).toHaveBeenCalledTimes(1);
    expect(fs.futimes).toHaveBeenCalledWith(7, 12.345, 30);
    expect(fs.close).toHaveBeenCalledWith(7);
  });

  test('does not touch mtime when the file changed during hashing', async () => {
    const fs = fakeFs({
      type: FileType.File,
      size: 10,
      mtime: 20_001,
      atime: 12_345,
    });
    const beforeWrite = jest.fn();
    await expect(
      alignLocalMtimeIfUnchanged(fs, 'C:/a.txt', 10, 20_000, 30_000, beforeWrite)
    ).resolves.toBe(false);
    expect(beforeWrite).not.toHaveBeenCalled();
    expect(fs.futimes).not.toHaveBeenCalled();
    expect(fs.close).toHaveBeenCalledWith(7);
  });
});

describe('contextValueFor', () => {
  test('suffixes the two new states + LocalOnly so menus can target them', () => {
    expect(contextValueFor(NodeStatus.LocalOnly, false)).toBe('fileLocalOnly');
    expect(contextValueFor(NodeStatus.LocalOnly, true)).toBe('folderLocalOnly');
    expect(contextValueFor(NodeStatus.RemoteOnly, false)).toBe('fileRemoteOnly');
    expect(contextValueFor(NodeStatus.RemoteOnly, true)).toBe('folderRemoteOnly');
    expect(contextValueFor(NodeStatus.Synced, false)).toBe('fileSynced');
    expect(contextValueFor(NodeStatus.Synced, true)).toBe('folderSynced');
  });

  test('Modified and the error states keep the bare file/folder value (existing when-clauses still match)', () => {
    expect(contextValueFor(NodeStatus.Modified, false)).toBe('file');
    expect(contextValueFor(NodeStatus.Modified, true)).toBe('folder');
    expect(contextValueFor(NodeStatus.Denied, false)).toBe('file');
    expect(contextValueFor(NodeStatus.Conflict, false)).toBe('file');
    expect(contextValueFor(NodeStatus.Unknown, true)).toBe('folder');
    expect(contextValueFor(undefined, false)).toBe('file');
    expect(contextValueFor(undefined, true)).toBe('folder');
  });
});
