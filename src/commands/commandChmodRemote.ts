import { Uri, window } from 'vscode';
import { COMMAND_CHMOD_REMOTE } from '../constants';
import { upath, FileType } from '../core';
import { chmodRemote, handleCtxFromUri } from '../fileHandlers';
import { reportError } from '../helper';
import { ExplorerItem } from '../modules/remoteExplorer';
import { checkCommand } from './abstract/createCommand';
import { canElevate, execAsRoot, ElevationCancelled, shQuote, isAbsoluteRemotePath } from '../modules/privilegedExec';
import { L } from '../i18n';
import app from '../app';

// An SFTP chmod rejected for lack of permission (root-owned target). ssh2 maps
// SSH_FX_PERMISSION_DENIED to code 3; the string aliases are defensive.
function isPermissionDenied(err: any): boolean {
  const code = err && err.code;
  return code === 3 || code === 'EACCES' || code === 'EPERM';
}

// `mode & 0o777` rendered as a 3-digit octal string, e.g. 0o755 -> "755".
function toOctal(mode: number): string {
  // tslint:disable-next-line:no-bitwise
  return (mode & 0o777).toString(8).padStart(3, '0');
}

// Full 4-digit octal INCLUDING the setuid/setgid/sticky bits, for the actual `chmod` argument — the
// SFTP path preserves them, so the root fallback must not silently drop them by masking to 0o777.
function toOctalFull(mode: number): string {
  // tslint:disable-next-line:no-bitwise
  return (mode & 0o7777).toString(8).padStart(4, '0');
}

const PRESETS: Array<{ mode: number; rwx: string; hint: { en: string; ru: string } }> = [
  { mode: 0o644, rwx: 'rw-r--r--', hint: { en: 'regular files', ru: 'обычные файлы' } },
  { mode: 0o755, rwx: 'rwxr-xr-x', hint: { en: 'folders, scripts', ru: 'папки, скрипты' } },
  { mode: 0o600, rwx: 'rw-------', hint: { en: 'private', ru: 'приватные' } },
  { mode: 0o700, rwx: 'rwx------', hint: { en: 'private folder', ru: 'приватная папка' } },
  { mode: 0o777, rwx: 'rwxrwxrwx', hint: { en: 'everyone, everything', ru: 'всем всё' } },
];

// Quick-pick of common modes (with the current one marked) + a "Custom value…" escape hatch that
// opens an octal input box. Returns the chosen mode, or undefined when cancelled.
async function pickMode(currentMode: number | undefined): Promise<number | undefined> {
  const customLabel = L({ en: 'Custom value…', ru: 'Своё значение…' });
  const currentTag = L({ en: '  · current', ru: '  · текущие' });

  const items = PRESETS.map(p => ({
    label: p.mode.toString(8).padStart(3, '0'),
    // Compare only the rwx part: currentMode may carry setuid/setgid/sticky (0o7000) since the stat now
    // keeps them, but the presets are 3-digit — mask so a 4755 file still marks its 755 preset current.
    // tslint:disable-next-line:no-bitwise
    description: p.rwx + (currentMode !== undefined && (currentMode & 0o777) === p.mode ? currentTag : ''),
    detail: L(p.hint),
    mode: p.mode as number | undefined,
  }));
  items.push({ label: customLabel, description: '', detail: '', mode: undefined });

  const picked = await window.showQuickPick(items, {
    placeHolder:
      currentMode !== undefined
        ? L({ en: `Permissions (now ${toOctal(currentMode)})`, ru: `Права (сейчас ${toOctal(currentMode)})` })
        : L({ en: 'Permissions', ru: 'Права' }),
  });
  if (!picked) {
    return undefined;
  }
  if (picked.mode !== undefined) {
    return picked.mode;
  }

  const input = await window.showInputBox({
    // Prefill with 4 digits ONLY when a setuid/setgid/sticky bit is set, so editing rwx doesn't
    // silently drop it; plain files stay 3-digit to avoid a confusing leading zero.
    // tslint:disable-next-line:no-bitwise
    value:
      currentMode !== undefined
        ? currentMode & 0o7000
          ? toOctalFull(currentMode)
          : toOctal(currentMode)
        : '',
    prompt: L({ en: 'Octal permissions, e.g. 755', ru: 'Права в восьмеричном виде, напр. 755' }),
    validateInput: v =>
      /^[0-7]{3,4}$/.test((v || '').trim())
        ? undefined
        : L({
            en: 'Enter 3–4 octal digits (0–7), e.g. 644',
            ru: 'Введите 3–4 восьмеричные цифры (0–7), напр. 644',
          }),
  });
  if (input === undefined) {
    return undefined;
  }
  return parseInt(input.trim(), 8);
}

// For directories, ask whether to apply to the folder only or recurse into its contents (chmod -R).
// Returns the choice, or undefined when cancelled.
async function pickRecursive(name: string, mode: number): Promise<boolean | undefined> {
  const items = [
    { label: L({ en: 'This folder only', ru: 'Только эту папку' }), value: false, description: '' },
    {
      label: L({ en: 'Recursively (-R)', ru: 'Рекурсивно (-R)' }),
      value: true,
      description: L({ en: 'apply to all contents', ru: 'на всё содержимое' }),
    },
  ];
  const picked = await window.showQuickPick(items, {
    placeHolder: L({ en: `Apply ${toOctal(mode)} to '${name}'`, ru: `Применить ${toOctal(mode)} к «${name}»` }),
  });
  return picked ? picked.value : undefined;
}

export default checkCommand({
  id: COMMAND_CHMOD_REMOTE,
  async handleCommand(item) {
    // createCommand swallows the promise returned by handleCommand, so errors here would not reach
    // the outer catch — wrap the body ourselves and route failures through reportError.
    try {
      // Permissions target a single node — use the one under the cursor even inside a multi-selection.
      let uri: Uri | undefined;
      let isDirectory = false;
      if (item instanceof Uri) {
        uri = item;
      } else if (item && (item as ExplorerItem).resource) {
        uri = (item as ExplorerItem).resource.uri;
        isDirectory = (item as ExplorerItem).isDirectory === true;
      }
      if (!uri) {
        return;
      }

      const ctx = handleCtxFromUri(uri);
      const remoteFs = await ctx.fileService.getRemoteFileSystem(ctx.config);
      const remotePath = ctx.target.remoteFsPath;

      // Read the current mode so it can be shown as the default. Best-effort: some minimal servers
      // don't report a usable mode — fall back to no default and the tree's directory flag.
      let currentMode: number | undefined;
      try {
        const stat = await remoteFs.lstat(remotePath);
        currentMode = stat.mode;
        if (!(item && (item as ExplorerItem).resource)) {
          isDirectory = stat.type === FileType.Directory;
        }
      } catch {
        // leave currentMode undefined
      }

      const mode = await pickMode(currentMode);
      if (mode === undefined) {
        return;
      }

      let recursive = false;
      if (isDirectory) {
        const choice = await pickRecursive(upath.basename(remotePath), mode);
        if (choice === undefined) {
          return; // cancelled
        }
        recursive = choice;
      }

      try {
        await chmodRemote(ctx, { mode, recursive });
      } catch (err) {
        // Root-owned target: SFTP can't escalate. Offer to redo the chmod as root over `su -`.
        if (!isPermissionDenied(err) || !canElevate(remoteFs)) {
          throw err;
        }
        const retry = L({ en: 'Change as root', ru: 'Изменить от root' });
        const pick = await window.showWarningMessage(
          L({
            en: `No permission to change '${upath.basename(remotePath)}'. Retry as root via su?`,
            ru: `Нет прав изменить «${upath.basename(remotePath)}». Повторить от root через su?`,
          }),
          { modal: true },
          retry
        );
        if (pick !== retry) {
          return;
        }
        const host = (ctx.config as any).host || '';
        // Under `su -` a relative path resolves against /root — a recursive chmod would hit the wrong tree.
        if (!isAbsoluteRemotePath(remotePath)) {
          window.showWarningMessage(
            L({
              en: `WireFerry: can't chmod as root on a non-absolute path ("${remotePath}"). Set an absolute "remotePath".`,
              ru: `WireFerry: нельзя chmod от root по относительному пути («${remotePath}»). Задайте абсолютный "remotePath".`,
            })
          );
          return;
        }
        const cmd = `chmod ${recursive ? '-R ' : ''}-- ${toOctalFull(mode)} ${shQuote(remotePath)}`;
        const { code, output } = await execAsRoot(remoteFs, host, cmd);
        if (code !== 0) {
          window.showErrorMessage(
            L({
              en: `WireFerry: chmod exited with ${code}${output ? ` — ${output.trim().slice(-160)}` : ''}`,
              ru: `WireFerry: chmod завершился с кодом ${code}${output ? ` — ${output.trim().slice(-160)}` : ''}`,
            })
          );
          return;
        }
      }
      if (item && (item as ExplorerItem).resource) {
        const it = item as ExplorerItem;
        it.mode = mode;
        if (app.remoteExplorer) {
          if (recursive) {
            // chmod -R changed the mode of every descendant too; refreshItem only repaints this node and
            // leaves children with stale RO decorations. Re-read the subtree so their write hints reset.
            app.remoteExplorer.refresh();
          } else {
            app.remoteExplorer.refreshItem(it);
            // Permission bits changed → recompute the write hint + repaint the RO decoration now, so it
            // doesn't stay stale until the folder is re-expanded.
            app.remoteExplorer.recomputeWriteHint(it);
          }
        }
      }

      window.showInformationMessage(
        recursive
          ? L({
              en: `Permissions set to ${toOctal(mode)} (recursively)`,
              ru: `Права изменены на ${toOctal(mode)} (рекурсивно)`,
            })
          : L({ en: `Permissions set to ${toOctal(mode)}`, ru: `Права изменены на ${toOctal(mode)}` })
      );
    } catch (error) {
      if (error instanceof ElevationCancelled) {
        return; // user backed out of the root-password prompt
      }
      reportError(error);
    }
  },
});
