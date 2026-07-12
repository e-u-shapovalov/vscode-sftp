import * as vscode from 'vscode';
import * as path from 'path';
import * as fse from 'fs-extra';
import { upath, FileType } from '../../core';
import { renameRemote, handleCtxFromUri } from '../../fileHandlers';
import { showConfirmMessage, showWarningMessage, showInformationMessage } from '../../host';
import { reportError } from '../../helper';
import { localFileMd5 } from '../../helper/fileFacts';
import { L } from '../../i18n';
import app from '../../app';
import RemoteTreeData, { ExplorerItem, ExplorerRoot } from './treeDataProvider';
import { resolveMoveConflict } from './moveConflict';

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
    // ENOENT at best, a wrong-server write at worst. Profiles of one config share a remoteId, so the
    // identity includes the profile (otherwise a prod→staging drag would slip past this guard).
    const rootKeyOf = (r: ExplorerItem['resource']) => `${r.remoteId}|${r.profile || ''}`;
    const targetKey = rootKeyOf(target.resource);
    if (sources.some(s => rootKeyOf(s.resource) !== targetKey)) {
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
    let remoteFs: any;
    try {
      const destCtx = handleCtxFromUri(destFolder.resource.uri);
      destLocalDir = destCtx.target.localFsPath;
      remoteFs = await destCtx.fileService.getRemoteFileSystem(destCtx.config);
    } catch (error) {
      reportError(error, 'remoteExplorer drag&drop');
      return;
    }

    // Slash-terminated normalized path, so '/a/b' is not treated as a prefix of '/a/bc'.
    const asPrefix = (p: string) => upath.normalize(p).replace(/\/+$/, '') + '/';

    // Drop moves that are no-ops or invalid: source already in the destination folder, or moving a
    // folder into itself / one of its descendants. Remote paths are POSIX, so compare with upath.
    const candidates = sources.filter(src => {
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
      const srcPrefix = asPrefix(srcRemote);
      const destPrefix = asPrefix(destRemoteDir);
      if (destPrefix === srcPrefix || destPrefix.startsWith(srcPrefix)) {
        return false;
      }
      return true;
    });

    // Collapse nested selections: if a selected FOLDER is dragged, a separately-selected item inside it
    // is NOT an independent move — the folder carries it. Processing both (multi-select allows it) would
    // move the folder first, then find the child's old path gone and, on a same-name collision, risk
    // destroying the destination. Keep only sources that are not contained in another selected source.
    const moves = candidates.filter(src => {
      const srcPrefix = asPrefix(src.resource.fsPath);
      return !candidates.some(other => {
        if (other === src) {
          return false;
        }
        const otherPrefix = asPrefix(other.resource.fsPath);
        // PROPER containment only — two selections of the same path must not cancel each other out.
        return srcPrefix !== otherPrefix && srcPrefix.startsWith(otherPrefix);
      });
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

    // Sequential (not Promise.all): a collision can pop a modal, and overlapping dialogs — or two
    // moves racing to write the same destination — would be a mess. A couple of lstats per item is cheap.
    let deduped = 0;
    let localDiffers = 0;
    for (const src of moves) {
      const srcRemote = src.resource.fsPath;
      const baseName = upath.basename(srcRemote);
      let localFrom: string;
      try {
        localFrom = handleCtxFromUri(src.resource.uri).target.localFsPath;
      } catch (error) {
        reportError(error, 'remoteExplorer drag&drop');
        continue;
      }

      // The source must still exist before we consider any destructive resolution. A stale tree snapshot
      // (moved by another action / deleted by an external process) would otherwise let a conflict dialog
      // + Overwrite destroy the destination for a move that can't actually happen. lstat also gives the
      // authoritative source type, so dedup/overwrite decisions never run on a downgraded "unknown".
      let srcStat: any;
      try {
        srcStat = await remoteFs.lstat(srcRemote);
      } catch (e) {
        showWarningMessage(
          L({
            en: `Skipped "${baseName}" — it is no longer on the server.`,
            ru: `Пропущено «${baseName}» — его больше нет на сервере.`,
          })
        );
        continue;
      }

      // Settle where (and whether) this item lands. Looping lets "Rename" retry against a name that is
      // itself already taken. `overwrite`/`dedup`/`skip`/`cancel` each break out with an outcome.
      let targetName = baseName;
      let overwrite = false;
      let overwriteType: FileType | undefined;
      let outcome: 'move' | 'dedup' | 'skip' | 'cancel' = 'move';
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const destPath = upath.join(destRemoteDir, targetName);
        let destStat: any;
        try {
          destStat = await remoteFs.lstat(destPath);
        } catch (e) {
          // Whether "not found" (name free) or a transient/permission error, stop looping and let the
          // actual move proceed — renameRemote's own preflight re-checks and surfaces a real collision.
          break;
        }

        const res = await resolveMoveConflict(remoteFs, {
          name: targetName,
          destFolderName: destName,
          srcPath: srcRemote,
          destPath,
          srcStat,
          destStat,
          srcHint: {
            owner: src.owner,
            group: src.group,
            uid: src.uid,
            gid: src.gid,
          },
        });
        if (res.action === 'overwrite') {
          overwrite = true;
          overwriteType = destStat.type;
          break;
        }
        if (res.action === 'rename') {
          targetName = res.newName!;
          continue;
        }
        outcome = res.action; // 'dedup' | 'skip' | 'cancel'
        break;
      }

      if (outcome === 'cancel') {
        break; // abort the whole drop; nothing further is touched
      }
      if (outcome === 'skip') {
        continue;
      }

      try {
        if (outcome === 'dedup') {
          // The server already holds byte-identical content at the destination, so this "move" collapses
          // to relocating the local copy and dropping the server-side source duplicate. Do the LOCAL side
          // FIRST and NEVER overwrite an unverified local destination: server MD5 says nothing about local
          // edits, so an existing local target is only collapsed when it is byte-identical too.
          const localTo = path.join(destLocalDir, targetName);
          const haveFrom = !!localFrom && (await fse.pathExists(localFrom));
          if (!haveFrom) {
            await remoteFs.unlink(srcRemote);
            deduped += 1;
          } else if (!(await fse.pathExists(localTo))) {
            await fse.move(localFrom, localTo, { overwrite: false });
            await remoteFs.unlink(srcRemote);
            deduped += 1;
          } else {
            const [a, b] = await Promise.all([localFileMd5(localFrom), localFileMd5(localTo)]);
            if (a && b && a === b) {
              await fse.remove(localFrom);
              await remoteFs.unlink(srcRemote);
              deduped += 1;
            } else {
              // Local copies differ (or couldn't be hashed) — leave BOTH sides exactly as they are.
              localDiffers += 1;
            }
          }
          continue;
        }
        await renameRemote(src.resource.uri, {
          newRemotePath: upath.join(destRemoteDir, targetName),
          localRename: { from: localFrom, to: path.join(destLocalDir, targetName) },
          skipRefresh: true,
          overwrite,
          overwriteExpectType: overwriteType,
        });
      } catch (error) {
        reportError(error, 'remoteExplorer drag&drop');
      }
    }

    if (app.remoteExplorer) {
      app.remoteExplorer.refresh();
    }

    if (deduped > 0) {
      showInformationMessage(
        L({
          en: `${deduped} identical file(s) were already on the server — the source duplicate was removed.`,
          ru: `Идентичных файлов уже было на сервере: ${deduped} — исходный дубликат удалён.`,
        })
      );
    }
    if (localDiffers > 0) {
      showWarningMessage(
        L({
          en: `${localDiffers} file(s) matched on the server but the local copies differ — left unchanged; resolve them manually.`,
          ru: `Файлов совпало на сервере, но локальные копии различаются: ${localDiffers} — оставлены без изменений, разберите вручную.`,
        })
      );
    }
  }
}
