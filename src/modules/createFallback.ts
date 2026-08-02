import { window } from 'vscode';
import app from '../app';
import logger from '../logger';
import { L } from '../i18n';
import { parseOctalMode } from '../helper/mode';
import { canElevate, execAsRoot, ElevationCancelled, shQuote, isAbsoluteRemotePath } from './privilegedExec';
import { acquirePermissionDialog, releasePermissionDialog } from './permissionFallback';

// A remote create rejected for lack of permission — the same shape the upload/download fallbacks use.
// ssh2 surfaces SSH_FX_PERMISSION_DENIED as numeric code 3; EACCES/EPERM are defensive aliases. FTP (no
// shell) can't be escalated, so this predicate only gates the offer — offerCreateAsRoot refuses cleanly
// on a non-SSH connection anyway.
export function isCreatePermissionDenied(err: any): boolean {
  if (!err) {
    return false;
  }
  const code = err.code;
  return code === 3 || code === 'EACCES' || code === 'EPERM';
}

// Exit status the script below reports when something already occupies the path. Mirrors POSIX EEXIST so
// it can't be confused with the shell's own failure codes (1, 2, 126, 127).
const EXIT_EXISTS = 17;

// Exit status for "the entry WAS created, only the chmod failed". Picked right next to EXIT_EXISTS and, like
// it, outside the codes an ordinary shell failure produces (1, 2, 126, 127) — so the caller can tell a
// half-done create from one that never happened, and never confuses either with a real error.
const EXIT_CHMOD_FAILED = 18;

// "Create File"/"Create Folder" was refused because the login user can't write the parent directory (the
// everyday case for /etc, /usr/local/…). Offer to create the entry AS ROOT over `su`. The result is owned
// by root:root — nothing is staged or copied, root simply creates the empty file / directory in place and
// applies filePerm/dirPerm. Editing it afterwards goes through the existing read/write-as-root fallbacks.
// Returns true when the entry was created as root. Never throws.
export async function offerCreateAsRoot(ctx: any, isDirectory: boolean): Promise<boolean> {
  // Hold the shared single-dialog gate so this modal can't stack with the per-file save-copy recovery or
  // the folder-level upload-as-root one. Released in the finally.
  if (!acquirePermissionDialog()) {
    // Another elevation dialog is already up (a per-file recovery, or an upload-as-root batch that holds
    // the gate for its whole run). Bailing out silently would end an EXPLICIT user command with no trace
    // at all — the permission error that got us here was already swallowed by the caller's catch. Say why
    // nothing happened, and log it.
    logger.warn(
      `create fallback: skipped, another elevation dialog is open: ${ctx.target && ctx.target.remoteFsPath}`
    );
    window.showWarningMessage(
      L({
        en: 'WireFerry: another root-permission dialog is already open — create it again once that one is done.',
        ru: 'WireFerry: уже открыт другой диалог повышения прав — повторите создание, когда он завершится.',
      })
    );
    return false;
  }
  try {
    return await runCreateAsRoot(ctx, isDirectory);
  } finally {
    releasePermissionDialog();
  }
}

async function runCreateAsRoot(ctx: any, isDirectory: boolean): Promise<boolean> {
  const remotePath: string = ctx.target.remoteFsPath;
  // Under `su -` the cwd is root's home, so a relative path (from a `remotePath: "./"` config) would create
  // the entry under /root instead of where the user clicked. Same guard as the other su commands.
  if (!isAbsoluteRemotePath(remotePath)) {
    window.showErrorMessage(
      L({
        en: `WireFerry: "Create as root" needs an absolute server path ("${remotePath}").`,
        ru: `WireFerry: «Создать от root» требует абсолютного пути на сервере («${remotePath}»).`,
      })
    );
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
        en: 'Creating as root needs an SSH connection with a shell (not available on FTP).',
        ru: 'Создание от root требует SSH-подключения с оболочкой (недоступно на FTP).',
      })
    );
    return false;
  }

  // Same defaults the ordinary create applies (644 / 755) when filePerm/dirPerm isn't configured, so an
  // escalated create doesn't silently land on the server's umask instead.
  const mode =
    parseOctalMode(isDirectory ? ctx.config.dirPerm : ctx.config.filePerm) ?? (isDirectory ? 0o755 : 0o644);
  const modeText = mode.toString(8).padStart(3, '0');

  const asRoot = { title: L({ en: 'Create as root', ru: 'Создать от root' }) };
  const cancel = { title: L({ en: 'Cancel', ru: 'Отмена' }), isCloseAffordance: true };
  const pick = await window.showWarningMessage(
    isDirectory
      ? L({
          en: `No permission to create the folder "${remotePath}". Create it as root?`,
          ru: `Нет прав создать папку «${remotePath}». Создать от root?`,
        })
      : L({
          en: `No permission to create "${remotePath}". Create it as root?`,
          ru: `Нет прав создать «${remotePath}». Создать от root?`,
        }),
    {
      modal: true,
      detail: isDirectory
        ? L({
            en: `Creates the empty folder as root on the server (owner root:root, mode ${modeText}). An existing path is never touched. The root password is asked only if it is not already cached for this window.`,
            ru: `Создаст пустую папку от root на сервере (владелец root:root, права ${modeText}). Существующий путь не трогается. Пароль root спросят, только если он ещё не сохранён на это окно.`,
          })
        : L({
            en: `Creates the empty file as root on the server (owner root:root, mode ${modeText}). An existing path is never touched. Saving your edits back later uses the same "apply as root" flow. The root password is asked only if it is not already cached for this window.`,
            ru: `Создаст пустой файл от root на сервере (владелец root:root, права ${modeText}). Существующий путь не трогается. Сохранение правок назад пойдёт через тот же «применить от root». Пароль root спросят, только если он ещё не сохранён на это окно.`,
          }),
    },
    asRoot,
    cancel
  );
  if (!pick || pick.title !== asRoot.title) {
    return false;
  }

  const host = ctx.config.host || '';
  const quoted = shQuote(remotePath);
  // Refuse an occupied path FIRST: `: >` would truncate an existing file (and follow a symlink to write
  // through it), which an explicit "create" must never do. `-L` catches a dangling symlink, which `-e`
  // reports as absent. `(exit N)` in a SUBSHELL, not a bare `exit`: execRoot appends its exit-code marker
  // AFTER this command, and a real `exit` would end the shell before that marker printed — the call would
  // then fail as "su failed" instead of reporting "already exists".
  // `set -C` (noclobber) closes the gap between that test and the redirect: the shell then opens with
  // O_CREAT|O_EXCL, which the kernel refuses on an existing path AND on a symlink, so a path that appears
  // between the two steps makes the create fail instead of truncating or writing through a link. Scoped to
  // a subshell so it doesn't leak into the rest of the payload. `mkdir` is already atomic that way.
  // The entry is owned by root:root simply because root creates it; only the mode needs applying.
  const createCmd = isDirectory ? `mkdir -- ${quoted}` : `(set -C; : > ${quoted})`;
  // A failed chmod must NOT be reported as a failed create: the entry already exists at this point, and the
  // ordinary create path treats a chmod error as non-fatal too (fileBaseOperations logs a warning and still
  // reports success). Give it its own status so the caller can say "created, but the mode didn't stick".
  const script =
    `if [ -e ${quoted} ] || [ -L ${quoted} ]; then (exit ${EXIT_EXISTS}); ` +
    `else ${createCmd} && { chmod ${modeText} -- ${quoted} || (exit ${EXIT_CHMOD_FAILED}); }; fi`;

  try {
    const { code, output } = await execAsRoot(remoteFs, host, script);
    if (code === EXIT_EXISTS) {
      window.showErrorMessage(
        isDirectory
          ? L({
              en: `Can't create folder because it already exists: ${remotePath}`,
              ru: `Не удаётся создать папку — она уже существует: ${remotePath}`,
            })
          : L({
              en: `Can't create file because file already exists: ${remotePath}`,
              ru: `Не удаётся создать файл — он уже существует: ${remotePath}`,
            })
      );
      return false;
    }
    if (code !== 0 && code !== EXIT_CHMOD_FAILED) {
      // Carry the server's own message (a missing parent directory, a read-only mount) instead of a bare
      // exit code — it is the only thing that says WHY root couldn't create it either.
      const reason = String(output || '').trim().slice(-200);
      window.showErrorMessage(
        L({
          en: `WireFerry: creating "${remotePath}" as root failed (exit ${code})${reason ? `: ${reason}` : ''}`,
          ru: `WireFerry: создание «${remotePath}» от root не удалось (код ${code})${reason ? `: ${reason}` : ''}`,
        })
      );
      return false;
    }
    if (code === EXIT_CHMOD_FAILED) {
      // Created, but left at the server's umask. Warn instead of failing — reporting "create failed" while
      // the entry sits on the server would send the user chasing a file that is already there (and the retry
      // would only answer "already exists").
      logger.warn(`create fallback: created "${remotePath}" as root, but chmod ${modeText} failed`);
      window.showWarningMessage(
        L({
          en: `Created "${remotePath}" as root, but couldn't set mode ${modeText} — check its permissions on the server.`,
          ru: `Создано «${remotePath}» от root, но не удалось выставить права ${modeText} — проверьте их на сервере.`,
        })
      );
    } else {
      logger.info(`create fallback: created "${remotePath}" as root on ${host || 'server'}`);
      window.showInformationMessage(
        L({ en: `Created "${remotePath}" as root.`, ru: `Создано «${remotePath}» от root.` })
      );
    }
    // The handler's afterHandle never ran (the create threw), so reveal the new entry here — same call,
    // so the tree behaves exactly like an ordinary create. Best effort: a tree hiccup must not turn a
    // successful create into an error.
    try {
      if (app.remoteExplorer) {
        await app.remoteExplorer.showCreated(ctx.target.remoteUri, isDirectory);
      }
    } catch (err) {
      logger.warn(`create fallback: tree refresh failed: ${(err && (err as Error).message) || err}`);
    }
    return true;
  } catch (e) {
    if (e instanceof ElevationCancelled) {
      return false; // user backed out of the password prompt — nothing was created
    }
    logger.error(`create-as-root failed: ${(e && (e as Error).message) || e}`, remotePath);
    window.showErrorMessage(
      L({
        en: `WireFerry: couldn't create "${remotePath}" as root — ${(e && (e as Error).message) || e}`,
        ru: `WireFerry: не удалось создать «${remotePath}» от root — ${(e && (e as Error).message) || e}`,
      })
    );
    return false;
  }
}
