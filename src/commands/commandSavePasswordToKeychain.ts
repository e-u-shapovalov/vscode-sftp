import * as vscode from 'vscode';
import * as fse from 'fs-extra';
import { parse as parseJsonc } from 'jsonc-parser';
import { COMMAND_SAVE_PASSWORD_TO_KEYCHAIN } from '../constants';
import { L } from '../i18n';
import {
  showInformationMessage,
  showWarningMessage,
  showConfirmMessage,
  isWorkspaceTrusted,
} from '../host';
import { getAllFileService } from '../modules/serviceManager';
import { resolveConfigPath } from '../modules/config';
import { ExplorerRoot } from '../modules/remoteExplorer';
import { storeCredential } from '../modules/secrets';
import { resolveServerBasePath, setProfileField } from '../modules/sshKeygen';
import { checkCommand } from './abstract/createCommand';

interface Target {
  fileService: any;
  config: any;
  profile?: string;
}

// Store a server's password in the OS keychain and switch its config to "password": "secretStorage"
// in one step — the right-click counterpart to hand-editing the sentinel. SFTP/FTP only (local has
// no auth); needs a trusted workspace because it writes to the keychain.
export default checkCommand({
  id: COMMAND_SAVE_PASSWORD_TO_KEYCHAIN,

  async handleCommand(root?: ExplorerRoot) {
    if (!isWorkspaceTrusted()) {
      showWarningMessage(
        L({
          en: 'Saving a password to the OS keychain needs a trusted workspace.',
          ru: 'Для сохранения пароля в системном хранилище нужно доверенное рабочее пространство.',
        })
      );
      return;
    }

    const target = await pickTarget(root);
    if (!target) {
      return;
    }
    if (target.config.protocol !== 'sftp' && target.config.protocol !== 'ftp') {
      showWarningMessage(
        L({
          en: 'Keychain passwords are only available for SFTP/FTP servers.',
          ru: 'Пароли в хранилище доступны только для SFTP/FTP-серверов.',
        })
      );
      return;
    }

    const password = await vscode.window.showInputBox({
      password: true,
      ignoreFocusOut: true,
      prompt: L({
        en: `Password for ${target.config.username}@${target.config.host} — saved to the OS keychain`,
        ru: `Пароль для ${target.config.username}@${target.config.host} — сохранится в системном хранилище`,
      }),
    });
    // Esc (undefined) cancels; an empty string would store nothing useful.
    if (password === undefined) {
      return;
    }
    if (password === '') {
      showWarningMessage(
        L({ en: 'Empty password — nothing saved.', ru: 'Пустой пароль — ничего не сохранено.' })
      );
      return;
    }

    const port = target.config.port || (target.config.protocol === 'ftp' ? 21 : 22);
    await storeCredential(
      {
        protocol: target.config.protocol,
        host: target.config.host,
        port,
        username: target.config.username,
        type: 'password',
      },
      password
    );

    const switched = await pointConfigAtKeychain(target);

    const reload = L({ en: 'Reload window', ru: 'Перезагрузить окно' });
    const tail = switched
      ? L({
          en: '\n\nReload the window for it to take effect.',
          ru: '\n\nПерезагрузите окно, чтобы изменение вступило в силу.',
        })
      : L({
          en: '\n\nSet "password": "secretStorage" for this server in the config to use it.',
          ru: '\n\nЧтобы использовать его, задайте серверу "password": "secretStorage" в конфиге.',
        });
    showInformationMessage(
      L({
        en: `WireFerry: password saved to the OS keychain for ${target.config.username}@${target.config.host}.${tail}`,
        ru: `WireFerry: пароль сохранён в системном хранилище для ${target.config.username}@${target.config.host}.${tail}`,
      }),
      ...(switched ? [reload] : [])
    ).then(answer => {
      if (answer === reload) {
        vscode.commands.executeCommand('workbench.action.reloadWindow');
      }
    });
  },
});

async function pickTarget(root?: ExplorerRoot): Promise<Target | undefined> {
  if (root && root.explorerContext) {
    const ctx = root.explorerContext as any;
    return { fileService: ctx.fileService, config: ctx.config, profile: ctx.profile };
  }

  const items = getAllFileService().reduce<Array<vscode.QuickPickItem & { target: Target }>>(
    (acc, fileService) => {
      const config = fileService.getConfig();
      if (config.protocol === 'sftp' || config.protocol === 'ftp') {
        acc.push({
          label: config.name || config.host,
          description: `${config.host} · ${String(config.protocol).toUpperCase()}`,
          target: { fileService, config },
        });
      }
      return acc;
    },
    []
  );
  if (!items.length) {
    showInformationMessage(
      L({ en: 'No SFTP/FTP servers configured.', ru: 'Нет настроенных SFTP/FTP-серверов.' })
    );
    return undefined;
  }
  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: L({ en: 'Select a server', ru: 'Выберите сервер' }),
  });
  return picked && picked.target;
}

// Write "password": "secretStorage" at this server's JSONC node so the next connect reads the
// keychain. Returns false when the node can't be located (an array config with no single match) —
// then the file is opened for the user to finish by hand.
async function pointConfigAtKeychain(target: Target): Promise<boolean> {
  const filePath = await resolveConfigPath(target.fileService.workspace);
  if (!filePath) {
    return false;
  }

  let parsed: any;
  try {
    parsed = parseJsonc(await fse.readFile(filePath, 'utf8'));
  } catch {
    return false;
  }

  const basePath = resolveServerBasePath(parsed, target);
  if (!basePath) {
    showWarningMessage(
      L({
        en: `Couldn't locate this server in ${filePath}. Set "password": "secretStorage" manually.`,
        ru: `Не удалось найти этот сервер в ${filePath}. Задайте "password": "secretStorage" вручную.`,
      })
    );
    await vscode.window.showTextDocument(vscode.Uri.file(filePath));
    return false;
  }

  await setProfileField(filePath, basePath, 'password', 'secretStorage');

  // ssh2 tries the key before the password, so a keychain password won't take effect while the
  // server still has a key. If it does, offer to drop the key — that makes this a clean switch from
  // key auth back to password (the counterpart to "Generate SSH Key" removing the password).
  if (target.config.privateKeyPath) {
    const removeKey = await showConfirmMessage(
      L({
        en:
          'This server logs in with an SSH key, which takes priority over a password. Remove the key so it uses the keychain password?',
        ru:
          'Этот сервер входит по SSH-ключу, а ключ приоритетнее пароля. Убрать ключ, чтобы использовался пароль из хранилища?',
      }),
      L({ en: 'Remove key', ru: 'Убрать ключ' }),
      L({ en: 'Keep key', ru: 'Оставить ключ' })
    );
    if (removeKey) {
      // Delete the key when this node owns it; when it is inherited from a top-level field, write an
      // explicit null so the inherited path can't apply (deleting the node key alone wouldn't shadow it).
      const node = nodeAt(parsed, basePath);
      const ownsKey = !!node && Object.prototype.hasOwnProperty.call(node, 'privateKeyPath');
      await setProfileField(filePath, basePath, 'privateKeyPath', ownsKey ? undefined : null);
    }
  }
  return true;
}

// The raw JSONC object a basePath points at, used to tell an owned field from an inherited one.
function nodeAt(parsed: any, basePath: (string | number)[]): any {
  if (basePath.length === 0) {
    return parsed;
  }
  if (basePath[0] === 'profiles') {
    return parsed && parsed.profiles ? parsed.profiles[basePath[1] as string] : undefined;
  }
  return Array.isArray(parsed) ? parsed[basePath[0] as number] : undefined;
}
