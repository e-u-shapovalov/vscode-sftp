import * as vscode from 'vscode';
import * as path from 'path';
import { upath } from '../../core';
import { renameRemote, handleCtxFromUri } from '../../fileHandlers';
import { showConfirmMessage, showWarningMessage } from '../../host';
import { reportError } from '../../helper';
import { L } from '../../i18n';
import app from '../../app';
import RemoteTreeData, { ExplorerItem, ExplorerRoot } from './treeDataProvider';

// VS Code's built-in tree drag&drop transfers nodes through the mime type
// `application/vnd.code.tree.<viewId>` where <viewId> is lower-cased. The view here is
// registered as `remoteExplorer`, so the mime is the lower-cased form below.
const MIME = 'application/vnd.code.tree.remoteexplorer';

// Drag&drop inside the Remote Explorer tree. Dropping a file/folder onto a folder (or onto a file,
// whose parent folder is then used) moves it there both on the server and — when a local copy
// exists — locally, after a single confirmation. Same-folder drops and moving a folder into
// itself/a descendant are filtered out.
export default class RemoteDragAndDropController
  implements vscode.TreeDragAndDropController<ExplorerItem> {
  readonly dropMimeTypes = [MIME];
  readonly dragMimeTypes = [MIME];

  constructor(private readonly treeDataProvider: RemoteTreeData) {}

  handleDrag(source: readonly ExplorerItem[], dataTransfer: vscode.DataTransfer): void {
    dataTransfer.set(MIME, new vscode.DataTransferItem(source));
  }

  async handleDrop(
    target: ExplorerItem | undefined,
    dataTransfer: vscode.DataTransfer
  ): Promise<void> {
    const transferItem = dataTransfer.get(MIME);
    if (!transferItem) {
      return;
    }
    const sources: ExplorerItem[] = transferItem.value;
    if (!sources || !sources.length || !target) {
      return;
    }

    // All dragged items and the drop target must belong to the SAME remote (profile/root). A
    // cross-root move would run on the source's FS with a destination path from another root —
    // ENOENT at best, a wrong-server write at worst.
    const targetRemoteId = target.resource.remoteId;
    if (sources.some(s => s.resource.remoteId !== targetRemoteId)) {
      showWarningMessage(
        L({
          en: 'WireFerry: you can only move items within the same remote.',
          ru: 'WireFerry: перемещать элементы можно только в пределах одного сервера.',
        })
      );
      return;
    }

    // Destination folder: drop onto a folder → into it; drop onto a file → into its parent folder.
    let destFolder: ExplorerItem | undefined;
    if (target.isDirectory) {
      destFolder = target;
    } else {
      try {
        destFolder = await this.treeDataProvider.getParent(target);
      } catch (error) {
        reportError(error, 'remoteExplorer drag&drop');
        return;
      }
    }
    if (!destFolder) {
      return;
    }

    const destRemoteDir = destFolder.resource.fsPath;
    let destLocalDir: string;
    try {
      destLocalDir = handleCtxFromUri(destFolder.resource.uri).target.localFsPath;
    } catch (error) {
      reportError(error, 'remoteExplorer drag&drop');
      return;
    }

    // Drop moves that are no-ops or invalid: source already in the destination folder, or moving a
    // folder into itself / one of its descendants. Remote paths are POSIX, so compare with upath.
    const moves = sources.filter(src => {
      if ((src as ExplorerRoot).explorerContext) {
        return false; // a root node can't be moved
      }
      const srcRemote = src.resource.fsPath;
      if (srcRemote === '/' || srcRemote === destRemoteDir) {
        return false;
      }
      if (upath.dirname(srcRemote) === destRemoteDir) {
        return false; // already in this folder
      }
      // moving a folder into itself or one of its descendants — compare normalized, slash-terminated
      // paths so '/a/b' is not treated as a prefix of '/a/bc'.
      const srcPrefix = upath.normalize(srcRemote).replace(/\/+$/, '') + '/';
      const destPrefix = upath.normalize(destRemoteDir).replace(/\/+$/, '') + '/';
      if (destPrefix === srcPrefix || destPrefix.startsWith(srcPrefix)) {
        return false;
      }
      return true;
    });
    if (!moves.length) {
      return;
    }

    const names = moves.map(m => upath.basename(m.resource.fsPath)).join(', ');
    const destName = upath.basename(destRemoteDir) || '/';
    const confirmed = await showConfirmMessage(
      L({
        en: `Move ${moves.length} item(s) into '${destName}' on the server (and locally)? [${names}]`,
        ru: `Переместить элементов (${moves.length}) в «${destName}» на сервере (и локально)? [${names}]`,
      }),
      L({ en: 'Move', ru: 'Переместить' }),
      L({ en: 'Cancel', ru: 'Отмена' })
    );
    if (!confirmed) {
      return;
    }

    await Promise.all(
      moves.map(async src => {
        try {
          const srcRemote = src.resource.fsPath;
          const name = upath.basename(srcRemote);
          const newRemotePath = upath.join(destRemoteDir, name);
          const localFrom = handleCtxFromUri(src.resource.uri).target.localFsPath;
          const localTo = path.join(destLocalDir, name);
          await renameRemote(src.resource.uri, {
            newRemotePath,
            localRename: { from: localFrom, to: localTo },
            skipRefresh: true,
          });
        } catch (error) {
          reportError(error, 'remoteExplorer drag&drop');
        }
      })
    );

    if (app.remoteExplorer) {
      app.remoteExplorer.refresh();
    }
  }
}
