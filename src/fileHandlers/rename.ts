import * as fse from 'fs-extra';
import { fileOperations, FileType } from '../core';
import { toRemotePath } from '../helper';
import { trashLocalPath } from '../host';
import createFileHandler from './createFileHandler';
import app from '../app';

// Monotonic suffix for the transactional-overwrite backup name, so two replaces landing in the same
// millisecond can't collide on `${dest}.wf-tmp-<ts>`.
let backupSeq = 0;

// Rename or move a file/folder on the server. The handler target is the *source* (old) resource;
// the destination is supplied via options. Shared by:
//   - Remote Explorer "Rename"        → newRemotePath + localRename
//   - in-tree drag&drop move          → newRemotePath + localRename
//   - local→server rename/move sync   → newLocalPath (no local mirror: VS Code already moved it)
//   - git "Upload Changed Files"      → newLocalPath
//
// (Replaces the previous version, which fed local paths to a remote rename and swapped old/new —
// see ROADMAP. Source is target.remoteFsPath; the destination is an explicit remote path or a
// local path converted via the service config.)
export const renameRemote = createFileHandler<{
  newRemotePath?: string;
  newLocalPath?: string;
  localRename?: { from: string; to: string };
  skipRefresh?: boolean;
  // When set, an occupied destination is REPLACED instead of aborting. The replace is transactional:
  // the existing target is moved aside to a sibling backup, the source is renamed into place, and only
  // then is the backup dropped (file → unlink, directory → recursive rmdir); a failed source rename
  // restores the backup, so the destination is never lost on a partial failure. The local mirror move
  // overwrites too. Only the drag&drop move opts in, after the user explicitly picked "Overwrite".
  overwrite?: boolean;
  // Type the caller confirmed overwriting. If the live destination is a DIFFERENT type (e.g. a file
  // was swapped for a directory between the dialog and here), the replace is refused — we must never
  // recursively delete something the user never saw. Undefined skips the guard.
  overwriteExpectType?: FileType;
}>({
  name: 'rename',
  async handle({ newRemotePath, newLocalPath, localRename, skipRefresh, overwrite, overwriteExpectType }) {
    const remoteFs = await this.fileService.getRemoteFileSystem(this.config);
    const { remoteFsPath } = this.target;

    // baseDir is the service's normalized absolute local root; config.context is the raw user
    // value and may be undefined or relative, which would derail the local→remote mapping.
    const destRemotePath =
      newRemotePath !== undefined
        ? newRemotePath
        : newLocalPath !== undefined
        ? toRemotePath(newLocalPath, this.fileService.baseDir, this.config.remotePath)
        : undefined;

    const doRemote = destRemotePath !== undefined && destRemotePath !== remoteFsPath;
    const localFromExists =
      !!localRename &&
      localRename.from !== localRename.to &&
      (await fse.pathExists(localRename.from));

    // A pure case change (foo.txt → Foo.txt) is not a real collision: on a case-INSENSITIVE
    // filesystem the destination resolves to the source itself, so the "already exists" preflight
    // would otherwise block recasing entirely. On case-sensitive systems a same-name-but-different-
    // case sibling is genuinely rare, and recasing is the operation the user actually asked for.
    const isCaseOnlyRemoteRename =
      doRemote && destRemotePath!.toLowerCase() === remoteFsPath.toLowerCase();
    const isCaseOnlyLocalRename =
      !!localRename && localRename.from.toLowerCase() === localRename.to.toLowerCase();

    // Preflight: fail BEFORE touching anything if a destination is already occupied, so we never end
    // up half-applied (server renamed but local left behind, or vice versa). The `overwrite` opt-out
    // instead REPLACES the occupied destination — the caller has already confirmed that with the user.
    if (
      localFromExists &&
      !isCaseOnlyLocalRename &&
      !overwrite &&
      (await fse.pathExists(localRename!.to))
    ) {
      throw new Error(`Local target already exists: ${localRename!.to}`);
    }
    let remoteRenamed = false;
    if (doRemote && !isCaseOnlyRemoteRename) {
      let remoteDestType: FileType | null = null;
      try {
        remoteDestType = (await remoteFs.lstat(destRemotePath!)).type;
      } catch (e) {
        // Only a genuine "not found" means the destination is free. A permission/timeout/disconnect
        // error must NOT be read as "absent" — otherwise we'd skip the collision check and rename over
        // a target that may well exist. Mirrors the isNotFoundError guard create/remove already use.
        //   SFTP lstat → err.code 2 / 'ENOENT'; FTP lstat → Error('file not exist') (no code).
        const code = e && (e as any).code;
        const message = e && (e as Error).message;
        if (!(code === 2 || code === 'ENOENT' || message === 'file not exist')) {
          throw e;
        }
        remoteDestType = null;
      }
      if (remoteDestType !== null) {
        if (!overwrite) {
          throw new Error(`Remote target already exists: ${destRemotePath}`);
        }
        // The confirmed type must still match the live one — otherwise a file→directory swap between
        // the dialog and now would trigger an unconfirmed recursive delete.
        if (overwriteExpectType !== undefined && remoteDestType !== overwriteExpectType) {
          throw new Error(`Remote target type changed since it was confirmed, not overwriting: ${destRemotePath}`);
        }
        // Transactional replace: move the existing target aside, rename the source into place, then
        // drop the backup. A plain rename onto an occupied path isn't portable (SFTP SSH_FXP_RENAME
        // fails when the target exists), and delete-then-rename would lose the destination if the
        // rename failed (missing/renamed source, permission, disconnect). Restore the backup on failure.
        const backup = `${destRemotePath}.wf-tmp-${Date.now()}-${backupSeq++}`;
        await remoteFs.rename(destRemotePath!, backup);
        try {
          await fileOperations.rename(remoteFsPath, destRemotePath!, remoteFs);
        } catch (e) {
          // The source rename failed — put the original destination back. If even THAT fails, the data
          // isn't lost (it lives under `backup`), but the caller must be told where, not left with a
          // bare "rename failed". Never swallow the restore error silently.
          try {
            await remoteFs.rename(backup, destRemotePath!);
          } catch (restoreErr) {
            throw new Error(
              `Move failed and the original could not be restored to ${destRemotePath} — it is preserved ` +
                `at ${backup}. Cause: ${(e && (e as Error).message) || String(e)}`
            );
          }
          throw e;
        }
        remoteRenamed = true;
        // Best-effort cleanup: the source is now safely in place, so a leftover `.wf-tmp-*` backup is
        // harmless and must not fail the (succeeded) move or block the local mirror below.
        try {
          if (remoteDestType === FileType.Directory) {
            await remoteFs.rmdir(backup, true);
          } else {
            await remoteFs.unlink(backup);
          }
        } catch (e) {
          // leave the backup behind; the move itself succeeded
        }
      }
    }

    // Apply: server first (unless the transactional replace above already did it), then mirror the
    // local copy (Remote Explorer rename and in-tree drag&drop opt in via localRename; local→server
    // sync doesn't, since VS Code already moved the file).
    if (doRemote && !remoteRenamed) {
      await fileOperations.rename(remoteFsPath, destRemotePath!, remoteFs);
    }
    if (localFromExists) {
      const { from, to } = localRename!;
      if (isCaseOnlyLocalRename) {
        // fse.move(…, { overwrite: false }) refuses here because a case-insensitive disk reports
        // the destination as already existing (it IS the source). A raw rename recases in place.
        await fse.rename(from, to);
      } else if (overwrite && (await fse.pathExists(to))) {
        // Replace the occupied LOCAL target as carefully as the server one. fse.move({overwrite:true})
        // does remove-then-rename — it would HARD-delete `to` (recursively for a folder) and could lose
        // it outright if the move then failed, the very anti-pattern the server side is built to avoid.
        // Instead: back `to` up to a sibling, move the source in, and send the displaced copy to the OS
        // trash (recoverable), never a hard delete. Restore the backup if the move fails, so the local
        // target can't vanish on a partial failure.
        const localBackup = `${to}.wf-tmp-${Date.now()}-${backupSeq++}`;
        await fse.move(to, localBackup, { overwrite: false });
        try {
          await fse.move(from, to, { overwrite: false });
        } catch (e) {
          await fse.move(localBackup, to, { overwrite: true }).catch(() => undefined);
          throw e;
        }
        // Source is in place — the displaced copy goes to the trash (recoverable). If even that fails,
        // leave the `.wf-tmp-*` backup behind rather than fail the move that already succeeded.
        await trashLocalPath(localBackup).catch(() => undefined);
      } else {
        await fse.move(from, to, { overwrite: false });
      }
    }

    if (!skipRefresh && app.remoteExplorer) {
      app.remoteExplorer.refresh();
    }
  },
});
