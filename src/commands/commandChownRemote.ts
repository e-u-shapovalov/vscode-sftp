import { Uri, window } from 'vscode';
import { COMMAND_CHOWN_REMOTE } from '../constants';
import { upath, FileType } from '../core';
import { handleCtxFromUri } from '../fileHandlers';
import { reportError } from '../helper';
import { ExplorerItem } from '../modules/remoteExplorer';
import { checkCommand } from './abstract/createCommand';
import { canElevate, execAsRoot, ElevationCancelled, shQuote } from '../modules/privilegedExec';
import { L } from '../i18n';
import app from '../app';

// Owner or owner:group or :group, made of the characters that are actually legal in POSIX
// user/group names (letters, digits, dot, underscore, dash, and a trailing `$` for Samba machine
// accounts). Anything else is rejected before it reaches the shell; shQuote is the second line of
// defence. At least an owner OR a `:group` must be present.
const OWNER_SPEC = /^(?:[a-zA-Z0-9._$-]+)?(?::[a-zA-Z0-9._$-]+)?$/;

// Ask for a new "owner:group" (owner-only and ":group"-only are valid), pre-filled with the current
// ownership. Returns the trimmed spec, or undefined when cancelled.
async function pickOwnerSpec(current: string, name: string): Promise<string | undefined> {
  const input = await window.showInputBox({
    ignoreFocusOut: true,
    value: current,
    valueSelection: current ? [0, current.length] : undefined,
    title: L({ en: `Change owner of '${name}'`, ru: `Сменить владельца «${name}»` }),
    prompt: L({
      en: 'owner, owner:group, or :group — applied with chown as root',
      ru: 'владелец, владелец:группа или :группа — применяется chown от root',
    }),
    validateInput: v => {
      const t = (v || '').trim();
      if (!t || t === ':') {
        return L({ en: 'Enter an owner and/or :group', ru: 'Укажите владельца и/или :группу' });
      }
      return OWNER_SPEC.test(t)
        ? undefined
        : L({
            en: 'Use letters, digits, . _ - only, e.g. root:www-data',
            ru: 'Только буквы, цифры, . _ - , напр. root:www-data',
          });
    },
  });
  return input === undefined ? undefined : input.trim();
}

// For directories, offer chown -R. Returns the choice, or undefined when cancelled.
async function pickRecursive(name: string, spec: string): Promise<boolean | undefined> {
  const picked = await window.showQuickPick(
    [
      { label: L({ en: 'This item only', ru: 'Только этот объект' }), value: false, description: '' },
      {
        label: L({ en: 'Recursively (-R)', ru: 'Рекурсивно (-R)' }),
        value: true,
        description: L({ en: 'apply to all contents', ru: 'на всё содержимое' }),
      },
    ],
    {
      placeHolder: L({
        en: `Set owner ${spec} on '${name}'`,
        ru: `Владелец ${spec} для «${name}»`,
      }),
    }
  );
  return picked ? picked.value : undefined;
}

export default checkCommand({
  id: COMMAND_CHOWN_REMOTE,
  async handleCommand(item) {
    // createCommand swallows the returned promise, so route our own failures to reportError.
    try {
      let uri: Uri | undefined;
      let isDirectory = false;
      let curOwner: string | undefined;
      let curGroup: string | undefined;
      if (item instanceof Uri) {
        uri = item;
      } else if (item && (item as ExplorerItem).resource) {
        const it = item as ExplorerItem;
        uri = it.resource.uri;
        isDirectory = it.isDirectory === true;
        curOwner = it.owner || (typeof it.uid === 'number' ? String(it.uid) : undefined);
        curGroup = it.group || (typeof it.gid === 'number' ? String(it.gid) : undefined);
      }
      if (!uri) {
        return;
      }

      const ctx = handleCtxFromUri(uri);
      const remoteFs = await ctx.fileService.getRemoteFileSystem(ctx.config);
      const remotePath = ctx.target.remoteFsPath;
      const host = (ctx.config as any).host || '';

      if (!canElevate(remoteFs)) {
        window.showWarningMessage(
          L({
            en: 'Changing ownership needs an SSH connection with a shell (not available on FTP).',
            ru: 'Смена владельца требует SSH-подключения с оболочкой (недоступно на FTP).',
          })
        );
        return;
      }

      // Fill in the current owner/group (and file-vs-dir) from the server when the tree didn't carry it.
      if (curOwner === undefined || curGroup === undefined || item instanceof Uri) {
        try {
          const stat = await remoteFs.lstat(remotePath);
          if (curOwner === undefined && typeof stat.uid === 'number') {
            curOwner = String(stat.uid);
          }
          if (curGroup === undefined && typeof stat.gid === 'number') {
            curGroup = String(stat.gid);
          }
          if (item instanceof Uri) {
            isDirectory = stat.type === FileType.Directory;
          }
        } catch {
          // leave defaults empty — the user can still type a spec
        }
      }

      const current = curOwner ? (curGroup ? `${curOwner}:${curGroup}` : curOwner) : '';
      const spec = await pickOwnerSpec(current, upath.basename(remotePath));
      if (spec === undefined) {
        return;
      }

      let recursive = false;
      if (isDirectory) {
        const choice = await pickRecursive(upath.basename(remotePath), spec);
        if (choice === undefined) {
          return;
        }
        recursive = choice;
      }

      const cmd = `chown ${recursive ? '-R ' : ''}-- ${shQuote(spec)} ${shQuote(remotePath)}`;
      const { code, output } = await execAsRoot(remoteFs, host, cmd);
      if (code !== 0) {
        window.showErrorMessage(
          L({
            en: `WireFerry: chown exited with ${code}${output ? ` — ${output.trim().slice(-160)}` : ''}`,
            ru: `WireFerry: chown завершился с кодом ${code}${output ? ` — ${output.trim().slice(-160)}` : ''}`,
          })
        );
        return;
      }

      // Reflect the new ownership on the tree item so the tooltip is right without a full refresh.
      if (item && (item as ExplorerItem).resource) {
        const it = item as ExplorerItem;
        const [o, g] = spec.split(':');
        if (o) {
          it.owner = o;
        }
        if (g) {
          it.group = g;
        }
        // We changed ownership by NAME, so the numeric uid/gid the hint needs are now unknown — drop
        // BOTH so `recomputeWriteHint` clears the hint (rather than deciding via a stale id) until the
        // next listing re-reads the real numbers from the server.
        it.uid = undefined;
        it.gid = undefined;
        if (app.remoteExplorer) {
          app.remoteExplorer.refreshItem(it);
          // Ownership changed → recompute the write hint + repaint the RO decoration now (the new numeric
          // uid/gid are unknown after chown, so the hint clears until the next listing re-reads them).
          app.remoteExplorer.recomputeWriteHint(it);
        }
      }

      window.showInformationMessage(
        recursive
          ? L({ en: `Owner set to ${spec} (recursively)`, ru: `Владелец изменён на ${spec} (рекурсивно)` })
          : L({ en: `Owner set to ${spec}`, ru: `Владелец изменён на ${spec}` })
      );
    } catch (error) {
      if (error instanceof ElevationCancelled) {
        return; // user backed out of the password prompt
      }
      reportError(error);
    }
  },
});
