import * as vscode from 'vscode';
import logger from '../logger';
import app from '../app';
import StatusBarItem from '../ui/statusBarItem';
import { onDidOpenTextDocument, onDidSaveTextDocument, showConfirmMessage } from '../host';
import { readConfigsFromFile } from './config';
import { L } from '../i18n';
import {
  createFileService,
  getFileService,
  findAllFileService,
  disposeFileService,
  refreshConfigContext,
} from './serviceManager';
import { reportError, isValidFile, isConfigFile, isInWorkspace, realpathIfCaseOnly } from '../helper';
import { downloadFile, uploadFile, handleCtxFromUri, allHandleCtxFromUri, FileHandlerContext } from '../fileHandlers';

let workspaceWatcher: vscode.Disposable;

// Files the Remote Explorer's "Edit in Local" just downloaded and is about to open. The
// onDidOpenTextDocument that follows must NOT run downloadOnOpen for them — editInLocal already
// fetched the file on purpose, so prompting again is wrong (and "No" couldn't undo it anyway).
const justEditedInLocal = new Set<string>();
export function suppressDownloadOnOpenOnce(fsPath: string): void {
  justEditedInLocal.add(fsPath);
  // Safety net in case the open event never arrives (file already visible, etc.).
  setTimeout(() => justEditedInLocal.delete(fsPath), 3000);
}

async function handleConfigSave(uri: vscode.Uri) {
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
  if (!workspaceFolder) {
    return;
  }

  const workspacePath = workspaceFolder.uri.fsPath;

  // Read + parse the new config BEFORE tearing anything down. A syntactically broken save used to
  // dispose the working services first and only then fail to parse — leaving the workspace with no
  // connection at all until the file was fixed. Keep the old services intact if the read fails.
  let configs;
  try {
    configs = await readConfigsFromFile(uri.fsPath);
  } catch (error) {
    reportError(error);
    return;
  }

  // Swap: dispose the old services, then build the new ones from the already-parsed config.
  findAllFileService(service => service.workspace === workspacePath).forEach(disposeFileService);
  try {
    configs.forEach(config => createFileService(config, workspacePath));
  } catch (error) {
    reportError(error);
  } finally {
    // A hand-edit can add the first server or remove the last one — keep the toolbar/welcome gate in sync.
    refreshConfigContext();
    // Guard: if the initial setup() threw at activation, app.remoteExplorer is undefined; a later
    // config save must not crash with "Cannot read property 'refresh' of undefined" (every other
    // call site guards this the same way).
    if (app.remoteExplorer) {
      app.remoteExplorer.refresh();
    }
  }
}

async function handleFileSave(uri: vscode.Uri) {
  const fileService = getFileService(uri);
  if (!fileService) {
    return;
  }

  // With profiles, upload on save to every profile whose EFFECTIVE uploadOnSave is true — the
  // profile's own value, or the base value it inherits when it doesn't set one. So a base `true`
  // reaches every profile (a fleet of mirrors), and a profile opts out with `uploadOnSave: false`
  // (or in with `true` when the base is false). No active profile needs to be selected.
  if (fileService.getAvailableProfiles().length > 0) {
    // Normalise the on-disk casing so the upload uses the canonical name (#589) — only a case-only
    // realpath change is adopted; a structural one (symlink / subst) is left as-is (see
    // test/realpath.spec.js and the single-host branch below for the full rationale).
    const fspath = realpathIfCaseOnly(uri.fsPath);
    const fileUri = vscode.Uri.file(fspath);
    let targets: FileHandlerContext[];
    try {
      targets = allHandleCtxFromUri(fileUri).filter(ctx => ctx.config.uploadOnSave === true);
    } catch (error) {
      logger.error(error, `upload-on-save ${fspath}`);
      return;
    }
    if (targets.length === 0) {
      return;
    }
    logger.info(`[file-save] [profiles: ${targets.map(c => c.profile).join(', ')}] ${fspath}`);
    // Upload to each target profile independently so one unreachable host can't stop the rest. Keep
    // the (profile, host) of every failure so the log AND the status bar name WHICH server rejected
    // the save — otherwise a multi-profile fan-out surfaces a bare error and the user has to guess.
    const results = await Promise.all(
      targets.map(ctx =>
        uploadFile(ctx).then(
          () => ({ ctx, error: null as any }),
          (error: any) => ({ ctx, error })
        )
      )
    );
    const failures = results.filter(r => r.error != null);
    if (failures.length) {
      const labelOf = (ctx: FileHandlerContext) =>
        ctx.profile || (ctx.config && ctx.config.host) || '?';
      failures.forEach(({ ctx, error }) => {
        const host = ctx.config && ctx.config.host;
        logger.error(error, `upload → ${labelOf(ctx)}${host ? ` (${host})` : ''} ${fspath}`);
      });
      const total = targets.length;
      const failedNames = failures.map(({ ctx }) => labelOf(ctx)).join(', ');
      const allFailed = failures.length === total;
      // Partial success is a warning, not a hard error: most mirrors got the file, name the ones that
      // didn't. Only an all-profiles failure flips the status bar to the error state.
      app.sftpBarItem.updateStatus(
        allFailed ? StatusBarItem.Status.error : StatusBarItem.Status.warn
      );
      app.sftpBarItem.showMsg(
        allFailed
          ? L({ en: `upload failed: ${failedNames}`, ru: `ошибка загрузки: ${failedNames}` })
          : L({
              en: `uploaded to ${total - failures.length}/${total}, failed: ${failedNames}`,
              ru: `загружено ${total - failures.length}/${total}, не удалось: ${failedNames}`,
            }),
        fspath,
        5000
      );
    }
    return;
  }

  let config;
  try {
    config = fileService.getConfig();
  } catch (error) {
    // getConfig() can throw (invalid config, unknown profile, missing env var). This runs from the
    // save event, so an unhandled rejection here would surface as a noisy error on every save.
    logger.error(error, `upload-on-save getConfig ${uri.fsPath}`);
    return;
  }
  if (config.uploadOnSave) {
    // Normalise the on-disk casing so the upload uses the canonical name (#589), but ONLY when realpath
    // differs by case alone. A structural realpath change — a resolved symlink (Linux/macOS) or an
    // expanded subst/mapped drive (Windows) — is rejected: the service is registered under the path the
    // workspace was opened with, so adopting a different real path makes the trie lookup miss and
    // resurfaces as "Config Not Found" on save (#339, #397, #521). See test/realpath.spec.js.
    const fspath = realpathIfCaseOnly(uri.fsPath);
    uri = vscode.Uri.file(fspath);
    logger.info(`[file-save] ${fspath}`);
    try {
      await uploadFile(uri);
    } catch (error) {
      logger.error(error, `upload ${fspath}`);
      app.sftpBarItem.updateStatus(StatusBarItem.Status.error);
    }
  }
}

async function downloadOnOpen(uri: vscode.Uri) {
  const fileService = getFileService(uri);
  if (!fileService) {
    return;
  }

  let config;
  try {
    config = fileService.getConfig();
  } catch (error) {
    // getConfig() can throw (invalid config, unknown profile, missing env var). This runs from the
    // open event, so swallow + log rather than leak an unhandled rejection on every file open.
    logger.error(error, `downloadOnOpen getConfig ${uri.fsPath}`);
    return;
  }
  if (!config.downloadOnOpen) {
    return;
  }

  // Opened via the Remote Explorer's "Edit in Local", which already downloaded it on purpose —
  // don't prompt or re-download here (this is what made "No" still leave a downloaded file).
  if (justEditedInLocal.has(uri.fsPath)) {
    justEditedInLocal.delete(uri.fsPath);
    return;
  }

  // The config file itself (.vscode/wireferry.json | sftp.json) does not live on the server — opening
  // it must never trigger a download.
  if (isConfigFile(uri)) {
    return;
  }

  // Only act when the file actually EXISTS on the server. Without this, opening a local-only file
  // (e.g. a freshly created config, or any file you haven't uploaded) prompted and then failed with
  // "No such file" — and asking before knowing whether there is anything to download is what made it
  // "ask for everything". The lstat runs BEFORE the confirm so "No" can't arrive after a download.
  try {
    const ctx = handleCtxFromUri(uri);
    const remoteFs = await fileService.getRemoteFileSystem(config);
    await remoteFs.lstat(ctx.target.remoteFsPath);
  } catch (e) {
    return; // not on the server (or unreachable) — nothing to download, stay silent
  }

  if (config.downloadOnOpen === 'confirm') {
    const isConfirm = await showConfirmMessage(
      L({
        en: 'Download the server copy of this file (overwrites your local copy)?',
        ru: 'Скачать серверную версию этого файла (перезапишет локальную копию)?',
      })
    );
    if (!isConfirm) {
      return;
    }
  }

  const fspath = uri.fsPath;
  logger.info(`[file-open] ${fspath}`);
  try {
    await downloadFile(uri);
  } catch (error) {
    logger.error(error, `download ${fspath}`);
    app.sftpBarItem.updateStatus(StatusBarItem.Status.error);
  }
}

function watchWorkspace({
  onDidSaveFile,
  onDidSaveSftpConfig,
}: {
  onDidSaveFile: (uri: vscode.Uri) => void;
  onDidSaveSftpConfig: (uri: vscode.Uri) => void;
}) {
  if (workspaceWatcher) {
    workspaceWatcher.dispose();
  }

  workspaceWatcher = onDidSaveTextDocument((doc: vscode.TextDocument) => {
    const uri = doc.uri;
    if (!isValidFile(uri) || !isInWorkspace(uri.fsPath)) {
      return;
    }

    // remove staled cache
    if (app.fsCache.has(uri.fsPath)) {
      app.fsCache.del(uri.fsPath);
    }

    if (isConfigFile(uri)) {
      onDidSaveSftpConfig(uri);
      return;
    }

    onDidSaveFile(uri);
  });
}

function init() {
  onDidOpenTextDocument((doc: vscode.TextDocument) => {
    if (!isValidFile(doc.uri) || !isInWorkspace(doc.uri.fsPath)) {
      return;
    }

    downloadOnOpen(doc.uri);
  });

  watchWorkspace({
    onDidSaveFile: handleFileSave,
    onDidSaveSftpConfig: handleConfigSave,
  });
}

function destroy() {
  if (workspaceWatcher) {
    workspaceWatcher.dispose();
  }
}

export default {
  init,
  destroy,
};
