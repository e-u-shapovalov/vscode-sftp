import * as vscode from 'vscode';
import * as path from 'path';
import * as fse from 'fs-extra';
import * as ssh2 from 'ssh2';
import * as Ftp from 'ftp';
import app from '../../app';
import { L } from '../../i18n';
import { replaceHomePath } from '../../helper';
import { CONFIG_PATH } from '../../constants';
import {
  showErrorMessage,
  showInformationMessage,
  isWorkspaceTrusted,
} from '../../host';
import { readConfigsFromFile } from '../config';
import {
  createFileService,
  disposeFileService,
  findAllFileService,
  refreshConfigContext,
} from '../serviceManager';
import { storeCredential } from '../secrets';
import {
  generateKeyPair,
  writeKeyFiles,
  deployPublicKey,
  testKeyAuth,
  uniqueKeyPath,
  sanitizeAlias,
} from '../sshKeygen';
import { MultiStepInput } from './multiStepInput';

type Protocol = 'sftp' | 'ftp';
type AuthMethod = 'key' | 'keychain' | 'plaintext';
type KeySource = 'generate' | 'existing';

interface WizardState {
  protocol: Protocol;
  host: string;
  port: number;
  username: string;
  remotePath: string;
  authMethod: AuthMethod;
  keySource?: KeySource;
  // Plaintext value the user typed: stored in the config (plaintext), saved to the keychain
  // (keychain), or used once to bootstrap a key login (key/generate).
  password?: string;
  privateKeyPath?: string; // existing-key path, or the path of the key we just generated
  passphrase?: string;
  // Step counter shown in the QuickInput header; the key branch is longer, so it is bumped once the
  // auth method is known.
  totalSteps: number;
}

const READY_TIMEOUT = 15000;

// Entry point for "Create Configuration": a guided wizard that collects connection details, verifies
// a real login, then writes .vscode/wireferry.json and brings the server online — no hand-editing of
// JSON for the first server. Called from commandConfig when the workspace has no config yet.
export async function runConfigWizard(workspace: string): Promise<void> {
  const state: Partial<WizardState> = { totalSteps: 7 };

  const completed = await MultiStepInput.run(input => pickProtocol(input, state));
  if (!completed) {
    return; // cancelled with Esc
  }

  try {
    await finalize(state as WizardState, workspace);
  } catch (error) {
    showErrorMessage(
      L({
        en: `WireFerry: setup failed — ${errText(error)}`,
        ru: `WireFerry: настройка не удалась — ${errText(error)}`,
      })
    );
  }
}

// --- wizard steps ------------------------------------------------------------------------------

const title = () => L({ en: 'New WireFerry server', ru: 'Новый сервер WireFerry' });

async function pickProtocol(input: MultiStepInput, state: Partial<WizardState>) {
  const sftp: vscode.QuickPickItem = {
    label: 'SFTP',
    description: L({ en: 'SSH — recommended', ru: 'SSH — рекомендуется' }),
  };
  const ftp: vscode.QuickPickItem = { label: 'FTP', description: 'FTP / FTPS' };
  const pick = await input.showQuickPick({
    title: title(),
    step: 1,
    totalSteps: state.totalSteps!,
    items: [sftp, ftp],
    activeItem: state.protocol === 'ftp' ? ftp : sftp,
    placeholder: L({ en: 'Protocol', ru: 'Протокол' }),
  });
  state.protocol = pick.label === 'FTP' ? 'ftp' : 'sftp';
  // Keep an FTP run out of the SFTP-only key branch even if the user backed up and switched protocol.
  if (state.protocol === 'ftp' && state.authMethod === 'key') {
    state.authMethod = undefined;
  }
  return (next: MultiStepInput) => inputHost(next, state);
}

async function inputHost(input: MultiStepInput, state: Partial<WizardState>) {
  state.host = await input.showInputBox({
    title: title(),
    step: 2,
    totalSteps: state.totalSteps!,
    value: state.host || '',
    prompt: L({ en: 'Server host or IP address', ru: 'Хост или IP-адрес сервера' }),
    placeholder: 'example.com / 192.168.0.1',
    validate: required,
  });
  return (next: MultiStepInput) => inputPort(next, state);
}

async function inputPort(input: MultiStepInput, state: Partial<WizardState>) {
  const fallback = state.protocol === 'ftp' ? 21 : 22;
  const value = await input.showInputBox({
    title: title(),
    step: 3,
    totalSteps: state.totalSteps!,
    value: state.port ? String(state.port) : String(fallback),
    prompt: L({ en: 'Port', ru: 'Порт' }),
    validate: validatePort,
  });
  state.port = parseInt(value, 10);
  return (next: MultiStepInput) => inputUsername(next, state);
}

async function inputUsername(input: MultiStepInput, state: Partial<WizardState>) {
  state.username = await input.showInputBox({
    title: title(),
    step: 4,
    totalSteps: state.totalSteps!,
    value: state.username || '',
    prompt: L({ en: 'Username', ru: 'Имя пользователя' }),
    validate: required,
  });
  return (next: MultiStepInput) => inputRemotePath(next, state);
}

async function inputRemotePath(input: MultiStepInput, state: Partial<WizardState>) {
  state.remotePath = await input.showInputBox({
    title: title(),
    step: 5,
    totalSteps: state.totalSteps!,
    value: state.remotePath || '/',
    prompt: L({ en: 'Remote base path on the server', ru: 'Базовый путь на сервере' }),
    placeholder: '/var/www/',
    validate: required,
  });
  return (next: MultiStepInput) => pickAuthMethod(next, state);
}

async function pickAuthMethod(input: MultiStepInput, state: Partial<WizardState>) {
  const key: vscode.QuickPickItem = {
    label: '$(key) ' + L({ en: 'SSH key', ru: 'SSH-ключ' }),
    description: L({ en: 'recommended', ru: 'рекомендуется' }),
  };
  const keychain: vscode.QuickPickItem = {
    label: '$(shield) ' + L({ en: 'OS keychain', ru: 'Хранилище ОС (Windows)' }),
    description: L({ en: 'password saved in the OS keychain', ru: 'пароль в системном хранилище' }),
  };
  const plaintext: vscode.QuickPickItem = {
    label: '$(file) ' + L({ en: 'Plaintext', ru: 'Открытым текстом' }),
    description: L({ en: 'password stored in the config file', ru: 'пароль в файле конфигурации' }),
  };
  // SSH keys are SFTP-only; FTP gets keychain / plaintext.
  const items = state.protocol === 'sftp' ? [key, keychain, plaintext] : [keychain, plaintext];
  const pick = await input.showQuickPick({
    title: title(),
    step: 6,
    totalSteps: state.totalSteps!,
    items,
    placeholder: L({ en: 'How to store the password', ru: 'Как хранить пароль' }),
  });

  if (pick === key) {
    state.authMethod = 'key';
    state.totalSteps = 9;
    return (next: MultiStepInput) => pickKeySource(next, state);
  }
  state.authMethod = pick === keychain ? 'keychain' : 'plaintext';
  state.totalSteps = 7;
  return (next: MultiStepInput) => inputPassword(next, state);
}

async function inputPassword(input: MultiStepInput, state: Partial<WizardState>) {
  state.password = await input.showInputBox({
    title: title(),
    step: 7,
    totalSteps: state.totalSteps!,
    value: '',
    password: true,
    prompt:
      state.authMethod === 'keychain'
        ? L({
            en: 'Password — saved to the OS keychain',
            ru: 'Пароль — сохранится в системном хранилище',
          })
        : L({
            en: 'Password — stored in the config file',
            ru: 'Пароль — будет в файле конфигурации',
          }),
    validate: required,
  });
  return undefined; // last step
}

async function pickKeySource(input: MultiStepInput, state: Partial<WizardState>) {
  const generate: vscode.QuickPickItem = {
    label: '$(add) ' + L({ en: 'Generate a new key', ru: 'Сгенерировать новый ключ' }),
    description: L({
      en: 'log in with the password once, then switch to the key',
      ru: 'войти по паролю один раз, затем перейти на ключ',
    }),
  };
  const existing: vscode.QuickPickItem = {
    label: '$(folder-opened) ' + L({ en: 'Use an existing key', ru: 'Указать существующий ключ' }),
    description: L({ en: 'point at a private key file', ru: 'путь к файлу приватного ключа' }),
  };
  const pick = await input.showQuickPick({
    title: title(),
    step: 7,
    totalSteps: state.totalSteps!,
    items: [generate, existing],
    placeholder: L({ en: 'SSH key', ru: 'SSH-ключ' }),
  });
  if (pick === generate) {
    state.keySource = 'generate';
    return (next: MultiStepInput) => inputBootstrapPassword(next, state);
  }
  state.keySource = 'existing';
  return (next: MultiStepInput) => inputKeyPath(next, state);
}

async function inputBootstrapPassword(input: MultiStepInput, state: Partial<WizardState>) {
  state.password = await input.showInputBox({
    title: title(),
    step: 8,
    totalSteps: state.totalSteps!,
    value: '',
    password: true,
    prompt: L({
      en: 'Password (used once to log in and deploy the new key)',
      ru: 'Пароль (нужен один раз для входа и развёртывания ключа)',
    }),
    validate: required,
  });
  return (next: MultiStepInput) => inputNewKeyPassphrase(next, state);
}

async function inputNewKeyPassphrase(input: MultiStepInput, state: Partial<WizardState>) {
  const value = await input.showInputBox({
    title: title(),
    step: 9,
    totalSteps: state.totalSteps!,
    value: '',
    password: true,
    prompt: L({
      en: 'Passphrase for the new key (leave empty for none)',
      ru: 'Passphrase для нового ключа (пусто — без него)',
    }),
  });
  state.passphrase = value || undefined;
  return undefined; // last step
}

async function inputKeyPath(input: MultiStepInput, state: Partial<WizardState>) {
  state.privateKeyPath = await input.showInputBox({
    title: title(),
    step: 8,
    totalSteps: state.totalSteps!,
    value: state.privateKeyPath || '~/.ssh/id_ed25519',
    prompt: L({ en: 'Path to the private key', ru: 'Путь к приватному ключу' }),
    validate: validateKeyPath,
  });
  return (next: MultiStepInput) => inputExistingKeyPassphrase(next, state);
}

async function inputExistingKeyPassphrase(input: MultiStepInput, state: Partial<WizardState>) {
  const value = await input.showInputBox({
    title: title(),
    step: 9,
    totalSteps: state.totalSteps!,
    value: '',
    password: true,
    prompt: L({
      en: 'Key passphrase (leave empty if the key has none)',
      ru: 'Passphrase ключа (пусто, если его нет)',
    }),
  });
  state.passphrase = value || undefined;
  return undefined;
}

// --- validation --------------------------------------------------------------------------------

function required(value: string): string | undefined {
  return value && value.trim() ? undefined : L({ en: 'Required', ru: 'Обязательное поле' });
}

function validatePort(value: string): string | undefined {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    return L({ en: 'Enter a port (1–65535)', ru: 'Введите порт (1–65535)' });
  }
  return undefined;
}

async function validateKeyPath(value: string): Promise<string | undefined> {
  if (!value || !value.trim()) {
    return L({ en: 'Required', ru: 'Обязательное поле' });
  }
  const exists = await fse.pathExists(replaceHomePath(value.trim()));
  return exists
    ? undefined
    : L({ en: 'File not found', ru: 'Файл не найден' });
}

// --- finalize: verify, persist, bring online ---------------------------------------------------

async function finalize(state: WizardState, workspace: string): Promise<void> {
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: L({ en: 'WireFerry: connecting…', ru: 'WireFerry: подключение…' }),
    },
    async () => {
      await verifyAndProvision(state);
    }
  );

  // Connection verified — persist secrets, then write the config and bring the server online.
  const trusted = isWorkspaceTrusted();
  let passwordField: string | undefined;

  if (state.authMethod === 'plaintext') {
    passwordField = state.password;
  } else if (state.authMethod === 'keychain') {
    if (trusted && state.password) {
      await storeCredential(
        { protocol: state.protocol, host: state.host, port: state.port, username: state.username, type: 'password' },
        state.password
      );
      passwordField = 'secretStorage';
    } else {
      // No keychain access (untrusted workspace) — fall back to a prompt rather than store nothing
      // and point the config at an empty slot.
      passwordField = 'prompt';
    }
  }

  let passphraseField: string | boolean | undefined;
  if (state.authMethod === 'key' && state.passphrase) {
    if (trusted) {
      await storeCredential(
        { protocol: 'sftp', host: state.host, port: state.port, username: state.username, type: 'passphrase' },
        state.passphrase
      );
      passphraseField = 'secretStorage';
    } else {
      passphraseField = true; // prompt every connect
    }
  }

  const configText = buildConfigText(state, passwordField, passphraseField);
  const configPath = path.join(workspace, CONFIG_PATH);
  await fse.outputFile(configPath, configText);

  // Replace whatever services this workspace had (none, for a first config) with the new one and
  // flip the toolbar/welcome gate — mirrors fileActivityMonitor.handleConfigSave, but the wizard
  // wrote the file directly (no editor save event to react to).
  findAllFileService(service => service.workspace === workspace).forEach(disposeFileService);
  const configs = await readConfigsFromFile(configPath);
  configs.forEach(config => createFileService(config, workspace));
  refreshConfigContext();
  if (app.remoteExplorer) {
    app.remoteExplorer.refresh();
  }

  await vscode.window.showTextDocument(vscode.Uri.file(configPath));
  showInformationMessage(
    L({
      en: `WireFerry: ${state.host} connected. Configuration created at .vscode/wireferry.json.`,
      ru: `WireFerry: ${state.host} подключён. Конфигурация создана в .vscode/wireferry.json.`,
    })
  );
}

// Prove a real login works before any config is written. For the "generate a new key" path this also
// generates the key, deploys it to the server over the password connection, and verifies a key login;
// on success state.privateKeyPath points at the new key. Throws with a readable message on failure.
async function verifyAndProvision(state: WizardState): Promise<void> {
  if (state.protocol === 'ftp') {
    await testFtp(state);
    return;
  }

  // SFTP
  if (state.authMethod === 'key' && state.keySource === 'existing') {
    const keyPath = replaceHomePath(state.privateKeyPath!);
    const privateKey = await fse.readFile(keyPath, 'utf8');
    const ok = await testKeyAuth({
      host: state.host,
      port: state.port,
      username: state.username,
      privateKey,
      passphrase: state.passphrase,
    });
    if (!ok) {
      throw new Error(
        L({ en: 'key login was rejected', ru: 'вход по ключу отклонён' })
      );
    }
    return;
  }

  if (state.authMethod === 'key' && state.keySource === 'generate') {
    await provisionGeneratedKey(state);
    return;
  }

  // keychain / plaintext — verify the password.
  await testSftpPassword(state, state.password!);
}

async function provisionGeneratedKey(state: WizardState): Promise<void> {
  // 1. Bootstrap: the password must actually log in before we bother generating anything.
  await testSftpPassword(state, state.password!);

  // 2. Generate the pair and write it locally with locked-down permissions.
  const alias = sanitizeAlias(state.host);
  const keyPath = await uniqueKeyPath(`wireferry_${alias}`);
  const keys = await generateKeyPair({
    type: 'ed25519',
    comment: `wireferry ${state.username}@${state.host} ${new Date().toISOString().slice(0, 10)}`,
    passphrase: state.passphrase,
  });
  await writeKeyFiles(keyPath, keys);

  // 3. Deploy the public half over the password connection.
  await withSftpPasswordConnection(state, state.password!, async sftp => {
    await deployPublicKey({ sftp }, keys.public);
  });

  // 4. Verify a real key login before committing the config to the key.
  const ok = await testKeyAuth({
    host: state.host,
    port: state.port,
    username: state.username,
    privateKey: keys.private,
    passphrase: state.passphrase,
  });
  if (!ok) {
    throw new Error(
      L({
        en: `key was written to ${keyPath} and deployed, but the key login was not accepted`,
        ru: `ключ записан в ${keyPath} и развёрнут, но вход по ключу не принят`,
      })
    );
  }
  state.privateKeyPath = keyPath;
}

// --- connection probes -------------------------------------------------------------------------

function testSftpPassword(state: WizardState, password: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const conn = new ssh2.Client();
    let settled = false;
    const finish = (err?: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      try {
        conn.end();
      } catch {
        /* ignore */
      }
      err ? reject(err) : resolve();
    };
    conn
      .on('ready', () => finish())
      .on('error', err => finish(err || new Error('connection failed')));
    try {
      conn.connect({
        host: state.host,
        port: state.port,
        username: state.username,
        password,
        readyTimeout: READY_TIMEOUT,
      });
    } catch (err) {
      finish(err as Error);
    }
  });
}

// Open a password SSH connection, hand the SFTP channel to `fn`, then always tear it down.
function withSftpPasswordConnection<T>(
  state: WizardState,
  password: string,
  fn: (sftp: any) => Promise<T>
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const conn = new ssh2.Client();
    let settled = false;
    const fail = (err: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      try {
        conn.end();
      } catch {
        /* ignore */
      }
      reject(err);
    };
    conn
      .on('ready', () => {
        conn.sftp((err, sftp) => {
          if (err) {
            return fail(err);
          }
          fn(sftp).then(
            value => {
              if (settled) {
                return;
              }
              settled = true;
              try {
                conn.end();
              } catch {
                /* ignore */
              }
              resolve(value);
            },
            e => fail(e)
          );
        });
      })
      .on('error', err => fail(err || new Error('connection failed')));
    try {
      conn.connect({
        host: state.host,
        port: state.port,
        username: state.username,
        password,
        readyTimeout: READY_TIMEOUT,
      });
    } catch (err) {
      fail(err as Error);
    }
  });
}

function testFtp(state: WizardState): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const client = new (Ftp as any)();
    let settled = false;
    const finish = (err?: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      try {
        client.end();
      } catch {
        /* ignore */
      }
      err ? reject(err) : resolve();
    };
    client
      .on('ready', () => finish())
      .on('error', (err: Error) => finish(err || new Error('connection failed')));
    try {
      client.connect({
        host: state.host,
        port: state.port,
        user: state.username,
        password: state.password,
        connTimeout: READY_TIMEOUT,
      });
    } catch (err) {
      finish(err as Error);
    }
  });
}

// --- config serialization ----------------------------------------------------------------------

function buildConfigText(
  state: WizardState,
  passwordField: string | undefined,
  passphraseField: string | boolean | undefined
): string {
  const config: any = {
    name: state.host,
    host: state.host,
    port: state.port,
    username: state.username,
    protocol: state.protocol,
    remotePath: state.remotePath,
    uploadOnSave: true,
    // Give new files/dirs a safe default mode on upload and on create-in-tree: 644 = owner writes,
    // others read-only (a web server running as another user can still read them); 755 for dirs.
    // Decimal digits here, interpreted as octal (matches the schema's `number` type).
    filePerm: 644,
    dirPerm: 755,
    // Never let a project/folder upload push local-only housekeeping to the server — most importantly
    // .vscode, which holds this very config file (and a plaintext password, if that's the chosen
    // storage). Without an explicit ignore the default is empty and "Upload Project" would send it.
    ignore: ['.vscode', '.git', '.DS_Store'],
  };

  if (state.authMethod === 'key') {
    config.privateKeyPath = state.privateKeyPath;
    if (passphraseField !== undefined) {
      config.passphrase = passphraseField;
    }
  } else if (passwordField !== undefined) {
    config.password = passwordField;
  }

  const header = L({
    en:
      '// WireFerry — created by the setup wizard. Hover any field for help (JSON schema attached).\n' +
      '// Add profiles, ignore patterns or sync options by hand — see the docs.\n',
    ru:
      '// WireFerry — создано мастером настройки. Наведите курсор на поле для подсказки (подключена JSON-схема).\n' +
      '// Профили, ignore-шаблоны и параметры синхронизации добавляются вручную — см. документацию.\n',
  });
  return `${header}${JSON.stringify(config, null, 2)}\n`;
}

function errText(e: any): string {
  return (e && e.message) || String(e) || 'unknown error';
}
