// removeRemote lstats the target, then deletes based on stat.type. For a type it can't handle
// (socket, device, fifo → FileType.Unknown) the switch's default branch left `promise` undefined and
// `await undefined` resolved — yet an operation-report row saying "deleted" had already been added and
// afterHandle refreshed as if the file were gone. It must instead refuse the unsupported type before
// claiming anything.
//
// createFileHandler is mocked to a passthrough so `removeRemote` is the raw option object and we can
// call its `handle` directly with a fake context (no app/spinner/vscode wrapper).

let reportActive = true;
const addRow = jest.fn();
const removeFile = jest.fn(() => Promise.resolve());
const removeDir = jest.fn(() => Promise.resolve());

const FileType = { Directory: 1, File: 2, SymbolicLink: 3, Unknown: 4 };

jest.mock(
  'vscode',
  () => ({
    window: { showWarningMessage: jest.fn() },
    workspace: { fs: { delete: jest.fn(() => Promise.resolve()) } },
    Uri: { file: p => ({ fsPath: p }) },
  }),
  { virtual: true }
);
jest.mock('../src/fileHandlers/createFileHandler', () => ({ default: cfg => cfg }));
jest.mock('../src/fileHandlers/shared', () => ({ refreshRemoteExplorer: jest.fn() }));
jest.mock('../src/core', () => ({ fileOperations: { removeDir, removeFile }, FileType }));
jest.mock('../src/logger', () => ({ default: { warn() {}, info() {} } }));
jest.mock('../src/ui/operationReport', () => ({ isActive: () => reportActive, addRow }));
jest.mock('../src/i18n', () => ({ L: o => (o && o.en) || '' }));

const { removeRemote } = require('../src/fileHandlers/remove');

function makeCtx(type) {
  const remoteFs = {
    lstat: () => Promise.resolve({ type, size: 3, mode: 0o644, mtime: 0 }),
  };
  return {
    fileService: { getRemoteFileSystem: () => Promise.resolve(remoteFs) },
    config: {},
    target: { remoteFsPath: '/srv/thing', localFsPath: null },
  };
}

describe('removeRemote — unsupported file type', () => {
  beforeEach(() => {
    reportActive = true;
    addRow.mockClear();
    removeFile.mockClear();
    removeDir.mockClear();
  });

  test('refuses an unsupported type instead of reporting it deleted', async () => {
    await expect(removeRemote.handle.call(makeCtx(FileType.Unknown), { skipRemote: false })).rejects.toBeDefined();

    // The misleading "deleted" report row must NOT have been added, and nothing was removed.
    expect(addRow).not.toHaveBeenCalled();
    expect(removeFile).not.toHaveBeenCalled();
    expect(removeDir).not.toHaveBeenCalled();
  });

  test('still deletes and reports a regular file', async () => {
    await removeRemote.handle.call(makeCtx(FileType.File), { skipRemote: false });

    expect(removeFile).toHaveBeenCalledTimes(1);
    expect(addRow).toHaveBeenCalledTimes(1);
    expect(addRow.mock.calls[0][0].action).toBe('deleted');
  });
});
