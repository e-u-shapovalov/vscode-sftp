jest.mock('fs-extra', () => ({ stat: jest.fn() }));

const fse = require('fs-extra');
const {
  isAutoUploadSuppressed,
  suppressAutoUploadForMtime,
} = require('../src/modules/fileWatcherSuppression');

describe('mtime-only watcher suppression', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-20T00:00:00Z'));
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  test('covers repeated metadata events briefly and then expires', async () => {
    const guard = suppressAutoUploadForMtime('C:/workspace/a.txt', 30_000);
    await expect(isAutoUploadSuppressed('C:/workspace/a.txt')).resolves.toBe(true);
    expect(fse.stat).not.toHaveBeenCalled();
    guard.applied();
    fse.stat.mockResolvedValue({ mtime: new Date(30_000) });
    await expect(isAutoUploadSuppressed('C:/workspace/a.txt')).resolves.toBe(true);
    jest.advanceTimersByTime(2001);
    await expect(isAutoUploadSuppressed('C:/workspace/a.txt')).resolves.toBe(false);
  });

  test('does not suppress a real edit with a different observed mtime', async () => {
    const guard = suppressAutoUploadForMtime('C:/workspace/b.txt', 30_000);
    guard.applied();
    fse.stat.mockResolvedValue({ mtime: new Date(31_000) });
    await expect(isAutoUploadSuppressed('C:/workspace/b.txt')).resolves.toBe(false);
  });

  test('can be cancelled when mtime was not changed', async () => {
    const guard = suppressAutoUploadForMtime('C:/workspace/c.txt', 30_000);
    guard.cancel();
    await expect(isAutoUploadSuppressed('C:/workspace/c.txt')).resolves.toBe(false);
  });
});
