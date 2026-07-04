import { window, env } from 'vscode';
import { TransferTask, fileOperations } from '../core';
import { TransferDirection } from '../core/transferTask';
import logger from '../logger';
import { L } from '../i18n';
import { canElevate, execAsRoot, ElevationCancelled, shQuote } from './privilegedExec';

// Only one recovery dialog at a time. A batch upload (a whole folder of root-owned files) can throw
// many permission errors back-to-back; we open one dialog and quietly log the rest of that wave so
// the user isn't buried under modal windows. Set synchronously (before the first await) so the guard
// holds across the concurrent afterTransfer callbacks the scheduler fires.
let dialogActive = false;

// A remote SFTP write rejected for lack of permission. ssh2 surfaces SSH_FX_PERMISSION_DENIED as the
// numeric code 3; the EACCES/EPERM aliases are defensive (a future fs layer could map to them). FTP's
// 550/553 are deliberately excluded — the recovery hands back a shell command, which is meaningless
// on a pure-FTP server with no shell.
function isPermissionDenied(err: any): boolean {
  if (!err) {
    return false;
  }
  const code = err.code;
  return code === 3 || code === 'EACCES' || code === 'EPERM';
}

// Synchronous predicate the afterTransfer hook uses to decide whether to take this path instead of
// the plain error toast. Kept separate from the async runner so the hook can branch without awaiting.
export function isUploadPermissionError(task: TransferTask, err: any): boolean {
  return (
    task.transferType === TransferDirection.LOCAL_TO_REMOTE &&
    !task.isCancelled() &&
    isPermissionDenied(err)
  );
}

// Basename of a remote (always POSIX) path, tolerant of trailing slashes.
function remoteBasename(p: string): string {
  const trimmed = p.replace(/\/+$/, '');
  const idx = trimmed.lastIndexOf('/');
  return idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
}

// File permission bits as a 3-digit octal string (e.g. 0o100644 -> "644").
function modeToOctal(mode: number): string {
  // tslint:disable-next-line no-bitwise
  return (mode & 0o777).toString(8).padStart(3, '0');
}

// Entry point from the afterTransfer hook (fire-and-forget). Resolves once the user has dealt with
// the dialog; never rejects. Returns nothing — the hook already decided to take this branch via
// isUploadPermissionError, so the bare error toast is suppressed regardless of the outcome here.
export async function offerSaveCopyOnPermissionDenied(
  task: TransferTask,
  err: any
): Promise<void> {
  if (dialogActive) {
    logger.error(
      `permission denied (suppressed, recovery dialog already open): ${err && err.message}`,
      task.targetFsPath
    );
    return;
  }
  dialogActive = true;
  try {
    await runFallbackFlow(task);
  } catch (e) {
    logger.error(`permission-denied recovery failed: ${(e && e.message) || e}`, task.targetFsPath);
    window.showErrorMessage(
      L({
        en: `WireFerry: couldn't save the copy — ${(e && e.message) || e}`,
        ru: `WireFerry: не удалось сохранить копию — ${(e && e.message) || e}`,
      })
    );
  } finally {
    dialogActive = false;
  }
}

async function runFallbackFlow(task: TransferTask): Promise<void> {
  const srcFs = task.srcFs; // local
  const targetFs = task.targetFs; // remote
  const localPath = task.srcFsPath;
  const remotePath = task.targetFsPath;
  const host = task.remoteHost;
  const base = remoteBasename(remotePath);

  // Best-effort: show the target's current mode so the user understands WHY it's read-only. Reading
  // the perms can itself be denied (no x on a parent dir) — fall back to omitting them.
  let permText = '';
  try {
    const stat = await targetFs.lstat(remotePath);
    permText = modeToOctal(stat.mode);
  } catch {
    // mode stays unknown — the prompt simply won't mention it.
  }

  const suggested = `/tmp/${base}`;
  const dest = await window.showInputBox({
    ignoreFocusOut: true,
    title: L({
      en: 'No write permission — save the edited copy elsewhere',
      ru: 'Нет прав на запись — сохранить изменённую копию в другое место',
    }),
    prompt: permText
      ? L({
          en: `You can't write "${remotePath}" (mode ${permText}). Where on the server should the edited copy go? You can then apply it as root.`,
          ru: `Нет прав записать «${remotePath}» (права ${permText}). Куда на сервере сохранить изменённую копию? Потом примените её от root.`,
        })
      : L({
          en: `You can't write "${remotePath}". Where on the server should the edited copy go? You can then apply it as root.`,
          ru: `Нет прав записать «${remotePath}». Куда на сервере сохранить изменённую копию? Потом примените её от root.`,
        }),
    value: suggested,
    validateInput: value => {
      const v = (value || '').trim();
      if (!v) {
        return L({ en: 'Enter a destination path', ru: 'Укажите путь для сохранения' });
      }
      // The copy is written over SFTP (relative to the login user's home) but applied by `su -` (whose
      // cwd is root's home) — a relative path would resolve differently on each side. Require absolute.
      if (!v.startsWith('/')) {
        return L({
          en: 'Use an absolute path (starting with /)',
          ru: 'Укажите абсолютный путь (начинается с /)',
        });
      }
      if (v === remotePath) {
        return L({
          en: 'That is the path you have no access to — pick a writable one',
          ru: 'Это и есть путь без доступа — выберите путь, куда можно писать',
        });
      }
      return undefined;
    },
  });

  if (!dest) {
    // Cancelled (Esc / empty) — leave the failure logged, nothing more to do.
    return;
  }
  const destPath = dest.trim();

  // Stream the untouched local source straight to the chosen path on the SAME server connection.
  await fileOperations.transferFile(localPath, destPath, srcFs, targetFs);
  logger.info(
    `permission fallback: saved "${localPath}" to "${destPath}" on ${host || 'server'}`,
    remotePath
  );

  // One pasteable line that applies the copy and cleans the staging file up afterwards. `--` guards
  // paths that begin with `-`; the `>` redirect keeps the target's existing owner and mode.
  const applyCmd = `cat -- ${shQuote(destPath)} > ${shQuote(remotePath)} && rm -fv -- ${shQuote(destPath)}`;

  // Offer to run it for the user via `su -` when the connection has a shell (SFTP). On FTP there's
  // no shell, so we only hand back the command to run elsewhere.
  const applyAsRoot = L({ en: 'Apply as root now', ru: 'Применить от root сейчас' });
  const copyCmd = L({ en: 'Copy command', ru: 'Копировать команду' });
  const copyPath = L({ en: 'Copy path', ru: 'Копировать путь' });
  const actions = canElevate(targetFs)
    ? [applyAsRoot, copyCmd, copyPath]
    : [copyCmd, copyPath];

  const choice = await window.showInformationMessage(
    L({
      en: `Saved to ${destPath}${host ? ` on ${host}` : ''}. Apply it as root now, or run this on the server yourself:`,
      ru: `Сохранено в ${destPath}${host ? ` на ${host}` : ''}. Применить от root сейчас или выполнить это на сервере вручную:`,
    }),
    { modal: true, detail: applyCmd },
    ...actions
  );

  if (choice === applyAsRoot) {
    await applyViaRoot(task, applyCmd, remotePath, host);
  } else if (choice === copyCmd) {
    await env.clipboard.writeText(applyCmd);
  } else if (choice === copyPath) {
    await env.clipboard.writeText(destPath);
  }
}

// Run the apply one-liner as root over `su -`, prompting for the root password. Reports success or
// failure inline; a cancelled password prompt is a silent no-op (the staged copy + command remain,
// so the user can still apply it by hand).
async function applyViaRoot(
  task: TransferTask,
  applyCmd: string,
  remotePath: string,
  host: string | undefined
): Promise<void> {
  try {
    const { code } = await execAsRoot(task.targetFs, host || '', applyCmd);
    if (code === 0) {
      window.showInformationMessage(
        L({
          en: `Applied to ${remotePath} as root.`,
          ru: `Применено к ${remotePath} от root.`,
        })
      );
    } else {
      window.showErrorMessage(
        L({
          en: `WireFerry: the apply command exited with ${code}. The staged copy is still on the server.`,
          ru: `WireFerry: команда применения завершилась с кодом ${code}. Промежуточная копия осталась на сервере.`,
        })
      );
    }
  } catch (e) {
    if (e instanceof ElevationCancelled) {
      return; // user backed out — staged copy + command stay available
    }
    logger.error(`apply-as-root failed: ${(e && (e as Error).message) || e}`, remotePath);
    window.showErrorMessage(
      L({
        en: `WireFerry: couldn't apply as root — ${(e && (e as Error).message) || e}`,
        ru: `WireFerry: не удалось применить от root — ${(e && (e as Error).message) || e}`,
      })
    );
  }
}
