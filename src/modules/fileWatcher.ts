import * as vscode from 'vscode';
import * as debounce from 'lodash.debounce';
import logger from '../logger';
import { isValidFile, fileDepth } from '../helper';
import { upload } from '../fileHandlers';
import { WatcherService, TransferDirection } from '../core';
import app from '../app';
import StatusBarItem from '../ui/statusBarItem';
import { getRunningTransformTasks } from './serviceManager';
import { isAutoUploadSuppressed, watcherPathKey } from './fileWatcherSuppression';

const watchers: {
  [x: string]: vscode.FileSystemWatcher;
} = {};

// Keyed by normalised path, not by the Uri itself: the watcher hands out a NEW Uri instance for
// every event, so a Set never collapsed repeat events for one file — a single Ctrl+S could leave two
// entries, and with a parallel batch that means two simultaneous puts to the same remote path.
const uploadQueue = new Map<string, vscode.Uri>();

// How many files of a batch move at once. The byte transfer itself is already capped by the
// service-wide scheduler, but each file's preamble — lstat, ensureDir, save-before-upload — runs
// outside it, so the fan-out is bounded here too. Matches the default `concurrency`.
const BATCH_PARALLELISM = 4;

// less than 550 will not work
const ACTION_INTEVAL = 550;

async function doUpload() {
  const files = Array.from(uploadQueue.values()).sort(
    (a, b) => fileDepth(b.fsPath) - fileDepth(a.fsPath)
  );
  uploadQueue.clear();

  // Several workers pulling from one cursor — NOT `forEach(async …)`, which spawned floating promises
  // so doUpload resolved before anything had finished and callers couldn't tell when a batch ended.
  // Here the returned promise still settles only after the last file does, a single file's failure is
  // still caught without aborting the rest, and the number of files in flight is bounded. Batches
  // don't overlap because of the synchronous queue clear above, not because of the awaiting: debounce
  // never waited on the returned promise, so a batch longer than the interval overlapped the next one
  // under the old sequential loop just the same.
  let cursor = 0;
  const worker = async () => {
    while (cursor < files.length) {
      const uri = files[cursor++];
      const key = watcherPathKey(uri.fsPath);

      // Re-read the active downloads FOR EACH file: a snapshot taken once went stale in both
      // directions by the end of a batch — it missed a download that started meanwhile (so we
      // uploaded over a file being written) and still listed one that had finished (so we silently
      // skipped the user's edit).
      const isDownloading = getRunningTransformTasks().some(
        task =>
          task.transferType === TransferDirection.REMOTE_TO_LOCAL &&
          watcherPathKey(task.localFsPath) === key
      );
      if (isDownloading) {
        continue;
      }

      const fspath = uri.fsPath;
      logger.info(`[watcher/updated] ${fspath}`);
      try {
        await upload(uri);
      } catch (error) {
        logger.error(error, `upload ${fspath}`);
        app.sftpBarItem.updateStatus(StatusBarItem.Status.error);
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(BATCH_PARALLELISM, files.length) }, worker));
}

const debouncedUpload = debounce(doUpload, ACTION_INTEVAL, { leading: true, trailing: true });

async function uploadHandler(uri: vscode.Uri) {
  if (!isValidFile(uri)) {
    return;
  }

  if (await isAutoUploadSuppressed(uri.fsPath)) {
    return;
  }

  uploadQueue.set(watcherPathKey(uri.fsPath), uri);
  debouncedUpload();
}

function addWatcher(id, watcher) {
  watchers[id] = watcher;
}

function getWatcher(id) {
  return watchers[id];
}

function createWatcher(
  watcherBase: string,
  watcherConfig: { files: false | string; autoUpload: boolean }
) {
  let watcher = getWatcher(watcherBase);
  if (watcher) {
    // clear old watcher
    watcher.dispose();
  }

  if (!watcherConfig) {
    return;
  }

  // tslint:disable-next-line triple-equals
  if (watcherConfig.files == false || !watcherConfig.autoUpload) {
    return;
  }

  watcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(watcherBase, watcherConfig.files),
    false,
    false,
    false
  );
  addWatcher(watcherBase, watcher);

  // Only auto-upload on create/change. Deletions are intentionally NOT mirrored here;
  // a FileSystemWatcher fires for every change (including external ones), which makes
  // silent server-side deletions surprising. Deletion sync is handled explicitly via
  // workspace.onDidDeleteFiles in extension.ts (VS Code-initiated deletes only).
  watcher.onDidCreate(uploadHandler);
  watcher.onDidChange(uploadHandler);
}

function removeWatcher(watcherBase: string) {
  const watcher = getWatcher(watcherBase);
  if (watcher) {
    watcher.dispose();
    delete watchers[watcherBase];
  }
}

const watcherService: WatcherService = {
  create: createWatcher,
  dispose: removeWatcher,
};

export default watcherService;
