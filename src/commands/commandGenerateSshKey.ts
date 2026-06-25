import * as vscode from 'vscode';
import * as os from 'os';
import * as fse from 'fs-extra';
import { parse as parseJsonc } from 'jsonc-parser';
import { COMMAND_GENERATE_SSH_KEY } from '../constants';
import { L } from '../i18n';
import {
  showInformationMessage,
  showWarningMessage,
  showErrorMessage,
  showConfirmMessage,
  isWorkspaceTrusted,
} from '../host';
import { getAllFileService } from '../modules/serviceManager';
import { resolveConfigPath } from '../modules/config';
import { ExplorerRoot } from '../modules/remoteExplorer';
import { storeCredential } from '../modules/secrets';
import {
  generateKeyPair,
  writeKeyFiles,
  deployPublicKey,
  updateSshConfig,
  testKeyAuth,
  updateProfileConfig,
  sanitizeAlias,
  uniqueKeyPath,
  KeyType,
} from '../modules/sshKeygen';
import { checkCommand } from './abstract/createCommand';

interface Target {
  fileService: any;
  config: any;
  profile?: string;
}

interface WizardChoice {
  type: KeyType;
  passphrase?: string;
}

// Generate an SSH key pair, deploy the public half to the server, register it in ~/.ssh/config, and
// switch the profile over to key auth — but only after a real key login is verified (commit after
// verify). SFTP only; local extension host only.
export default checkCommand({
  id: COMMAND_GENERATE_SSH_KEY,

  async handleCommand(root?: ExplorerRoot) {
    if (!ensureLocalExtensionHost()) {
      return;
    }

    const target = await pickTarget(root);
    if (!target) {
      return;
    }
    if (target.config.protocol !== 'sftp') {
      showErrorMessage(
        L({
          en: 'SSH key generation is only available for SFTP connections.',
          ru: 'Генерация SSH-ключа доступна только для SFTP-подключений.',
        })
      );
      return;
    }

    const choice = await askKeyChoice();
    if (!choice) {
      return;
    }

    // Decide the set of servers to provision: this one, or every profile of the same config.
    const targets = await pickServerScope(target);
    if (!targets.length) {
      return;
    }

    const results: string[] = [];
    let reloadNeeded = false;
    for (const t of targets) {
      // eslint-disable-next-line no-await-in-loop
      const outcome = await runWizardForServer(t, choice);
      results.push(outcome.line);
      reloadNeeded = reloadNeeded || outcome.reloadNeeded;
    }

    // One reload prompt for the whole batch — not one per server in an "all profiles" fan-out.
    const reload = L({ en: 'Reload window', ru: 'Перезагрузить окно' });
    const tail = reloadNeeded
      ? L({
          en: '\n\nReload the window for key auth to take effect.',
          ru: '\n\nПерезагрузите окно, чтобы вход по ключу заработал.',
        })
      : '';
    showInformationMessage(
      L({
        en: `WireFerry SSH key:\n${results.join('\n')}${tail}`,
        ru: `WireFerry SSH-ключ:\n${results.join('\n')}${tail}`,
      }),
      ...(reloadNeeded ? [reload] : [])
    ).then(answer => {
      if (answer === reload) {
        vscode.commands.executeCommand('workbench.action.reloadWindow');
      }
    });
  },
});

// vscode.env.remoteName is set in Remote-SSH / WSL / Dev Container windows, where the extension host
// (and therefore ~/.ssh and key files) lives on the remote machine — not the user's local box.
function ensureLocalExtensionHost(): boolean {
  if (!vscode.env.remoteName) {
    return true;
  }
  showWarningMessage(
    L({
      en:
        `This window runs on a remote extension host (${vscode.env.remoteName}). SSH keys would be written to that machine's ${os.homedir()}, not your local ~/.ssh. Open a local window to generate keys.`,
      ru:
        `Это окно работает на удалённом extension host (${vscode.env.remoteName}). Ключи будут записаны в ${os.homedir()} той машины, а не в ваш локальный ~/.ssh. Откройте локальное окно для генерации ключей.`,
    })
  );
  return false;
}

async function pickTarget(root?: ExplorerRoot): Promise<Target | undefined> {
  if (root && root.explorerContext) {
    const ctx = root.explorerContext as any;
    return { fileService: ctx.fileService, config: ctx.config, profile: ctx.profile };
  }

  const items = getAllFileService().reduce<Array<vscode.QuickPickItem & { target: Target }>>(
    (acc, fileService) => {
      const config = fileService.getConfig();
      if (config.protocol === 'sftp') {
        acc.push({
          label: config.name || config.host,
          description: config.host,
          target: { fileService, config },
        });
      }
      return acc;
    },
    []
  );
  if (!items.length) {
    showInformationMessage(
      L({ en: 'No SFTP servers configured.', ru: 'Нет настроенных SFTP-серверов.' })
    );
    return undefined;
  }
  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: L({ en: 'Select a server', ru: 'Выберите сервер' }),
  });
  return picked && picked.target;
}

async function askKeyChoice(): Promise<WizardChoice | undefined> {
  const ed = {
    label: 'ed25519',
    description: L({ en: 'recommended', ru: 'рекомендуется' }),
    type: 'ed25519' as KeyType,
  };
  const rsa = { label: 'rsa-4096', description: '', type: 'rsa' as KeyType };
  const typePick = await vscode.window.showQuickPick([ed, rsa], {
    placeHolder: L({ en: 'Key type', ru: 'Тип ключа' }),
  });
  if (!typePick) {
    return undefined;
  }

  const passphrase = await vscode.window.showInputBox({
    password: true,
    ignoreFocusOut: true,
    prompt: L({
      en: 'Passphrase for the new key (leave empty for none)',
      ru: 'Passphrase для нового ключа (пусто — без него)',
    }),
  });
  // Esc (undefined) cancels; empty string means "no passphrase".
  if (passphrase === undefined) {
    return undefined;
  }
  return { type: typePick.type, passphrase: passphrase || undefined };
}

// Offer to provision just this server or every profile of the same config (the owner's
// "keys for all servers in the profile" idea). Each profile may point at a different host.
async function pickServerScope(target: Target): Promise<Target[]> {
  const profiles: string[] = target.fileService.getAvailableProfiles();
  if (!profiles.length) {
    return [target];
  }

  const justThis = {
    label: L({ en: 'This server only', ru: 'Только этот сервер' }),
    all: false,
  };
  const allOfThem = {
    label: L({
      en: `All ${profiles.length} servers in this config`,
      ru: `Все серверы конфигурации (${profiles.length})`,
    }),
    all: true,
  };
  const pick = await vscode.window.showQuickPick([justThis, allOfThem], {
    placeHolder: L({ en: 'Scope', ru: 'Область' }),
  });
  if (!pick) {
    return [];
  }
  if (!pick.all) {
    return [target];
  }
  return profiles.map(profile => ({
    fileService: target.fileService,
    config: target.fileService.getConfig(profile),
    profile,
  }));
}

async function runWizardForServer(
  target: Target,
  choice: WizardChoice
): Promise<{ line: string; reloadNeeded: boolean }> {
  const { config } = target;
  const label = target.profile || config.name || config.host;
  const port = config.port || 22;
  const alias = sanitizeAlias(target.profile || config.name || config.host);

  try {
    const keyPath = await uniqueKeyPath(`wireferry_${alias}`);

    // Summary of every side effect BEFORE we touch anything (B-summary).
    const proceed = await showConfirmMessage(
      L({
        en:
          `Generate ${choice.type} key for ${config.username}@${config.host}:${port}?\n\n` +
          `• Private key: ${keyPath}\n` +
          `• Public key → server: ~/.ssh/authorized_keys\n` +
          `• SSH config: ~/.ssh/config (Host ${alias})\n` +
          `• Profile "${label}" switches to key auth after a verified login`,
        ru:
          `Создать ${choice.type}-ключ для ${config.username}@${config.host}:${port}?\n\n` +
          `• Приватный ключ: ${keyPath}\n` +
          `• Публичный ключ → сервер: ~/.ssh/authorized_keys\n` +
          `• SSH-конфиг: ~/.ssh/config (Host ${alias})\n` +
          `• Профиль «${label}» перейдёт на ключ после проверенного входа`,
      }),
      L({ en: 'Generate', ru: 'Создать' }),
      L({ en: 'Cancel', ru: 'Отмена' })
    );
    if (!proceed) {
      return { line: `• ${label}: ${L({ en: 'skipped', ru: 'пропущено' })}`, reloadNeeded: false };
    }

    const keys = await generateKeyPair({
      type: choice.type,
      comment: `wireferry ${config.username}@${config.host} ${new Date().toISOString().slice(0, 10)}`,
      passphrase: choice.passphrase,
    });
    await writeKeyFiles(keyPath, keys);

    // Deploy over the existing connection (which already traverses any hop chain).
    const remotefs = await target.fileService.getRemoteFileSystem(config);
    await deployPublicKey(remotefs, keys.public);

    // hop / jump-host: the public key is now on the server (deploy reused the hopped connection),
    // but testKeyAuth connects DIRECTLY and ~/.ssh/config can't express the jump here — so we stop
    // after deploy and let the user switch over manually instead of orphaning an unverified key.
    if (hasHopConfig(config)) {
      return {
        line: `• ${label}: ${L({
          en: 'public key deployed; hop/jump-host config — verify and switch to the key manually',
          ru: 'публичный ключ развёрнут; конфиг с hop — проверьте и переключитесь на ключ вручную',
        })}`,
        reloadNeeded: false,
      };
    }

    // Verify a real key login BEFORE touching the config / removing any password (B-CAV).
    const verified = await testKeyAuth({
      host: config.host,
      port,
      username: config.username,
      privateKey: keys.private,
      passphrase: choice.passphrase,
    });
    if (!verified) {
      return {
        line: `• ${label}: ${L({
          en: `key written to ${keyPath} but login not verified — profile left unchanged`,
          ru: `ключ записан в ${keyPath}, но вход не подтверждён — профиль не изменён`,
        })}`,
        reloadNeeded: false,
      };
    }

    // Offer to save the passphrase to the keychain so the user isn't asked every connect.
    if (choice.passphrase) {
      await maybeSavePassphrase(config, port, choice.passphrase);
    }

    // ~/.ssh/config is a convenience — a failure here (e.g. an odd path) must not lose the verified
    // key or block the profile switch, so it's best-effort.
    try {
      await updateSshConfig({
        alias,
        hostName: config.host,
        user: config.username,
        port,
        identityFile: keyPath,
        sshConfigPath: config.sshConfigPath,
      });
    } catch (e) {
      showWarningMessage(
        L({
          en: `Couldn't update ~/.ssh/config: ${errText(e)}. The profile will still use the key.`,
          ru: `Не удалось обновить ~/.ssh/config: ${errText(e)}. Профиль всё равно будет использовать ключ.`,
        })
      );
    }

    const profileUpdated = await applyProfileUpdate(target, keyPath, choice);

    return {
      line: `• ${label}: ${L({
        en: `key deployed & verified${profileUpdated ? ', profile updated' : ' (update profile manually)'}`,
        ru: `ключ развёрнут и проверен${profileUpdated ? ', профиль обновлён' : ' (обновите профиль вручную)'}`,
      })}`,
      reloadNeeded: profileUpdated,
    };
  } catch (error) {
    return {
      line: `• ${label}: ${L({ en: 'failed', ru: 'ошибка' })} — ${errText(error)}`,
      reloadNeeded: false,
    };
  }
}

// A thrown value isn't guaranteed to be an Error — guard against undefined `.message`.
function errText(e: any): string {
  return (e && e.message) || String(e) || 'unknown error';
}

function hasHopConfig(config: any): boolean {
  const hop = config && config.hop;
  if (!hop) {
    return false;
  }
  return Array.isArray(hop) ? hop.length > 0 : Object.keys(hop).length > 0;
}

async function maybeSavePassphrase(config: any, port: number, passphrase: string): Promise<void> {
  if (!isWorkspaceTrusted()) {
    return;
  }
  const save = L({ en: 'Save', ru: 'Сохранить' });
  const answer = await showInformationMessage(
    L({
      en: `Save the key passphrase for ${config.username}@${config.host} to the OS keychain?`,
      ru: `Сохранить passphrase ключа для ${config.username}@${config.host} в системном хранилище?`,
    }),
    save,
    L({ en: "Don't save", ru: 'Не сохранять' })
  );
  if (answer === save) {
    await storeCredential(
      { protocol: 'sftp', host: config.host, port, username: config.username, type: 'passphrase' },
      passphrase
    );
  }
}

// Write privateKeyPath (and clear a plaintext password where it is safe to) into the JSONC config at
// the precise node for this server. Returns false when we can't be sure which node to edit (an array
// of servers we can't match) — then we open the file and let the user finish by hand.
async function applyProfileUpdate(
  target: Target,
  keyPath: string,
  choice: WizardChoice
): Promise<boolean> {
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

  let basePath: (string | number)[] | null = null;
  if (Array.isArray(parsed)) {
    // Match the full connection identity (protocol/host/port/username), not just host+username: an
    // array can hold two servers that share host+username but differ by port or protocol. Edit only
    // on an unambiguous single match — otherwise fall through to the manual path below.
    const defaultPort = (proto: string) => (proto === 'ftp' ? 21 : 22);
    const targetProto = target.config.protocol || 'sftp';
    const targetPort = target.config.port || defaultPort(targetProto);
    const matches = parsed.filter(
      (c: any) =>
        c &&
        (c.protocol || 'sftp') === targetProto &&
        c.host === target.config.host &&
        c.username === target.config.username &&
        (c.port || defaultPort(c.protocol || 'sftp')) === targetPort
    );
    basePath = matches.length === 1 ? [parsed.indexOf(matches[0])] : null;
  } else if (parsed && parsed.profiles && target.profile) {
    basePath = ['profiles', target.profile];
  } else {
    basePath = [];
  }

  if (!basePath) {
    showWarningMessage(
      L({
        en: `Couldn't locate this server in ${filePath}. Add "privateKeyPath": "${keyPath}" manually.`,
        ru: `Не удалось найти этот сервер в ${filePath}. Добавьте "privateKeyPath": "${keyPath}" вручную.`,
      })
    );
    await vscode.window.showTextDocument(vscode.Uri.file(filePath));
    return false;
  }

  const clearPassword = await showConfirmMessage(
    L({
      en: 'Key auth verified. Remove the plaintext password from this profile now?',
      ru: 'Вход по ключу проверен. Удалить открытый пароль из этого профиля сейчас?',
    }),
    L({ en: 'Remove password', ru: 'Удалить пароль' }),
    L({ en: 'Keep it', ru: 'Оставить' })
  );

  // A profile inherits the top-level password when it has none of its own; deleting just the profile
  // key would then leave the inherited password effective. Detect that and shadow it with an explicit
  // null instead (only the profile form can inherit; arrays and single-object configs cannot).
  const profileNode =
    parsed && parsed.profiles && target.profile ? parsed.profiles[target.profile] : undefined;
  const clearInheritedPassword =
    clearPassword &&
    Array.isArray(basePath) &&
    basePath[0] === 'profiles' &&
    parsed &&
    parsed.password !== undefined &&
    !(profileNode && Object.prototype.hasOwnProperty.call(profileNode, 'password'));

  await updateProfileConfig({
    filePath,
    basePath,
    identityFile: keyPath,
    clearPassword,
    clearInheritedPassword,
    setPassphraseSentinel: !!choice.passphrase,
  });

  // The running FileService still holds the old in-memory config; the caller shows a single
  // "reload window" prompt for the whole batch once every server is done.
  return true;
}
