import { window } from 'vscode';
import * as fse from 'fs-extra';
import * as path from 'path';
import { L } from '../i18n';
import { canElevate, execAsRoot, ElevationCancelled, shQuote, isAbsoluteRemotePath } from './privilegedExec';

// Read cap, same as the in-editor preview / "View as root": a root-owned file you edit is a config, not a
// multi-GB blob, and streaming a huge file back over the su PTY is fragile. A larger file is truncated here.
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
// ROOT (`su … head -c`) and write the copy to its normal local path, so it opens for editing; writing it back
// on save is then handled by the existing "apply as root" fallback (permissionFallback). Root is used (not
// the owner) because root can read any file and reading is non-destructive. Returns true when the file was
// fetched as root and now exists locally. Never throws.
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
        en: 'Reads the file via `su` as root into your workspace copy (up to 10 MB). Saving your edits back uses the same "apply as root" flow. The root password is asked only if it is not already cached for this window.',
        ru: 'Читает файл через `su` от root в локальную копию (до 10 МБ). Сохранение правок назад идёт через тот же «применить от root». Пароль root спросят, только если он ещё не сохранён на это окно.',
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
    // NO pipe — `$?` is head's OWN exit; rawOutput=true so the su sanitizer can't strip the password out of
    // the file content. Root reads any file; reading is non-destructive, so no owner/root choice is needed.
    const cmd = `head -c ${READ_CAP} -- ${shQuote(remotePath)}`;
    const { code, output } = await execAsRoot(remotefs, host, cmd, undefined, true);
    if (code !== 0) {
      window.showErrorMessage(
        L({
          en: `WireFerry: reading "${remotePath}" as root failed (exit ${code}).`,
          ru: `WireFerry: чтение «${remotePath}» от root не удалось (код ${code}).`,
        })
      );
      return false;
    }
    await fse.ensureDir(path.dirname(localPath));
    await fse.writeFile(localPath, output);
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
