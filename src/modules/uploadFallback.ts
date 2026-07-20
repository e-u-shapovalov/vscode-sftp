import { window } from 'vscode';
import logger from '../logger';
import { L } from '../i18n';
import { fileOperations } from '../core';
import { transfer, TransferDirection } from '../fileHandlers/transfer/transfer';
import { refreshRemoteExplorer } from '../fileHandlers/shared';
import { canElevate, execAsRoot, ElevationCancelled, shQuote, isAbsoluteRemotePath } from './privilegedExec';
import { isPermissionFallbackActive } from './permissionFallback';

// A remote SFTP write rejected for lack of permission — the mirror of downloadFallback's read side. ssh2
// surfaces SSH_FX_PERMISSION_DENIED as numeric code 3; EACCES/EPERM are defensive aliases. FTP (no shell)
// can't be escalated, so this predicate only gates the offer — offerUploadAsRoot refuses cleanly on a
// non-SSH connection anyway.
export function isWritePermissionDenied(err: any): boolean {
  if (!err) {
    return false;
  }
  const code = err.code;
  return code === 3 || code === 'EACCES' || code === 'EPERM';
}

// Basename of a remote (always POSIX) path, tolerant of trailing slashes.
function remoteBasename(p: string): string {
  const trimmed = p.replace(/\/+$/, '');
  const idx = trimmed.lastIndexOf('/');
  return idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
}

// POSIX dirname of a remote path (kept minimal — the remote is always POSIX). "/root/x" -> "/root",
// "/x" -> "/". Trailing slashes are trimmed first so "/root/x/" behaves like "/root/x".
function remoteDirname(p: string): string {
  const trimmed = p.replace(/\/+$/, '');
  const idx = trimmed.lastIndexOf('/');
  if (idx < 0) {
    return '.';
  }
  return idx === 0 ? '/' : trimmed.slice(0, idx);
}

// A folder upload was refused because the login user can't create/write under the destination (e.g.
// dropping a folder into /root). Offer to redo the WHOLE upload AS ROOT: stage the tree to a writable
// temp dir over ordinary SFTP, then `su` root to move it into place (chown to root, cp -a, cleanup).
// Root is used because it can write anywhere; the staged copy is always removed. Returns true when the
// upload was applied as root. Never throws.
export async function offerUploadAsRoot(ctx: any): Promise<boolean> {
  // A per-file recovery dialog (permissionFallback) may already be handling a partly-writable upload —
  // don't stack a second modal on top of it.
  if (isPermissionFallbackActive()) {
    return false;
  }

  const localPath: string = ctx.target.localFsPath;
  const remotePath: string = ctx.target.remoteFsPath;
  // Under `su -` a relative path resolves against /root, and cp/mkdir on a relative dest would land in
  // the wrong place. Require an absolute server path (same guard as the other su commands).
  if (!isAbsoluteRemotePath(remotePath)) {
    window.showErrorMessage(
      L({
        en: `WireFerry: "Upload as root" needs an absolute server path ("${remotePath}").`,
        ru: `WireFerry: «Загрузить от root» требует абсолютного пути на сервере («${remotePath}»).`,
      })
    );
    return false;
  }
  if (!localPath) {
    return false;
  }

  let remoteFs;
  try {
    remoteFs = await ctx.fileService.getRemoteFileSystem(ctx.config);
  } catch (e) {
    window.showErrorMessage(
      L({
        en: `WireFerry: can't connect — ${(e && (e as Error).message) || e}`,
        ru: `WireFerry: не удалось подключиться — ${(e && (e as Error).message) || e}`,
      })
    );
    return false;
  }
  if (!canElevate(remoteFs)) {
    window.showWarningMessage(
      L({
        en: 'Uploading as root needs an SSH connection with a shell (not available on FTP).',
        ru: 'Загрузка от root требует SSH-подключения с оболочкой (недоступно на FTP).',
      })
    );
    return false;
  }

  const asRoot = { title: L({ en: 'Upload as root', ru: 'Загрузить от root' }) };
  const cancel = { title: L({ en: 'Cancel', ru: 'Отмена' }), isCloseAffordance: true };
  const pick = await window.showWarningMessage(
    L({
      en: `No permission to write "${remotePath}". Upload it as root?`,
      ru: `Нет прав записать «${remotePath}». Загрузить от root?`,
    }),
    {
      modal: true,
      detail: L({
        en: 'Uploads the folder to a temporary path first, then moves it into place via `su` as root (the copy is owned by root). The root password is asked only if it is not already cached for this window.',
        ru: 'Сначала загружает папку во временный путь, затем переносит на место через `su` от root (копия принадлежит root). Пароль root спросят, только если он ещё не сохранён на это окно.',
      }),
    },
    asRoot,
    cancel
  );
  if (!pick || pick.title !== asRoot.title) {
    return false;
  }

  // Staging dir under /tmp (world-writable) that the login user CAN write to over SFTP. A random-ish
  // suffix avoids clashing with a concurrent upload; the whole dir is removed after the root move.
  const rand = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const stagingDir = `/tmp/.wf-upload-${rand}`;
  const base = remoteBasename(remotePath);
  const stagedPath = `${stagingDir}/${base}`;
  const destParent = remoteDirname(remotePath);
  const host = ctx.config.host || '';

  try {
    // 1) Stage the local tree to the writable temp path over ordinary SFTP (same machinery as a normal
    //    upload, just pointed at /tmp). filePerm/dirPerm are applied so the staged tree carries the
    //    perms a normal upload would set; `cp -a` then preserves them at the destination.
    const localFs = ctx.fileService.getLocalFileSystem();
    const scheduler = ctx.fileService.createTransferScheduler(ctx.config.concurrency);
    await transfer(
      {
        srcFsPath: localPath,
        srcFs: localFs,
        targetFsPath: stagedPath,
        targetFs: remoteFs,
        filePerm: ctx.config.filePerm,
        dirPerm: ctx.config.dirPerm,
        transferDirection: TransferDirection.LOCAL_TO_REMOTE,
        remoteHost: host,
        transferOption: {
          perserveTargetMode: false,
          useTempFile: ctx.config.useTempFile,
          openSsh: ctx.config.openSsh,
          ignore: null,
          maxFileSize: 0,
        },
      } as any,
      t => scheduler.add(t)
    );
    await scheduler.run();

    // 2) Move it into place as root: normalize ownership to root, ensure the parent exists, copy the
    //    staged tree over (merging into an existing dest, `-f` overwrites), then always clean the
    //    staging dir up and surface the copy's real exit code. `--` guards leading-dash names.
    const applyCmd =
      `chown -R 0:0 -- ${shQuote(stagingDir)} && ` +
      `mkdir -p -- ${shQuote(destParent)} && ` +
      `cp -afT -- ${shQuote(stagedPath)} ${shQuote(remotePath)}; ` +
      `rc=$?; rm -rf -- ${shQuote(stagingDir)}; exit $rc`;

    const { code } = await execAsRoot(remoteFs, host, applyCmd);
    if (code !== 0) {
      window.showErrorMessage(
        L({
          en: `WireFerry: uploading "${remotePath}" as root failed (exit ${code}).`,
          ru: `WireFerry: загрузка «${remotePath}» от root не удалась (код ${code}).`,
        })
      );
      return false;
    }
    logger.info(`upload fallback: applied "${localPath}" to "${remotePath}" as root on ${host || 'server'}`);
    window.showInformationMessage(
      L({
        en: `Uploaded "${remotePath}" as root.`,
        ru: `Загружено «${remotePath}» от root.`,
      })
    );
    // The normal afterHandle (which refreshes the tree) never ran — the upload threw. Refresh now so the
    // newly-created folder shows up. Best-effort: a refresh failure must not turn a successful upload
    // into an error.
    try {
      await refreshRemoteExplorer(ctx.target, true);
    } catch (err) {
      logger.warn(`upload fallback: tree refresh failed: ${(err && (err as Error).message) || err}`);
    }
    return true;
  } catch (e) {
    if (e instanceof ElevationCancelled) {
      // User backed out of the password prompt. The staged copy is still owned by the login user (we
      // only chown as root, which never ran), so remove it best-effort over SFTP.
      cleanupStaging(remoteFs, stagingDir);
      return false;
    }
    logger.error(`upload-as-root failed: ${(e && (e as Error).message) || e}`, remotePath);
    window.showErrorMessage(
      L({
        en: `WireFerry: couldn't upload "${remotePath}" as root — ${(e && (e as Error).message) || e}`,
        ru: `WireFerry: не удалось загрузить «${remotePath}» от root — ${(e && (e as Error).message) || e}`,
      })
    );
    cleanupStaging(remoteFs, stagingDir);
    return false;
  }
}

// Best-effort removal of the staging dir over SFTP (used when the root move never ran, so the temp tree
// is still owned by the login user and removable without elevation). Failures are only logged.
function cleanupStaging(remoteFs: any, stagingDir: string): void {
  fileOperations
    .removeDir(stagingDir, remoteFs, {})
    .catch((err: any) =>
      logger.warn(`upload fallback: couldn't clean staging dir ${stagingDir}: ${(err && err.message) || err}`)
    );
}
