import * as vscode from 'vscode';
import { L } from '../i18n';

// Human-readable byte size: B / KB / MB / GB, one decimal except for whole bytes.
function human(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

interface ActiveSession {
  report: vscode.Progress<{ increment?: number; message?: string }>;
  token: vscode.CancellationToken;
  totalBytes: number;
  doneBytes: number;
  // Last percentage reported to VS Code (cumulative increment model).
  reportedPct: number;
  fileCount: number;
  lastTick: number;
  // Ref-count so two overlapping commands share one bar and the LAST to finish closes it —
  // otherwise the first finisher nulls `active` while the second is still streaming.
  refs: number;
  // Deferred resolve that closes withProgress when the last participant settles.
  done: () => void;
}

let active: ActiveSession | null = null;

// Drop one participant's reference; the last one out closes the notification.
function release() {
  if (!active) return;
  active.refs -= 1;
  if (active.refs === 0) {
    const done = active.done;
    active = null;
    done();
  }
}

// Push a UI update immediately (bypasses the throttle — used by addFile for instant feedback).
function flush(name: string) {
  if (!active) return;
  const { totalBytes, doneBytes, fileCount } = active;
  if (totalBytes > 0) {
    const pct = Math.min(doneBytes / totalBytes * 100, 100);
    const increment = Math.max(0, pct - active.reportedPct);
    active.reportedPct = pct;
    let msg = `${human(doneBytes)} / ${human(totalBytes)}`;
    if (fileCount > 1) {
      msg += ` · ${fileCount} ${L({ en: 'files', ru: 'файлов' })}`;
    }
    if (name) msg += ` · ${name}`;
    active.report.report({ increment, message: msg });
  } else {
    // Total unknown — show only bytes transferred.
    let msg = human(doneBytes);
    if (fileCount > 1) {
      msg += ` · ${fileCount} ${L({ en: 'files', ru: 'файлов' })}`;
    }
    if (name) msg += ` · ${name}`;
    active.report.report({ message: msg });
  }
  active.lastTick = Date.now();
}

export function isActive(): boolean {
  return active !== null;
}

export function isCancelled(): boolean {
  return active ? active.token.isCancellationRequested : false;
}

// Called by each transfer task as it starts: declares the file size so the bar fills by bytes.
export function addFile(totalBytes: number): void {
  if (!active) return;
  active.fileCount += 1;
  if (totalBytes > 0) {
    active.totalBytes += totalBytes;
  }
  // Force an immediate refresh so the file count appears at once.
  flush('');
}

// Called by the stream 'data' listener in each put() implementation with the chunk size.
export function addBytes(delta: number, name: string): void {
  if (!active) return;
  active.doneBytes += delta;
  // Stop churning the UI once cancellation is requested — the streams are being torn down.
  if (active.token.isCancellationRequested) return;
  // Throttle UI updates to ~10/sec to avoid flooding VS Code's notification system.
  if (Date.now() - active.lastTick < 100) return;
  flush(name);
}

// Open a progress notification and run work() inside it.
// If a session is already active (nested call from a multi-target command), just run work()
// directly so tasks join the existing bar instead of stacking notifications.
export async function withTransferProgress<T>(
  title: string,
  onCancel: () => void,
  work: () => Promise<T>
): Promise<T> {
  if (active) {
    // Already inside a session — join it (share the one bar) and hold a reference so the bar
    // isn't closed until this participant also finishes.
    active.refs += 1;
    try {
      return await work();
    } finally {
      release();
    }
  }

  return new Promise<T>((resolveOuter, rejectOuter) => {
    vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title,
        cancellable: true,
      },
      (progress, token) => {
        // This Promise controls the lifetime of the notification: it stays open until the last
        // participant releases (sessionDone), not merely until this command's own work() settles.
        let sessionDone: () => void;
        const sessionPromise = new Promise<void>(resolve => {
          sessionDone = resolve;
        });

        active = {
          report: progress,
          token,
          totalBytes: 0,
          doneBytes: 0,
          reportedPct: 0,
          fileCount: 0,
          lastTick: 0,
          refs: 1,
          done: sessionDone!,
        };

        token.onCancellationRequested(() => {
          onCancel();
        });

        work().then(
          result => {
            release();
            resolveOuter(result);
          },
          err => {
            release();
            rejectOuter(err);
          }
        );

        return sessionPromise;
      }
    );
  });
}
