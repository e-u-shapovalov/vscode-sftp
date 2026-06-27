import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import * as sshConfig from 'ssh-config';
import app from '../app';
import logger from '../logger';
import { getUserSetting, isWorkspaceTrusted, showWarningMessage } from '../host';
import { L } from '../i18n';
import { replaceHomePath, resolvePath } from '../helper';
import { SETTING_KEY_REMOTE } from '../constants';
import upath from './upath';
import Ignore from './ignore';
import { FileSystem } from './fs';
import Scheduler from './scheduler';
import {
  createRemoteIfNoneExist,
  removeRemoteFs,
  hostIdentity,
  stripSecretsForIdentity,
} from './remoteFs';
import {
  getCredential,
  registerPendingSave,
  CredentialDescriptor,
  CredentialType,
} from '../modules/secrets';
import TransferTask from './transferTask';
import localFs from './localFs';

const isWindows = process.platform === 'win32';

type Omit<T, U> = Pick<T, Exclude<keyof T, U>>;

interface Root {
  name: string;
  context: string;
  watcher: WatcherConfig;
  defaultProfile: string;
}

interface Host {
  host: string;
  port: number;
  username: string;
  password: string;
  remotePath: string;
  connectTimeout: number;
}

interface ServiceOption {
  protocol: string;
  remote?: string;
  uploadOnSave: boolean;
  useTempFile: boolean;
  openSsh: boolean;
  downloadOnOpen: boolean | 'confirm';
  filePerm?: number;
  dirPerm?: number;
  syncOption: {
    delete: boolean;
    skipCreate: boolean;
    ignoreExisting: boolean;
    update: boolean;
  };
  ignore: string[];
  ignoreFile: string;
  remoteExplorer: {
    filesExclude?: string[];
    order: number;
  };
  remoteTimeOffsetInHours: number;
  limitOpenFilesOnRemote: number | true;
  maxFileSize?: number;
}

interface WatcherConfig {
  files: false | string;
  autoUpload: boolean;
}

interface SftpOption {
  // sftp
  agent?: string;
  privateKeyPath?: string;
  passphrase: string | true;
  interactiveAuth: boolean | string[];
  algorithms: any;
  sshConfigPath?: string;
  concurrency: number;
  sshCustomParams?: string;
  hop: (Host & SftpOption)[] | (Host & SftpOption);
}

interface FtpOption {
  secure: boolean | 'control' | 'implicit';
  secureOptions: any;
}

export interface FileServiceConfig
  extends Root,
    Host,
    ServiceOption,
    SftpOption,
    FtpOption {
  profiles?: {
    [x: string]: FileServiceConfig;
  };
}

export interface ServiceConfig
  extends Root,
    Host,
    Omit<ServiceOption, 'ignore'>,
    SftpOption,
    FtpOption {
  ignore?: ((fsPath: string) => boolean) | null;
}

export interface WatcherService {
  create(watcherBase: string, watcherConfig: WatcherConfig): any;
  dispose(watcherBase: string): void;
}

interface TransferScheduler {
  // readonly _scheduler: Scheduler;
  size: number;
  add(x: TransferTask): void;
  run(): Promise<void>;
  stop(): void;
}

type ConfigValidator = (x: any) => { message: string };

const DEFAULT_SSHCONFIG_FILE = '~/.ssh/config';

function filesIgnoredFromConfig(config: FileServiceConfig): string[] {
  const cache = app.fsCache;
  const ignore: string[] =
    config.ignore && config.ignore.length ? config.ignore : [];

  const ignoreFile = config.ignoreFile;
  if (!ignoreFile) {
    return ignore;
  }

  let ignoreFromFile;
  if (cache.has(ignoreFile)) {
    // Re-check existence on a cache hit: if the ignoreFile was deleted after being cached, the stale
    // patterns would keep applying until the LRU (max:6) evicts the slot or the window reloads.
    if (!fs.existsSync(ignoreFile)) {
      cache.del(ignoreFile);
      logger.warn(`ignoreFile "${ignoreFile}" no longer exists — dropping cached patterns.`);
      return ignore;
    }
    ignoreFromFile = cache.get(ignoreFile);
  } else if (fs.existsSync(ignoreFile)) {
    ignoreFromFile = fs.readFileSync(ignoreFile).toString();
    cache.set(ignoreFile, ignoreFromFile);
  } else {
    // A missing ignoreFile must NOT break every operation. filesIgnoredFromConfig runs from
    // getConfig() — the entry point for upload/download/sync/list — so throwing here made a single
    // typo in "ignoreFile" render the whole config unusable (every command failed). Warn so the
    // dropped file-based patterns are visible, and fall back to the inline `ignore` patterns.
    logger.warn(
      `ignoreFile "${ignoreFile}" not found — skipping file-based ignore patterns. Check your "ignoreFile" config.`
    );
    return ignore;
  }

  return ignore.concat(ignoreFromFile.split(/\r?\n/g));
}

function getHostInfo(config) {
  const ignoreOptions = [
    'name',
    'remotePath',
    'uploadOnSave',
    'useTempFile',
    'openSsh',
    'downloadOnOpen',
    'ignore',
    'ignoreFile',
    'watcher',
    'concurrency',
    'syncOption',
    'sshConfigPath',
  ];

  return Object.keys(config).reduce((obj, key) => {
    if (ignoreOptions.indexOf(key) === -1) {
      obj[key] = config[key];
    }
    return obj;
  }, {});
}

function chooseDefaultPort(protocol) {
  return protocol === 'ftp' ? 21 : 22;
}

// Keychain sentinels a config may use in place of a plaintext secret.
const SENTINEL_KEYCHAIN = 'secretStorage';
const SENTINEL_PROMPT = 'prompt';

function credentialDescriptor(hostInfo: any, type: CredentialType): CredentialDescriptor {
  return {
    protocol: hostInfo.protocol,
    host: hostInfo.host,
    port: hostInfo.port,
    username: hostInfo.username,
    type,
  };
}

// Resolve keychain sentinels in-place BEFORE the host info is hashed, cached, or connected. A
// sentinel must never reach RemoteClient: ftpClient/sshClient treat any non-undefined password as
// "auth provided", so the literal string "secretStorage" would be sent to the server as the
// password. Protocol-agnostic (covers SFTP and FTP). Only EXPLICIT sentinels touch the keychain;
// a real string (incl. ""), null, or absent field is left exactly as today (back-compat).
async function resolveCredentials(hostInfo: any): Promise<void> {
  warnOnceAboutHopPlaintext(hostInfo);
  // Neutralise hop sentinels FIRST so the identity hash (computed next) is stable across
  // register/take/create/dispose, and so a literal "secretStorage" never reaches the jump host.
  sanitizeHopCredentials(hostInfo);
  // In an untrusted workspace the config may be attacker-supplied, so we never silently read or
  // write the keychain — sentinels just fall back to a plain prompt.
  const trusted = isWorkspaceTrusted();
  const identity = hostIdentity(hostInfo);
  await resolveCredentialField(hostInfo, 'password', identity, trusted);
  await resolveCredentialField(hostInfo, 'passphrase', identity, trusted);
}

// hop/jump-host entries are NOT covered by the keychain (see warnOnceAboutHopPlaintext). Replace
// each hop with a shallow COPY — so we never mutate the user's live config object — and turn any
// sentinel there into a plain prompt: otherwise the literal "secretStorage"/"prompt" string would
// be sent to the jump host as its password. Copying also stops SSHClient's later
// `curOpt.privateKey = …` from writing raw key bytes back into the config tree.
function sanitizeHopCredentials(hostInfo: any): void {
  if (!hostInfo.hop) {
    return;
  }
  const wasArray = Array.isArray(hostInfo.hop);
  const hops = wasArray ? hostInfo.hop : [hostInfo.hop];
  const sanitized = hops.map((h: any) => {
    if (!h || typeof h !== 'object') {
      return h;
    }
    const copy = { ...h };
    if (copy.password === SENTINEL_KEYCHAIN || copy.password === SENTINEL_PROMPT) {
      delete copy.password;
    }
    if (copy.passphrase === SENTINEL_KEYCHAIN || copy.passphrase === SENTINEL_PROMPT) {
      copy.passphrase = true;
    }
    return copy;
  });
  hostInfo.hop = wasArray ? sanitized : sanitized[0];
}

async function resolveCredentialField(
  hostInfo: any,
  field: CredentialType,
  identity: string,
  trusted: boolean
): Promise<void> {
  const value = hostInfo[field];
  const isPassphrase = field === 'passphrase';
  // Fall back to the normal prompt: password → drop the field so RemoteClient asks; passphrase →
  // set `true` so SSHClient asks.
  const fallbackToPrompt = () => {
    if (isPassphrase) {
      hostInfo[field] = true;
    } else {
      delete hostInfo[field];
    }
  };

  if (value === SENTINEL_KEYCHAIN) {
    if (!trusted) {
      fallbackToPrompt();
      return;
    }
    const descriptor = credentialDescriptor(hostInfo, field);
    let stored: string | undefined;
    try {
      stored = await getCredential(descriptor);
    } catch (err) {
      // A flaky keychain must never break connecting — fall back to a prompt. Surface it so a user
      // who keeps being prompted (locked vault, libsecret down) can see why in the log.
      logger.warn(
        `wireferry: keychain read failed for ${field}@${descriptor.host}, falling back to prompt: ${
          err && (err as any).message ? (err as any).message : err
        }`
      );
      stored = undefined;
    }
    if (stored !== undefined) {
      hostInfo[field] = stored;
    } else {
      // Nothing saved yet: prompt, and offer to save the typed value once the connection succeeds.
      // The 'local' protocol never authenticates, so it would only leave a pending entry that is
      // never taken — skip it.
      fallbackToPrompt();
      if (hostInfo.protocol !== 'local') {
        registerPendingSave(identity, descriptor);
      }
    }
  } else if (value === SENTINEL_PROMPT) {
    // Always prompt, never persist.
    fallbackToPrompt();
  }
}

// hop / jump-host blocks carry their own password/passphrase, which Phase 1 does NOT move to the
// keychain. Tell the user once per session so a partly-covered config isn't silently misleading.
let _hopPlaintextWarned = false;

function warnOnceAboutHopPlaintext(hostInfo: any): void {
  if (_hopPlaintextWarned || !hostInfo.hop) {
    return;
  }
  const hops = Array.isArray(hostInfo.hop) ? hostInfo.hop : [hostInfo.hop];
  const hasPlaintext = hops.some(
    (h: any) =>
      h &&
      ['password', 'passphrase'].some(field => {
        const v = h[field];
        return (
          typeof v === 'string' &&
          v !== '' &&
          v !== SENTINEL_KEYCHAIN &&
          v !== SENTINEL_PROMPT
        );
      })
  );
  // A sentinel on a hop is NOT plaintext, but it also doesn't reach the keychain — sanitizeHopCredentials
  // silently turns it into a plain prompt. Warn about that too, so a user who wrote "secretStorage" on a
  // hop expecting it to be stored isn't surprised by a prompt every connect.
  const hasSentinel = hops.some(
    (h: any) =>
      h &&
      ['password', 'passphrase'].some(field => {
        const v = h[field];
        return v === SENTINEL_KEYCHAIN || v === SENTINEL_PROMPT;
      })
  );
  if (!hasPlaintext && !hasSentinel) {
    return;
  }
  _hopPlaintextWarned = true;
  showWarningMessage(
    L({
      en:
        'WireFerry: hop/jump-host credentials are not stored in the OS keychain yet — plaintext hop passwords stay in your config file, and "secretStorage"/"prompt" on a hop is treated as a plain prompt.',
      ru:
        'WireFerry: учётные данные hop/jump-host пока не хранятся в системном хранилище — открытые пароли hop остаются в файле конфигурации, а "secretStorage"/"prompt" в hop обрабатывается как обычный запрос пароля.',
    })
  );
}

function setConfigValue(config, key, value) {
  if (config[key] === undefined) {
    if (key === 'port') {
      config[key] = parseInt(value, 10);
    } else {
      config[key] = value;
    }
  }
}

function mergeConfigWithExternalRefer(
  config: FileServiceConfig
): FileServiceConfig {
  const copyed = Object.assign({}, config);

  if (config.remote) {
    const remoteMap = getUserSetting(SETTING_KEY_REMOTE);
    const remote = remoteMap.get<Record<string, any>>(config.remote);
    if (!remote) {
      throw new Error(`Can\'t not find remote "${config.remote}"`);
    }
    const remoteKeyMapping = new Map([['scheme', 'protocol']]);

    const remoteKeyIgnored = new Map([['rootPath', 1]]);

    Object.keys(remote).forEach(key => {
      if (remoteKeyIgnored.has(key)) {
        return;
      }

      const targetKey = remoteKeyMapping.has(key)
        ? remoteKeyMapping.get(key)
        : key;
      setConfigValue(copyed, targetKey, remote[key]);
    });
  }

  if (config.protocol !== 'sftp') {
    return copyed;
  }

  const sshConfigPath = replaceHomePath(
    config.sshConfigPath || DEFAULT_SSHCONFIG_FILE
  );

  const cache = app.fsCache;
  let sshConfigContent;
  if (cache.has(sshConfigPath)) {
    sshConfigContent = cache.get(sshConfigPath);
  } else {
    try {
      sshConfigContent = fs.readFileSync(sshConfigPath, 'utf8');
    } catch (error) {
      logger.warn(error.message, `load ${sshConfigPath} failed`);
      sshConfigContent = '';
    }
    cache.set(sshConfigPath, sshConfigContent);
  }

  if (!sshConfigContent) {
    return copyed;
  }

  const parsedSSHConfig = sshConfig.parse(sshConfigContent);
  const section = parsedSSHConfig.find({
    Host: copyed.host,
  });

  if (section === null) {
    return copyed;
  }

  const mapping = new Map([
    ['hostname', 'host'],
    ['port', 'port'],
    ['user', 'username'],
    ['identityfile', 'privateKeyPath'],
    ['serveraliveinterval', 'keepalive'],
    ['connecttimeout', 'connTimeout'],
  ]);

  section.config.forEach(line => {
    if (!line.param) {
      return;
    }

    const key = mapping.get(line.param.toLowerCase());

    if (key !== undefined) {
      if (key === 'host') {
        copyed[key] = line.value;
      } else {
        setConfigValue(copyed, key, line.value);
      }
    }
  });

  // Bug introduced in pull request #69 : Fix ssh config resolution
  /* const parsedSSHConfig = sshConfig.parse(sshConfigContent);
  const computed = parsedSSHConfig.compute(copyed.host);

  const mapping = new Map([
    ['hostname', 'host'],
    ['port', 'port'],
    ['user', 'username'],
    ['serveraliveinterval', 'keepalive'],
    ['connecttimeout', 'connTimeout'],
  ]);

  Object.entries<any>(computed).forEach(([param, value]) => {
    if (param.toLowerCase() === 'identityfile') {
      setConfigValue(copyed, 'privateKeyPath', value[0]);
      return;
    }

    const key = mapping.get(param.toLowerCase());

    if (key !== undefined) {
      // don't need consider config priority, always set to the resolve host.
      if (key === 'host') {
        copyed[key] = value;
      } else {
        setConfigValue(copyed, key, value);
      }
    }
  }); */

  return copyed;
}

function getCompleteConfig(
  config: FileServiceConfig,
  workspace: string
): FileServiceConfig {
  const mergedConfig = mergeConfigWithExternalRefer(config);

  if (mergedConfig.agent && mergedConfig.privateKeyPath) {
    logger.warn(
      'Config Option Conflicted. You are specifing "agent" and "privateKey" at the same time, ' +
        'the later will be ignored.'
    );
  }

  // remove the './' part from a relative path
  mergedConfig.remotePath = upath.normalize(mergedConfig.remotePath);
  if (mergedConfig.privateKeyPath) {
    mergedConfig.privateKeyPath = resolvePath(
      workspace,
      mergedConfig.privateKeyPath
    );
  }

  if (mergedConfig.ignoreFile) {
    mergedConfig.ignoreFile = resolvePath(workspace, mergedConfig.ignoreFile);
  }

  // Hops carry their own privateKeyPath (for bastion/jump auth). Resolve ~ and relatives
  // the same way as the main privateKeyPath so fs.readFile in the hop chain receives
  // absolute paths. Without this, hop keys only worked with absolute paths.
  if (mergedConfig.hop) {
    const hops = Array.isArray(mergedConfig.hop) ? mergedConfig.hop : [mergedConfig.hop];
    for (const h of hops) {
      if (h && h.privateKeyPath) {
        h.privateKeyPath = resolvePath(workspace, h.privateKeyPath);
      }
    }
  }

  // convert ingore config to ignore function
  if (mergedConfig.agent && mergedConfig.agent.startsWith('$')) {
    const evnVarName = mergedConfig.agent.slice(1);
    const val = process.env[evnVarName];
    if (!val) {
      throw new Error(`Environment variable "${evnVarName}" not found`);
    }
    mergedConfig.agent = val;
  }

  return mergedConfig;
}

function mergeProfile(
  target: FileServiceConfig,
  source: FileServiceConfig
): FileServiceConfig {
  const res = Object.assign({}, target);
  delete res.profiles;

  const keys = Object.keys(source);
  for (const key of keys) {
    if (key === 'ignore') {
      // Guard against a base config without `ignore`: Object.assign copies it as undefined, and
      // undefined.concat would throw, breaking getConfig() for every operation on that profile.
      res.ignore = (res.ignore || []).concat(source.ignore || []);
    } else {
      res[key] = source[key];
    }
  }

  return res;
}

enum Event {
  BEFORE_TRANSFER = 'BEFORE_TRANSFER',
  AFTER_TRANSFER = 'AFTER_TRANSFER',
}

let id = 0;

export default class FileService {
  private _eventEmitter: EventEmitter = new EventEmitter();
  private _name: string;
  private _watcherConfig: WatcherConfig;
  private _profiles: string[];
  private _pendingTransferTasks: Set<TransferTask> = new Set();
  private _transferSchedulers: TransferScheduler[] = [];
  // Host infos we actually opened a connection for, keyed for de-duplication. Used so dispose()
  // can tear down connections from EVERY profile, not just the one active at dispose time.
  private _openedHostInfos: Map<string, object> = new Map();
  private _config: FileServiceConfig;
  private _configValidator: ConfigValidator;
  private _watcherService: WatcherService = {
    create() {
      /* do nothing  */
    },
    dispose() {
      /* do nothing  */
    },
  };
  id: number;
  baseDir: string;
  workspace: string;

  constructor(baseDir: string, workspace: string, config: FileServiceConfig) {
    this.id = ++id;
    this.workspace = workspace;
    this.baseDir = baseDir;
    this._watcherConfig = config.watcher;
    this._config = config;
    if (config.profiles) {
      this._profiles = Object.keys(config.profiles);
    }
  }

  get name(): string {
    return this._name ? this._name : '';
  }

  set name(name: string) {
    this._name = name;
  }

  setConfigValidator(configValidator: ConfigValidator) {
    this._configValidator = configValidator;
  }

  setWatcherService(watcherService: WatcherService) {
    if (this._watcherService) {
      this._disposeWatcher();
    }

    this._watcherService = watcherService;
    this._createWatcher();
  }

  getAvailableProfiles(): string[] {
    return this._profiles || [];
  }

  getPendingTransferTasks(): TransferTask[] {
    return Array.from(this._pendingTransferTasks);
  }

  isTransferring() {
    return this._transferSchedulers.length > 0;
  }

  cancelTransferTasks() {
    // keep the order
    // 1, remove tasks not start
    this._transferSchedulers.forEach(transfer => transfer.stop());
    this._transferSchedulers.length = 0;

    // 2. cancel running task
    this._pendingTransferTasks.forEach(t => t.cancel());
    this._pendingTransferTasks.clear();
  }

  beforeTransfer(listener: (task: TransferTask) => void) {
    this._eventEmitter.on(Event.BEFORE_TRANSFER, listener);
  }

  afterTransfer(listener: (err: Error | null, task: TransferTask) => void) {
    this._eventEmitter.on(Event.AFTER_TRANSFER, listener);
  }

  createTransferScheduler(concurrency): TransferScheduler {
    const fileService = this;
    const scheduler = new Scheduler({
      autoStart: false,
      concurrency,
    });
    scheduler.onTaskStart(task => {
      this._pendingTransferTasks.add(task as TransferTask);
      this._eventEmitter.emit(Event.BEFORE_TRANSFER, task);
    });
    scheduler.onTaskDone((err, task) => {
      this._pendingTransferTasks.delete(task as TransferTask);
      this._eventEmitter.emit(Event.AFTER_TRANSFER, err, task);
    });

    let runningPromise: Promise<void> | null = null;
    let isStopped: boolean = false;
    const transferScheduler: TransferScheduler = {
      get size() {
        return scheduler.size;
      },
      stop() {
        isStopped = true;
        scheduler.empty();
      },
      add(task: TransferTask) {
        if (isStopped) {
          return;
        }

        scheduler.add(task);
      },
      run() {
        if (isStopped) {
          return Promise.resolve();
        }

        if (scheduler.size <= 0) {
          fileService._removeScheduler(transferScheduler);
          return Promise.resolve();
        }

        if (!runningPromise) {
          runningPromise = new Promise(resolve => {
            scheduler.onIdle(() => {
              runningPromise = null;
              fileService._removeScheduler(transferScheduler);
              resolve();
            });
            scheduler.start();
          });
        }
        return runningPromise;
      },
    };
    fileService._storeScheduler(transferScheduler);

    return transferScheduler;
  }

  getLocalFileSystem(): FileSystem {
    return localFs;
  }

  async getRemoteFileSystem(config: ServiceConfig): Promise<FileSystem> {
    const hostInfo = getHostInfo(config);
    // Replace keychain sentinels ("secretStorage"/"prompt") with a real secret or a prompt BEFORE
    // the host info is hashed, cached, or sent to the server.
    await resolveCredentials(hostInfo);
    // Remember every host we actually open so dispose() can close them all (one command fans out
    // across profiles, so we must tear down every profile's socket, not just the active one).
    // Key by a SECRET-FREE identity (the same fn the connection cache uses) and store a stripped
    // copy as the value — so no password ever lands in this long-lived map or in its keys. dispose
    // tears down by the same identity.
    this._openedHostInfos.set(hostIdentity(hostInfo), stripSecretsForIdentity(hostInfo));
    return createRemoteIfNoneExist(hostInfo);
  }

  getConfig(useProfile = app.state.profile): ServiceConfig {
    let config = this._config;
    const hasProfile =
      config.profiles && Object.keys(config.profiles).length > 0;
    if (hasProfile && useProfile) {
      logger.info(`Using profile: ${useProfile}`);
      const profile = config.profiles![useProfile];
      if (!profile) {
        throw new Error(
          `Unkown Profile "${useProfile}".` +
            ' Please check your profile setting.' +
            ' You can set a profile by running command `WireFerry: Set Profile`.'
        );
      }
      config = mergeProfile(config, profile);
    }

    const completeConfig = getCompleteConfig(config, this.workspace);
    const error =
      this._configValidator && this._configValidator(completeConfig);
    if (error) {
      let errorMsg = `Config validation fail: ${error.message}.`;
      // tslint:disable-next-line triple-equals
      if (hasProfile && app.state.profile == null) {
        errorMsg += ' You might want to set a profile first.';
      }
      throw new Error(errorMsg);
    }

    return this._resolveServiceConfig(completeConfig);
  }

  getAllConfig(): Array<ServiceConfig> {
    const profiles = this._config.profiles;
    return profiles ? Object.keys(profiles).map(p => this.getConfig(p)) : [];
  }

  dispose() {
    this._disposeWatcher();
    this._disposeFileSystem();
  }

  private _resolveServiceConfig(
    fileServiceConfig: FileServiceConfig
  ): ServiceConfig {
    const serviceConfig: ServiceConfig = fileServiceConfig as any;

    if (serviceConfig.port === undefined) {
      serviceConfig.port = chooseDefaultPort(serviceConfig.protocol);
    }
    if (serviceConfig.protocol === 'ftp') {
      serviceConfig.concurrency = 1;
    }
    serviceConfig.ignore = this._createIgnoreFn(fileServiceConfig);

    return serviceConfig;
  }

  private _storeScheduler(scheduler: TransferScheduler) {
    this._transferSchedulers.push(scheduler);
  }

  private _removeScheduler(scheduler: TransferScheduler) {
    const index = this._transferSchedulers.findIndex(s => s === scheduler);
    if (index !== -1) {
      this._transferSchedulers.splice(index, 1);
    }
  }

  private _createIgnoreFn(config: FileServiceConfig): ServiceConfig['ignore'] {
    const localContext = this.baseDir;
    const remoteContext = config.remotePath;

    const ignoreConfig = filesIgnoredFromConfig(config);
    if (ignoreConfig.length <= 0) {
      return null;
    }

    const ignore = Ignore.from(ignoreConfig);
    const ignoreFunc = fsPath => {
      // vscode will always return path with / as separator
      const normalizedPath = path.normalize(fsPath);
      // baseDir is lowercased on Windows (#589); compare the prefix case-insensitively so a
      // mixed-case local path (e.g. C:\Users\…) is still recognised as local instead of being
      // misrouted to the remote branch — otherwise ignore patterns silently stop matching.
      const isLocalPath = isWindows
        ? normalizedPath.toLowerCase().indexOf(localContext.toLowerCase()) === 0
        : normalizedPath.indexOf(localContext) === 0;
      let relativePath;
      if (isLocalPath) {
        // local path — use upath so the relative path uses forward slashes. The `ignore`
        // package is POSIX-only; with Windows backslashes (`node_modules\foo.js`) directory
        // patterns like `node_modules`/`.git` would never match and nothing gets ignored.
        relativePath = upath.relative(localContext, fsPath);
      } else {
        // remote path
        relativePath = upath.relative(remoteContext, fsPath);
      }

      // skip root
      return relativePath !== '' && ignore.ignores(relativePath);
    };

    return ignoreFunc;
  }

  private _createWatcher() {
    this._watcherService.create(this.baseDir, this._watcherConfig);
  }

  private _disposeWatcher() {
    this._watcherService.dispose(this.baseDir);
  }

  private _disposeFileSystem() {
    const hostInfos = Array.from(this._openedHostInfos.values());
    this._openedHostInfos.clear();

    // Nothing was opened yet — fall back to the current profile's host info as a best effort.
    // getConfig() can throw on an invalid/partial config; swallow it so dispose never throws.
    if (hostInfos.length === 0) {
      try {
        hostInfos.push(getHostInfo(this.getConfig()));
      } catch (e) {
        return;
      }
    }

    hostInfos.forEach(removeRemoteFs);
  }
}
