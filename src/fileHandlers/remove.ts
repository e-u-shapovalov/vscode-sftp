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
      // ── Top-level target: capture both sides for the comparison row ──────
      // For a single file this gives the user a clear local↔server diff.
      // For directories we still show the top-level, but only the server side
      // is available without traversing the local tree (which we intentionally skip).
      if (operationReport.isActive()) {
        const serverStat: operationReport.FileSideStat = {
          size: stat.size,
          mode: stat.mode,
          mtime: stat.mtime,
        };

        let localStat: operationReport.FileSideStat | null = null;
        if (localFsPath) {
          try {
            const s = fs.statSync(localFsPath);
            localStat = { size: s.size, mode: s.mode, mtime: s.mtimeMs };
          } catch {
            // Local copy absent — leave null.
          }
        }

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
          logger.warn(`Unsupported file type (type = ${stat.type}). File ${remoteFsPath}`);
      }
      await promise;
      } // end if (stat) — server file existed
    } else if (operationReport.isActive()) {
      // skipRemote path: local-only delete — record the local side.
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
        try {
          await vscode.workspace.fs.delete(vscode.Uri.file(localFsPath), {
            recursive: true,
            useTrash: true,
          });
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
          } catch (err2) {
            logger.warn(`Failed to delete local copy '${localFsPath}': ${err2.message}`);
          }
        }
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
