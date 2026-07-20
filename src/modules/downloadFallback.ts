import { window } from 'vscode';
import * as fse from 'fs-extra';
import * as path from 'path';
import { L } from '../i18n';
import { fileOperations } from '../core';
import { canElevate, execAsRoot, ElevationCancelled, shQuote, isAbsoluteRemotePath } from './privilegedExec';

// Upper size a root-owned file may have to be fetched for editing. It's a config, not a multi-GB blob;
// a larger one is refused (not truncated) so the write-back can never overwrite the server with a
// partial copy.
const READ_CAP = 10 * 1024 * 1024;

// A download/read rejected for lack of permission — the mirror of permissionFallback's write side. ssh2
// surfaces SSH_FX_PERMISSION_DENIED as numeric code 3; EACCES/EPERM are defensive aliases. FTP (no shell)
// can't be escalated, so a bare text match on "permission denied" is intentionally NOT used here — this
// predicate only gates the offer, and offerDownloadAsRoot refuses cleanly on a non-SSH connection anyway.
export function isReadPermissionDenied(err: any): boolean {
  if (!err) {
    return false;
  }
  const code = err.code;
  return code === 3 || code === 'EACCES' || code === 'EPERM';
}

// A download / "Edit in Local" was refused because the login user can't read the file. Offer to fetch it AS
// ROOT — root copies it to a world-readable /tmp staging file, which we pull with an ordinary byte-exact
// SFTP get and root then removes — and write it to the normal local path so it opens for editing; writing
// it back on save is then handled by the existing "apply as root" fallback (permissionFallback). Root is
// used (not the owner) because root can read any file and reading is non-destructive. Returns true when the
// file was fetched as root and now exists locally. Never throws.
export async function offerDownloadAsRoot(ctx: any): Promise<boolean> {
  const remotePath: string = ctx.target.remoteFsPath;
  const localPath: string = ctx.target.localFsPath;
  // Under `su -` a relative path resolves against /root, and a leading-dash name could be read as an option
  // by `head`. Require an absolute server path (same guard as the other su commands).
  if (!isAbsoluteRemotePath(remotePath)) {
    window.showErrorMessage(
      L({
        en: `WireFerry: "Download as root" needs an absolute server path ("${remotePath}").`,
        ru: `WireFerry: «Скачать от root» требует абсолютного пути на сервере («${remotePath}»).`,
      })
    );
    return false;
  }
  if (!localPath) {
    return false;
  }
  let remotefs;
  try {
    remotefs = await ctx.fileService.getRemoteFileSystem(ctx.config);
  } catch (e) {
    window.showErrorMessage(
      L({
        en: `WireFerry: can't connect — ${(e && (e as Error).message) || e}`,
        ru: `WireFerry: не удалось подключиться — ${(e && (e as Error).message) || e}`,
      })
    );
    return false;
  }
  if (!canElevate(remotefs)) {
    window.showWarningMessage(
      L({
        en: 'Reading as root needs an SSH connection with a shell (not available on FTP).',
        ru: 'Чтение от root требует SSH-подключения с оболочкой (недоступно на FTP).',
      })
    );
    return false;
  }
  const asRoot = { title: L({ en: 'Download as root', ru: 'Скачать от root' }) };
  const cancel = { title: L({ en: 'Cancel', ru: 'Отмена' }), isCloseAffordance: true };
  const pick = await window.showWarningMessage(
    L({
      en: `No permission to read "${remotePath}". Download it as root?`,
      ru: `Нет прав прочитать «${remotePath}». Скачать от root?`,
    }),
    {
      modal: true,
      detail: L({
        en: 'Copies the file as root to a temp path, downloads it byte-for-byte into your workspace copy (up to 10 MB — a larger file is refused), then removes the temp. Saving your edits back uses the same "apply as root" flow. The root password is asked only if it is not already cached for this window.',
        ru: 'Копирует файл от root во временный путь, скачивает его побайтово в локальную копию (до 10 МБ — файл больше отклоняется), затем удаляет временный. Сохранение правок назад идёт через тот же «применить от root». Пароль root спросят, только если он ещё не сохранён на это окно.',
      }),
    },
    asRoot,
    cancel
  );
  if (!pick || pick.title !== asRoot.title) {
    return false;
  }
  try {
    const host = ctx.config.host || '';
    // Refuse a file larger than the read cap BEFORE reading it. `head -c` would return a silently
    // truncated copy; because that copy is meant for editing and the write-back does `cat local > dest`
    // as root, saving a truncated copy would overwrite the real server file with the truncation — data
    // loss. Probe the real BYTE size (not the decoded string length, which differs for multi-byte
    // content) and only refuse when we KNOW it exceeds the cap; if the probe itself fails we fall back
    // to the capped read (best effort, unchanged behaviour).
    const sizeCmd = `stat -c %s -- ${shQuote(remotePath)} 2>/dev/null || wc -c < ${shQuote(remotePath)}`;
    const sizeProbe = await execAsRoot(remotefs, host, sizeCmd);
    const bytes = parseInt(String(sizeProbe.output).trim(), 10);
    if (sizeProbe.code === 0 && Number.isFinite(bytes) && bytes > READ_CAP) {
      window.showErrorMessage(
        L({
          en: `WireFerry: "${remotePath}" is ${bytes} bytes (over the 10 MB limit) — too large to safely edit as root without truncating it. Copy it another way.`,
          ru: `WireFerry: «${remotePath}» — ${bytes} байт (больше лимита 10 МБ), слишком велик, чтобы безопасно править от root без усечения. Скопируйте его иначе.`,
        })
      );
      return false;
    }
    // Byte-safe fetch. Reading the content through the `su` PTY as a string (`toString('utf8')` +
    // CRLF collapse) corrupts any non-UTF-8 / binary byte irreversibly, and that corruption would be
    // written back to the server on save. Instead root copies the file to a world-readable /tmp staging
    // file, we pull THAT with an ordinary (byte-exact) SFTP get, then root removes the staging file.
    const stagingFile = `/tmp/.wf-dl-${process.pid.toString(36)}-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    const stageCmd = `cp -- ${shQuote(remotePath)} ${shQuote(stagingFile)} && chmod 0644 -- ${shQuote(stagingFile)}`;
    const stage = await execAsRoot(remotefs, host, stageCmd);
    if (stage.code !== 0) {
      window.showErrorMessage(
        L({
          en: `WireFerry: reading "${remotePath}" as root failed (exit ${stage.code}).`,
          ru: `WireFerry: чтение «${remotePath}» от root не удалось (код ${stage.code}).`,
        })
      );
      return false;
    }
    try {
      await fse.ensureDir(path.dirname(localPath));
      const localFs = ctx.fileService.getLocalFileSystem();
      // Pull the staging into a local sibling temp then rename — byte-exact download AND atomic replace,
      // so an interrupted transfer can't truncate an existing local copy.
      const localTmp = `${localPath}.wf-root-${process.pid.toString(36)}-${Date.now().toString(36)}.tmp`;
      try {
        await fileOperations.transferFile(stagingFile, localTmp, remotefs, localFs);
        await fse.rename(localTmp, localPath);
      } catch (err) {
        await fse.remove(localTmp).catch(() => undefined);
        throw err;
      }
    } finally {
      // Remove the root-owned staging file (world-readable but only root can unlink it). Best effort.
      await execAsRoot(remotefs, host, `rm -f -- ${shQuote(stagingFile)}`).catch(() => undefined);
    }
    return true;
  } catch (e) {
    if (e instanceof ElevationCancelled) {
      return false; // user backed out of the password prompt
    }
    window.showErrorMessage(
      L({
        en: `WireFerry: couldn't download "${remotePath}" as root — ${(e && (e as Error).message) || e}`,
        ru: `WireFerry: не удалось скачать «${remotePath}» от root — ${(e && (e as Error).message) || e}`,
      })
    );
    return false;
  }
}
