'use strict';
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import app from './app';
import initCommands from './initCommands';
import { reportError } from './helper';
import fileActivityMonitor from './modules/fileActivityMonitor';
import { tryLoadConfigs } from './modules/config';
import {
  getAllFileService,
  getFileService,
  createFileService,
  disposeFileService,
} from './modules/serviceManager';
import { getWorkspaceFolders, setContextValue, showConfirmMessage } from './host';
import { removeRemote } from './fileHandlers';
import RemoteExplorer from './modules/remoteExplorer';

// workspace.onDidDeleteFiles exists at runtime (VS Code >= 1.56; we require ^1.64.2), but the
// pinned @types/vscode (1.40) predates it, so we reference it through a typed handle.
type FileDeleteEvent = { readonly files: ReadonlyArray<vscode.Uri> };
type OnDidDeleteFiles = (listener: (e: FileDeleteEvent) => any) => vscode.Disposable;
const onDidDeleteFiles: OnDidDeleteFiles | undefined = (vscode.workspace as any).onDidDeleteFiles;

async function setupWorkspaceFolder(dir) {
  const configs = await tryLoadConfigs(dir);
  configs.forEach(config => {
    createFileService(config, dir);
  });
}

function setup(workspaceFolders: vscode.WorkspaceFolder[]) {
  fileActivityMonitor.init();
  const pendingInits = workspaceFolders.map(folder => setupWorkspaceFolder(folder.uri.fsPath));

  return Promise.all(pendingInits);
}

// Sync deletions made through VS Code to the server.
// Uses workspace.onDidDeleteFiles (not a FileSystemWatcher), so it fires ONLY for deletions
// done inside VS Code (Explorer / workspace.fs) and never for external file-system changes.
// The local file is already gone by the time this fires, so we only ask about the server.
function registerDeleteSync(context: vscode.ExtensionContext) {
  if (!onDidDeleteFiles) {
    return;
  }

  context.subscriptions.push(
    onDidDeleteFiles(async event => {
      const targets = event.files.filter(uri => Boolean(getFileService(uri)));
      if (!targets.length) {
        return;
      }

      const confirmed = await showConfirmMessage(
        `Deleted locally. Delete on the server too? (${targets.length} file(s))`,
        'Delete on server',
        'Keep on server'
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

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {
  try {
    initCommands(context);
  } catch (error) {
    reportError(error, 'initCommands');
  }

  const workspaceFolders = getWorkspaceFolders();
  if (!workspaceFolders) {
    return;
  }

  setContextValue('enabled', true);
  registerDeleteSync(context);
  app.sftpBarItem.show();
  app.state.subscribe(_ => {
    const currentText = app.sftpBarItem.getText();
    // current is showing profile
    if (currentText.startsWith('SFTP')) {
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
}

export function deactivate() {
  fileActivityMonitor.destory();
  getAllFileService().forEach(disposeFileService);
}
