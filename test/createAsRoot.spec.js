// Two things this covers, both load-bearing:
//
//  1. createFile/createDir must distinguish "created it" from "it was already there". The command opens the
//     local copy only on a real create — if "already exists" ever resolved as success again, an empty local
//     file would be opened over an existing remote one and the next save would wipe it.
//  2. The shape of the `su` script in the create-as-root fallback. It runs as ROOT on a live server, so the
//     existence guard must come BEFORE the redirect, the redirect must be noclobber-protected, and the exit
//     codes must keep "already exists" / "created but chmod failed" / "really failed" apart.

const mockExecAsRoot = jest.fn(() => Promise.resolve({ code: 0, output: '' }));
const mockShowCreated = jest.fn(() => Promise.resolve());
const mockWarning = jest.fn((_msg, _opt, primary) => Promise.resolve(primary)); // always press the first button

jest.mock(
  'vscode',
  () => ({
    window: {
      showWarningMessage: (...args) => mockWarning(...args),
      showErrorMessage: jest.fn(),
      showInformationMessage: jest.fn(),
    },
  }),
  { virtual: true }
);
jest.mock('../src/logger', () => ({ default: { warn() {}, info() {}, error() {}, trace() {} } }));
jest.mock('../src/i18n', () => ({ L: o => (o && o.en) || '' }));
jest.mock('../src/app', () => ({ default: { remoteExplorer: { showCreated: mockShowCreated } } }));
jest.mock('../src/core/fs', () => ({ FileType: { Directory: 1, File: 2, SymbolicLink: 3, Unknown: 4 } }));
jest.mock('../src/modules/permissionFallback', () => ({
  acquirePermissionDialog: () => true,
  releasePermissionDialog: () => undefined,
}));
jest.mock('../src/modules/privilegedExec', () => ({
  canElevate: () => true,
  execAsRoot: (...args) => mockExecAsRoot(...args),
  shQuote: s => `'${s.replace(/'/g, `'\\''`)}'`,
  isAbsoluteRemotePath: p => !!p && p[0] === '/',
  ElevationCancelled: class ElevationCancelled extends Error {},
}));

const { createFile, createDir } = require('../src/core/fileBaseOperations');
const { offerCreateAsRoot, isCreatePermissionDenied } = require('../src/modules/createFallback');

const NOT_FOUND = Object.assign(new Error('no such file'), { code: 2 });

function makeFs({ exists, chmodFails } = {}) {
  return {
    lstat: jest.fn(() => (exists ? Promise.resolve({ type: 2 }) : Promise.reject(NOT_FOUND))),
    put: jest.fn(() => Promise.resolve()),
    mkdir: jest.fn(() => Promise.resolve()),
    chmod: jest.fn(() => (chmodFails ? Promise.reject(new Error('nope')) : Promise.resolve())),
  };
}

function makeCtx(remoteFsPath, config = {}) {
  return {
    target: { remoteFsPath, remoteUri: { path: remoteFsPath } },
    config: Object.assign({ host: '1.2.3.4' }, config),
    fileService: { getRemoteFileSystem: () => Promise.resolve({}) },
  };
}

describe('createFile / createDir — "created" vs "already exists"', () => {
  test('createFile reports true and writes when the path is free', async () => {
    const fs = makeFs({ exists: false });
    await expect(createFile('/srv/new.txt', fs, {})).resolves.toBe(true);
    expect(fs.put).toHaveBeenCalled();
    expect(fs.chmod).toHaveBeenCalledWith('/srv/new.txt', 0o644);
  });

  test('createFile reports FALSE and writes nothing when the path is taken', async () => {
    const fs = makeFs({ exists: true });
    await expect(createFile('/srv/taken.txt', fs, {})).resolves.toBe(false);
    // The whole point: an existing remote file must not be touched, and the caller must be able to tell.
    expect(fs.put).not.toHaveBeenCalled();
    expect(fs.chmod).not.toHaveBeenCalled();
  });

  test('createFile still reports true when only the chmod fails', async () => {
    const fs = makeFs({ exists: false, chmodFails: true });
    await expect(createFile('/srv/new.txt', fs, {})).resolves.toBe(true);
  });

  test('createFile rethrows a non-not-found lstat error instead of creating', async () => {
    const fs = makeFs({ exists: false });
    fs.lstat = jest.fn(() => Promise.reject(Object.assign(new Error('denied'), { code: 3 })));
    await expect(createFile('/etc/x', fs, {})).rejects.toBeDefined();
    expect(fs.put).not.toHaveBeenCalled();
  });

  test('createDir reports true/false the same way', async () => {
    const free = makeFs({ exists: false });
    await expect(createDir('/srv/dir', free, {})).resolves.toBe(true);
    expect(free.mkdir).toHaveBeenCalled();
    expect(free.chmod).toHaveBeenCalledWith('/srv/dir', 0o755);

    const taken = makeFs({ exists: true });
    await expect(createDir('/srv/dir', taken, {})).resolves.toBe(false);
    expect(taken.mkdir).not.toHaveBeenCalled();
  });

  test('an explicit filePerm/dirPerm wins over the default', async () => {
    const f = makeFs({ exists: false });
    await createFile('/srv/f', f, { filePerm: '600' });
    expect(f.chmod).toHaveBeenCalledWith('/srv/f', 0o600);

    const d = makeFs({ exists: false });
    await createDir('/srv/d', d, { dirPerm: 700 });
    expect(d.chmod).toHaveBeenCalledWith('/srv/d', 0o700);
  });
});

describe('offerCreateAsRoot — root script', () => {
  beforeEach(() => {
    mockExecAsRoot.mockClear();
    mockShowCreated.mockClear();
    mockExecAsRoot.mockImplementation(() => Promise.resolve({ code: 0, output: '' }));
  });

  const scriptOf = () => mockExecAsRoot.mock.calls[0][2];

  test('guards the path before creating, and creates with noclobber', async () => {
    await offerCreateAsRoot(makeCtx('/etc/new.conf'), false);
    const script = scriptOf();

    // The existence test must come first — a redirect reaching an existing path would truncate it, and
    // through a symlink it would write outside the folder entirely.
    expect(script.indexOf(`[ -e '/etc/new.conf' ]`)).toBeGreaterThanOrEqual(0);
    expect(script.indexOf(`[ -L '/etc/new.conf' ]`)).toBeGreaterThan(script.indexOf(`[ -e '/etc/new.conf' ]`));
    expect(script.indexOf(`[ -e '/etc/new.conf' ]`)).toBeLessThan(script.indexOf(': >'));
    // noclobber => O_CREAT|O_EXCL, so a path appearing after the test can't be truncated or followed.
    expect(script).toContain(`(set -C; : > '/etc/new.conf')`);
    expect(script).toContain(`chmod 644 -- '/etc/new.conf'`);
    // `exit` must be subshelled or execRoot's trailing exit-code marker never prints.
    expect(script).toContain('(exit 17)');
    expect(script).toContain('(exit 18)');
    expect(script).not.toMatch(/[^(]exit 17/);
  });

  test('a folder uses mkdir and the dir default mode', async () => {
    await offerCreateAsRoot(makeCtx('/etc/newdir'), true);
    const script = scriptOf();
    expect(script).toContain(`mkdir -- '/etc/newdir'`);
    expect(script).toContain(`chmod 755 -- '/etc/newdir'`);
    expect(script).not.toContain(': >');
  });

  test('configured filePerm reaches chmod, including a 4-digit mode', async () => {
    await offerCreateAsRoot(makeCtx('/etc/f', { filePerm: '4755' }), false);
    expect(scriptOf()).toContain(`chmod 4755 -- '/etc/f'`);
  });

  test('quotes a path with a single quote instead of breaking out of the shell string', async () => {
    await offerCreateAsRoot(makeCtx(`/etc/it's`), false);
    expect(scriptOf()).toContain(`'/etc/it'\\''s'`);
  });

  test('exit 0 = created: reveals in the tree and reports success', async () => {
    await expect(offerCreateAsRoot(makeCtx('/etc/ok'), false)).resolves.toBe(true);
    expect(mockShowCreated).toHaveBeenCalled();
  });

  test('exit 17 = already exists: not a create, nothing revealed', async () => {
    mockExecAsRoot.mockImplementation(() => Promise.resolve({ code: 17, output: '' }));
    await expect(offerCreateAsRoot(makeCtx('/etc/there'), false)).resolves.toBe(false);
    expect(mockShowCreated).not.toHaveBeenCalled();
  });

  test('exit 18 = created but chmod failed: still a create', async () => {
    mockExecAsRoot.mockImplementation(() => Promise.resolve({ code: 18, output: '' }));
    // The entry IS on the server, so reporting failure would send the user chasing a file that exists.
    await expect(offerCreateAsRoot(makeCtx('/etc/halfway'), false)).resolves.toBe(true);
    expect(mockShowCreated).toHaveBeenCalled();
  });

  test('any other non-zero exit is a real failure', async () => {
    mockExecAsRoot.mockImplementation(() => Promise.resolve({ code: 2, output: 'mkdir: no such dir' }));
    await expect(offerCreateAsRoot(makeCtx('/etc/a/b'), false)).resolves.toBe(false);
    expect(mockShowCreated).not.toHaveBeenCalled();
  });

  test('a relative server path is refused before anything runs as root', async () => {
    await expect(offerCreateAsRoot(makeCtx('relative/path'), false)).resolves.toBe(false);
    expect(mockExecAsRoot).not.toHaveBeenCalled();
  });

  test('declining the dialog runs nothing', async () => {
    mockWarning.mockImplementationOnce(() => Promise.resolve(undefined));
    await expect(offerCreateAsRoot(makeCtx('/etc/nope'), false)).resolves.toBe(false);
    expect(mockExecAsRoot).not.toHaveBeenCalled();
  });
});

describe('isCreatePermissionDenied', () => {
  test('matches SFTP permission denied and its aliases only', () => {
    expect(isCreatePermissionDenied({ code: 3 })).toBe(true);
    expect(isCreatePermissionDenied({ code: 'EACCES' })).toBe(true);
    expect(isCreatePermissionDenied({ code: 'EPERM' })).toBe(true);
    expect(isCreatePermissionDenied({ code: 2 })).toBe(false); // not found
    expect(isCreatePermissionDenied({ code: 550 })).toBe(false); // FTP — no shell to escalate with
    expect(isCreatePermissionDenied(undefined)).toBe(false);
  });
});
