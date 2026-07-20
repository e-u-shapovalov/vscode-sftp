import * as fse from 'fs-extra';

// A content-equal Remote Explorer file may have only its local mtime aligned to the server. That metadata
// write can surface as one or more FileSystemWatcher change events and must not upload unchanged bytes.
// Keep this tiny state module independent from the watcher/tree modules to avoid a runtime import cycle.
interface MtimeGuard {
  until: number;
  expectedMtime: number;
  applied: boolean;
}

const autoUploadMtimeGuards = new Map<string, MtimeGuard>();
const watcherPathKey = (fsPath: string) =>
  process.platform === 'win32' ? fsPath.toLowerCase() : fsPath;

export function suppressAutoUploadForMtime(
  fsPath: string,
  expectedMtime: number
): { applied(): void; cancel(): void } {
  const key = watcherPathKey(fsPath);
  const guard: MtimeGuard = { until: Date.now() + 2000, expectedMtime, applied: false };
  autoUploadMtimeGuards.set(key, guard);
  setTimeout(() => {
    if (autoUploadMtimeGuards.get(key) === guard) {
      autoUploadMtimeGuards.delete(key);
    }
  }, 2000);
  return {
    applied: () => {
      if (autoUploadMtimeGuards.get(key) === guard) {
        guard.applied = true;
      }
    },
    cancel: () => {
      if (autoUploadMtimeGuards.get(key) === guard) {
        autoUploadMtimeGuards.delete(key);
      }
    },
  };
}

export async function isAutoUploadSuppressed(fsPath: string): Promise<boolean> {
  const key = watcherPathKey(fsPath);
  const guard = autoUploadMtimeGuards.get(key);
  if (!guard) {
    return false;
  }
  if (Date.now() > guard.until) {
    autoUploadMtimeGuards.delete(key);
    return false;
  }
  // During the futimes syscall itself, any event necessarily belongs to that metadata operation. Once it
  // completes, verify the observed path still has exactly the timestamp we wrote: a real user edit gets a
  // different mtime and must flow through to auto-upload even inside the two-second duplicate-event window.
  if (!guard.applied) {
    return true;
  }
  try {
    const stat = await fse.stat(fsPath);
    // A newer alignment may replace the guard while stat is in flight; evaluate that one afresh.
    if (autoUploadMtimeGuards.get(key) !== guard) {
      return isAutoUploadSuppressed(fsPath);
    }
    if (stat.mtime.getTime() === guard.expectedMtime) {
      return true;
    }
  } catch (e) {
    // If the path vanished or can't be inspected, don't hide the watcher event.
  }
  if (autoUploadMtimeGuards.get(key) === guard) {
    autoUploadMtimeGuards.delete(key);
  }
  return false;
}
