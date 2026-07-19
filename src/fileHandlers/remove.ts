import * as vscode from 'vscode';
import * as fs from 'fs';
import { refreshRemoteExplorer } from './shared';
import { fileOperations, FileType } from '../core';
import { RemoveDirOption } from '../core/fileBaseOperations';
import createFileHandler from './createFileHandler';
import { FileHandleOption } from './option';
import logger from '../logger';
import * as operationReport from '../ui/operationReport';
import { L } from '../i18n';

// A genuinely-absent remote file is the only thing we may treat as "already deleted". Everything else
// (permission denied, timeout, disconnect) must propagate — see the call site: for "both"/"all + PC"
// scopes we go on to delete the LOCAL copy, and mistaking an unreachable server for "gone" would
// erase the local file while the server copy still exists.
//   SFTP lstat → err.code === 2 (SSH_FX_NO_SUCH_FILE), some layers map it to 'ENOENT'.
//   FTP lstat  → throws Error('file not exist') (no code) once the parent listing succeeded but the
//                entry was absent; a failure to even list the parent surfaces as a different error.
function isRemoteNotFound(err: any): boolean {
  if (!err) {
    return false;
  }
  return err.code === 2 || err.code === 'ENOENT' || err.message === 'file not exist';
}

export const removeRemote = createFileHandler<
  FileHandleOption &
    RemoveDirOption & {
      skipDir?: boolean;
      removeLocalCopy?: boolean;
      skipRemote?: boolean;
      /** Passed from commandDeleteRemote so report rows carry the chosen scope. */
      reportScope?: 'server' | 'local' | 'both';
      /** Optional per-row note (e.g. "← host") so a fan-out delete across profiles names each server. */
      reportNote?: string;
    }
>({
  name: 'removeRemote',
  async handle(option) {
    // The local-only ("On computer") report row is DEFERRED into this closure and fired only after the local
    // removal below succeeds — so a delete that can't complete isn't reported as done (mirrors the server row).
    let addLocalRow: (() => void) | null = null;
    // Set true once a server file was ACTUALLY deleted (both/server scope, file existed). Used to word the
    // local-delete-failure warning honestly: on a local-only delete — or a "both" where the server copy was
    // already gone — the server was never deleted by us, so the warning must not claim it was.
    let serverDeleted = false;
    // skipRemote: delete only the local copy (the "On computer" choice). The server is left
    // untouched and no remote connection is opened — so it works even if the host is unreachable.
    if (!option.skipRemote) {
      const remoteFs = await this.fileService.getRemoteFileSystem(this.config);
      const { remoteFsPath, localFsPath } = this.target;
      const scope = option.reportScope ?? 'server';

      // Idempotent server delete: if the file is already absent on the server, that is NOT an error —
      // skip the remote removal. (For "both", the local copy is still moved to trash below.)
      let stat: any = null;
      try {
        stat = await remoteFs.lstat(remoteFsPath);
      } catch (e) {
        // Only swallow a real not-found. A transient/permission error must NOT be read as "already
        // gone" — otherwise the local-copy delete below would run against a server that may still
        // hold the file.
        if (!isRemoteNotFound(e)) {
          throw e;
        }
        logger.info(
          `removeRemote: '${remoteFsPath}' not on server (${(e && (e as Error).message) || String(e)}) — nothing to delete there`
        );
      }

      if (stat) {
      // Refuse a type we can't delete BEFORE claiming anything happened: the report row and the
      // afterHandle refresh below both signal "deleted", so a special file (socket, device, fifo →
      // FileType.Unknown) was reported as removed while the switch's default branch left the work
      // undone. Directories and files/symlinks are the only removable kinds.
      if (
        stat.type !== FileType.Directory &&
        stat.type !== FileType.File &&
        stat.type !== FileType.SymbolicLink
      ) {
        logger.warn(`Unsupported file type (type = ${stat.type}). File ${remoteFsPath}`);
        throw new Error(
          L({
            en: `Cannot delete "${remoteFsPath}": unsupported remote file type.`,
            ru: `Не удалось удалить «${remoteFsPath}»: неподдерживаемый тип удалённого файла.`,
          })
        );
      }

      // ── Top-level target: capture both sides for the comparison row ──────
      // For a single file this gives the user a clear local↔server diff.
      // For directories we still show the top-level, but only the server side
      // is available without traversing the local tree (which we intentionally skip).
      // Capture both sides BEFORE the delete, but ADD the "deleted" row only AFTER the delete actually
      // succeeds (below) — otherwise a permission-denied unlink (the file stat-ed fine but couldn't be
      // removed, e.g. a root-owned file) would be falsely reported as deleted before the root-retry runs.
      let addDeletedRow: (() => void) | null = null;
      if (operationReport.isActive()) {
        const serverStat: operationReport.FileSideStat = {
          size: stat.size,
          mode: stat.mode,
          mtime: stat.mtime,
        };
        let localStat: operationReport.FileSideStat | null = null;
        if (localFsPath) {
          try {
            const s = fs.lstatSync(localFsPath);
            localStat = { size: s.size, mode: s.mode, mtime: s.mtimeMs };
          } catch {
            // Local copy absent — leave null.
          }
        }
        addDeletedRow = () =>
          operationReport.addRow({
            action: L({ en: 'deleted', ru: 'удалено' }),
            path: remoteFsPath,
            scope,
            server: serverStat,
            local: localStat,
            note: option.reportNote,
          });
      }

      let promise;
      switch (stat.type) {
        case FileType.Directory:
          if (option.skipDir) {
            return;
          }

          promise = fileOperations.removeDir(remoteFsPath, remoteFs, {
            // Report each removed child entry (files/symlinks) with its server stats.
            // Directories get an entry too but without stats (see fileBaseOperations).
            onEntry: operationReport.isActive()
              ? (entry) => {
                  const serverEntryStat: operationReport.FileSideStat | undefined = entry.stats
                    ? { size: entry.stats.size, mode: entry.stats.mode, mtime: entry.stats.mtime }
                    : undefined;
                  operationReport.addRow({
                    action: L({ en: 'deleted', ru: 'удалено' }),
                    path: entry.path,
                    scope,
                    server: serverEntryStat ?? null,
                    note: option.reportNote,
                  });
                  // Also forward to any original caller-supplied onEntry.
                  option.onEntry?.(entry);
                }
              : option.onEntry,
            shouldCancel: option.shouldCancel,
          });
          break;
        case FileType.File:
        case FileType.SymbolicLink:
          // Single-file delete: the top-level comparison row was already added above.
          promise = fileOperations.removeFile(remoteFsPath, remoteFs, {});
          break;
        default:
          // Unreachable: the guard above already rejected unsupported types. Defensive so a future
          // FileType can never fall through to `await undefined` and be reported as deleted.
          throw new Error(`Unsupported file type (type = ${stat.type}). File ${remoteFsPath}`);
      }
      await promise;
      // The delete actually happened — only now record the top-level "deleted" row.
      addDeletedRow?.();
      serverDeleted = true;
      } else if (operationReport.isActive() && option.removeLocalCopy) {
        // Server copy already gone (stat === null) but this is a "both" delete that will still trash the
        // LOCAL copy below — build a deferred local row so the report isn't silent about that removal. (A
        // "server"-only delete of an already-absent file has genuinely nothing to report, so it's gated on
        // removeLocalCopy.) The combined `if (stat)` row above only fires when the server file existed.
        // Use lstatSync (not statSync) to mirror the combined path: report the symlink's OWN meta, not target's.
        let localStat: operationReport.FileSideStat | null = null;
        if (localFsPath) {
          try {
            const s = fs.lstatSync(localFsPath);
            localStat = { size: s.size, mode: s.mode, mtime: s.mtimeMs };
          } catch {
            // Local copy absent — leave null.
          }
        }
        // Only build the row when the local copy actually exists: if BOTH sides are already gone there is
        // nothing to record, and a "deleted" row for a wholly-absent object would be a false entry.
        if (localStat) {
          addLocalRow = () =>
            operationReport.addRow({
              action: L({ en: 'deleted', ru: 'удалено' }),
              path: localFsPath ?? remoteFsPath,
              scope,
              local: localStat,
            });
        }
      } // end if (stat) — server file existed
    } else if (operationReport.isActive()) {
      // skipRemote path: local-only delete. Capture the local side NOW, but DEFER the "deleted" row until the
      // local removal below actually succeeds — mirroring the server side, so a delete that fails (trash AND
      // permanent both blocked) isn't falsely reported as done.
      const { localFsPath } = this.target;
      let localStat: operationReport.FileSideStat | null = null;
      if (localFsPath) {
        try {
          const s = fs.statSync(localFsPath);
          localStat = { size: s.size, mode: s.mode, mtime: s.mtimeMs };
        } catch {
          // File already gone by the time we stat it.
        }
      }
      addLocalRow = () =>
        operationReport.addRow({
          action: L({ en: 'deleted', ru: 'удалено' }),
          path: localFsPath ?? this.target.remoteFsPath,
          scope: option.reportScope ?? 'local',
          local: localStat,
        });
    }

    // Optionally mirror the deletion to the local copy. Only the Remote Explorer
    // "Delete" command opts in via removeLocalCopy; other callers (file watcher,
    // upload-changed-files) act on files that are already gone locally.
    // We move it to the OS trash (not a permanent delete) so an accidental delete is recoverable.
    if (option.removeLocalCopy) {
      const { localFsPath } = this.target;
      if (localFsPath && fs.existsSync(localFsPath)) {
        let localDeleted = false;
        try {
          await vscode.workspace.fs.delete(vscode.Uri.file(localFsPath), {
            recursive: true,
            useTrash: true,
          });
          localDeleted = true;
        } catch (error) {
          // The OS trash can be unavailable (a subst / network drive has no Recycle Bin). Fall back to a
          // permanent delete so the file is actually removed instead of silently left behind — the same
          // thing VS Code's own delete offers ("Delete Permanently") in this situation.
          logger.warn(`Local trash unavailable for '${localFsPath}' (${error.message}); deleting permanently`);
          try {
            await vscode.workspace.fs.delete(vscode.Uri.file(localFsPath), {
              recursive: true,
              useTrash: false,
            });
            localDeleted = true;
            // The scope dialog promised the OS trash, but there is none here — the copy is gone PERMANENTLY.
            // Disclose it: a silent fallback would leave the user believing they can restore it from the
            // Recycle Bin, when for a local-only / modified file that is the last recoverable copy.
            vscode.window.showWarningMessage(
              L({
                en: `WireFerry: no Recycle Bin available here — the local copy was deleted PERMANENTLY (not recoverable): ${localFsPath}`,
                ru: `WireFerry: Корзина здесь недоступна — локальная копия удалена БЕЗВОЗВРАТНО (не восстановить): ${localFsPath}`,
              })
            );
          } catch (err2) {
            // Both trash and permanent delete failed (e.g. a read-only / ACL-locked file). The server
            // copy is already gone, so we don't throw — but the user MUST be told the local file is still
            // there: a silent warn would let the report/toast say "deleted" while the file remains on disk.
            logger.warn(`Failed to delete local copy '${localFsPath}': ${err2.message}`);
            // Word it to what actually happened. Only claim the server copy was deleted when we REALLY deleted
            // one (serverDeleted): a local-only ("On computer") delete never touches the server, and a "both"
            // whose server copy was already gone didn't delete it either — in both cases say only that the
            // local file remains, not that the server was cleared.
            vscode.window.showWarningMessage(
              serverDeleted
                ? L({
                    en: `WireFerry: the server copy was deleted, but the local file could not be removed (${err2.message}). It is still on disk: ${localFsPath}`,
                    ru: `WireFerry: копия на сервере удалена, но локальный файл убрать не удалось (${err2.message}). Он остался на диске: ${localFsPath}`,
                  })
                : L({
                    en: `WireFerry: the local file could not be removed (${err2.message}). It is still on disk: ${localFsPath}`,
                    ru: `WireFerry: локальный файл убрать не удалось (${err2.message}). Он остался на диске: ${localFsPath}`,
                  })
            );
          }
        }
        // Record the local-only "deleted" row (skipRemote path) only NOW — after the removal really happened.
        // On the "both" path addLocalRow is null (the combined row was added after the server delete above).
        if (localDeleted) {
          addLocalRow?.();
        }
      } else {
        // Nothing on disk to remove (already gone / no local path). For the local-only scope still emit the
        // deferred row so the report reflects the delete; on "both" addLocalRow is null, so this is a no-op.
        addLocalRow?.();
      }
    }
  },
  transformOption() {
    const config = this.config;
    return {
      ignore: config.ignore,
    };
  },
  afterHandle() {
    refreshRemoteExplorer(this.target, false);
  },
});
