'use strict';
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as path from 'path';
import * as vscode from 'vscode';
import app from './app';
import initCommands from './initCommands';
import { reportError } from './helper';
import logger from './logger';
import fileActivityMonitor from './modules/fileActivityMonitor';
import { tryLoadConfigs } from './modules/config';
import {
  getAllFileService,
  getFileService,
  createFileService,
  disposeFileService,
} from './modules/serviceManager';
import { getWorkspaceFolders, setContextValue, showConfirmMessage } from './host';
import { EXTENSION_DISPLAY_NAME } from './constants';
import { L } from './i18n';
import { removeRemote, renameRemote } from './fileHandlers';
import RemoteExplorer from './modules/remoteExplorer';
import { runLegacyDoctor } from './modules/legacyDoctor';
import { runUpdateCheck } from './modules/updateCheck';
import { REPORT_SCHEME, reportProvider } from './ui/operationReport';

async function setupWorkspaceFolder(dir) {
  const configs = await tryLoadConfigs(dir);
  configs.forEach(config => {
    createFileService(config, dir);
  });
}

function setup(workspaceFolders: readonly vscode.WorkspaceFolder[]) {
  fileActivityMonitor.init();
  const pendingInits = workspaceFolders.map(folder => setupWorkspaceFolder(folder.uri.fsPath));

  return Promise.all(pendingInits);
}

// Sync deletions made through VS Code to the server.
// Uses workspace.onDidDeleteFiles (not a FileSystemWatcher), so it fires ONLY for deletions
// done inside VS Code (Explorer / workspace.fs) and never for external file-system changes.
// The local file is already gone by the time this fires, so we only ask about the server.
function registerDeleteSync(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.workspace.onDidDeleteFiles(async event => {
      const targets = event.files.filter(uri => Boolean(getFileService(uri)));
      if (!targets.length) {
        return;
      }

      const confirmed = await showConfirmMessage(
        L({
          en: `Deleted locally. Delete on the server too? (${targets.length} file(s))`,
          ru: `Удалено локально. Удалить и на сервере? (файлов: ${targets.length})`,
        }),
        L({ en: 'Delete on server', ru: 'Удалить на сервере' }),
        L({ en: 'Keep on server', ru: 'Оставить на сервере' })
      );
      if (!confirmed) {
        return;
      }

      await Promise.all(
        targets.map(async uri => {
          try {
            await removeRemote(uri);
          } catch (error) {
            reportError(error, 'onDidDeleteFiles');
          }
        })
      );
    })
  );
}

// Sync renames/moves made through VS Code to the server.
// Uses workspace.onDidRenameFiles, so it fires ONLY for renames/moves done inside VS Code
// (Explorer rename / drag&drop between folders / workspace.fs) and never for external changes.
// A move is just a rename into another directory, so this one handler covers both renaming and
// dragging a local file to a different folder. The local file is already moved by the time this
// fires, so we only ask about the server and never touch the local copy (no localRename).
function registerRenameSync(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.workspace.onDidRenameFiles(async event => {
      // Only sync when BOTH ends belong to the same service: a plain rename/move within one SFTP
      // project. Moving in from outside (no service on oldUri), out of the project, or between
      // profiles is not a remote rename — handleCtxFromUri(oldUri) would throw and the destination
      // could resolve to a path with `..` outside the remote root.
      const targets = event.files.filter(f => {
        const oldService = getFileService(f.oldUri);
        const newService = getFileService(f.newUri);
        return oldService && newService && oldService === newService;
      });
      if (!targets.length) {
        return;
      }

      // Distinguish a rename (same folder) from a move (different folder) for the dialog text.
      const isMove = targets.some(
        f => path.dirname(f.oldUri.fsPath) !== path.dirname(f.newUri.fsPath)
      );
      const confirmed = await showConfirmMessage(
        L({
          en: `${isMove ? 'Moved/renamed' : 'Renamed'} locally. Apply on the server too? (${targets.length} item(s))`,
          ru: `${isMove ? 'Перемещено/переименовано' : 'Переименовано'} локально. Применить на сервере? (элементов: ${targets.length})`,
        }),
        L({ en: 'Apply on server', ru: 'Применить на сервере' }),
        L({ en: 'Keep server as is', ru: 'Оставить сервер как есть' })
      );
      if (!confirmed) {
        return;
      }

      await Promise.all(
        targets.map(async ({ oldUri, newUri }) => {
          try {
            await renameRemote(oldUri, { newLocalPath: newUri.fsPath, skipRefresh: true });
          } catch (error) {
            // A local-only item that was never uploaded has nothing to rename on the server —
            // stay quiet instead of showing a scary error for something the user didn't ask to sync.
            if (error && (error.code === 'ENOENT' || /no such file/i.test(String(error.message)))) {
              logger.warn(`Skip server rename (not on server): ${oldUri.fsPath}`);
            } else {
              reportError(error, 'onDidRenameFiles');
            }
          }
        })
      );

      if (app.remoteExplorer) {
        app.remoteExplorer.refresh();
      }
    })
  );
}

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {
  try {
    initCommands(context);
  } catch (error) {
    reportError(error, 'initCommands');
  }

  // Virtual document provider for operation reports (upload.log / download.log / delete.log).
  // Registered once at activation so every command that opens a report tab can share one provider.
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(REPORT_SCHEME, reportProvider)
  );

  // Opt-in GitHub update check — independent of workspace/config; runs in the background.
  runUpdateCheck().catch(error => reportError(error, 'updateCheck'));

  const workspaceFolders = getWorkspaceFolders();
  if (!workspaceFolders) {
    return;
  }

  setContextValue('enabled', true);
  registerDeleteSync(context);
  registerRenameSync(context);
  app.sftpBarItem.show();
  app.state.subscribe(_ => {
    const currentText = app.sftpBarItem.getText();
    // current is showing profile
    if (currentText.startsWith(EXTENSION_DISPLAY_NAME)) {
      app.sftpBarItem.reset();
    }
    if (app.remoteExplorer) {
      app.remoteExplorer.refresh();
    }
  });
  try {
    await setup(workspaceFolders);
    app.remoteExplorer = new RemoteExplorer(context);
  } catch (error) {
    reportError(error);
  }

  // Legacy-config doctor: auto-template for an empty workspace, sftp.json -> wireferry.json rename
  // offer, and legacy/unsupported key diagnostics. Background — must never block activation.
  runLegacyDoctor(context).catch(error => reportError(error, 'legacyDoctor'));
}

export function deactivate() {
  fileActivityMonitor.destroy();
  getAllFileService().forEach(disposeFileService);
}
