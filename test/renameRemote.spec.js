// Renaming/moving used to end with a FULL tree refresh, which re-read every expanded folder and left the
// user hunting for where they had been. The handler must instead hand the explorer the two paths it
// touched — the entry's old and new location — so only those folders are re-listed.
//
// createFileHandler is mocked to a passthrough so `renameRemote` is the raw option object and its `handle`
// can be called directly with a fake context.

const refreshParentsOf = jest.fn(() => Promise.resolve());
const refresh = jest.fn(() => Promise.resolve());
const remoteRename = jest.fn(() => Promise.resolve());

const FileType = { Directory: 1, File: 2, SymbolicLink: 3, Unknown: 4 };

// Minimal stand-ins: a resource is identified by its remote path, which is all the refresh path needs.
const UResource = {
  makeResource: uri => ({ uri, fsPath: uri.path }),
  updateResource: (resource, { remotePath }) => ({
    uri: { scheme: resource.uri.scheme, path: remotePath },
    fsPath: remotePath,
  }),
};

jest.mock('vscode', () => ({}), { virtual: true });
jest.mock('../src/fileHandlers/createFileHandler', () => ({ default: cfg => cfg }));
jest.mock('../src/core', () => ({
  fileOperations: { rename: remoteRename },
  FileType,
  UResource,
}));
jest.mock('../src/helper', () => ({ toRemotePath: p => p }));
jest.mock('../src/host', () => ({ trashLocalPath: jest.fn(() => Promise.resolve()) }));
jest.mock('../src/app', () => ({ default: { remoteExplorer: { refreshParentsOf, refresh } } }));
jest.mock('fs-extra', () => ({
  pathExists: jest.fn(() => Promise.resolve(false)),
  move: jest.fn(() => Promise.resolve()),
  rename: jest.fn(() => Promise.resolve()),
  remove: jest.fn(() => Promise.resolve()),
}));

const { renameRemote } = require('../src/fileHandlers/rename');

// The destination is free: lstat rejects the way SFTP reports "not found".
function makeCtx(remoteFsPath) {
  const notFound = Object.assign(new Error('no such file'), { code: 'ENOENT' });
  const remoteFs = { lstat: () => Promise.reject(notFound), rename: jest.fn() };
  return {
    fileService: { getRemoteFileSystem: () => Promise.resolve(remoteFs), baseDir: '/local' },
    config: { remotePath: '/srv' },
    target: { remoteFsPath, remoteUri: { scheme: 'remote', path: remoteFsPath } },
  };
}

const refreshedPaths = () => refreshParentsOf.mock.calls[0][0].map(u => u.path);

describe('renameRemote — targeted tree refresh', () => {
  beforeEach(() => {
    refreshParentsOf.mockClear();
    refresh.mockClear();
    remoteRename.mockClear();
  });

  test('refreshes both ends of a move, never the whole tree', async () => {
    await renameRemote.handle.call(makeCtx('/srv/a/old.txt'), {
      newRemotePath: '/srv/b/old.txt',
    });

    expect(remoteRename).toHaveBeenCalledWith('/srv/a/old.txt', '/srv/b/old.txt', expect.anything());
    expect(refreshParentsOf).toHaveBeenCalledTimes(1);
    expect(refreshedPaths()).toEqual(['/srv/a/old.txt', '/srv/b/old.txt']);
    expect(refresh).not.toHaveBeenCalled();
  });

  test('a plain rename still names both paths (same folder — the explorer dedupes)', async () => {
    await renameRemote.handle.call(makeCtx('/srv/a/old.txt'), {
      newRemotePath: '/srv/a/new.txt',
    });

    expect(refreshedPaths()).toEqual(['/srv/a/old.txt', '/srv/a/new.txt']);
  });

  test('a local-only rename names just the one path (nothing moved on the server)', async () => {
    // Destination equals the source remote path → doRemote is false, so there is no second folder.
    await renameRemote.handle.call(makeCtx('/srv/a/old.txt'), {
      newRemotePath: '/srv/a/old.txt',
    });

    expect(remoteRename).not.toHaveBeenCalled();
    expect(refreshedPaths()).toEqual(['/srv/a/old.txt']);
  });

  test('skipRefresh leaves the tree alone (the caller refreshes the whole batch)', async () => {
    await renameRemote.handle.call(makeCtx('/srv/a/old.txt'), {
      newRemotePath: '/srv/b/old.txt',
      skipRefresh: true,
    });

    expect(refreshParentsOf).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });
});
