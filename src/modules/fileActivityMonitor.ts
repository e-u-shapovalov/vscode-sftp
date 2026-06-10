import * as vscode from 'vscode';
import logger from '../logger';
import { realpathSync } from 'fs';
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
} from './serviceManager';
import { reportError, isValidFile, isConfigFile, isInWorkspace } from '../helper';
import { downloadFile, uploadFile, handleCtxFromUri } from '../fileHandlers';

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

  // dispose old service
  findAllFileService(service => service.workspace === workspacePath).forEach(disposeFileService);

  // create new service
  try {
    const configs = await readConfigsFromFile(uri.fsPath);
    configs.forEach(config => createFileService(config, workspacePath));
  } catch (error) {
    reportError(error);
  } finally {
    app.remoteExplorer.refresh();
  }
}

async function handleFileSave(uri: vscode.Uri) {
  const fileService = getFileService(uri);
  if (!fileService) {
    return;
  }

  const config = fileService.getConfig();
  if (config.uploadOnSave) {
    const fspath = await realpathSync.native(uri.fsPath);
    uri = vscode.Uri.file(fspath);
    logger.info(`[file-save] ${fspath}`);
    try {
      await uploadFile(uri);
    } catch (error) {
      logger.error(error, `download ${fspath}`);
      app.sftpBarItem.updateStatus(StatusBarItem.Status.error);
    }
  }
}

async function downloadOnOpen(uri: vscode.Uri) {
  const fileService = getFileService(uri);
  if (!fileService) {
    return;
  }

  const config = fileService.getConfig();
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

function destory() {
  if (workspaceWatcher) {
    workspaceWatcher.dispose();
  }
}

export default {
  init,
  destory,
};
