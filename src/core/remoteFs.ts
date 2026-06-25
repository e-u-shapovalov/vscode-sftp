import upath from './upath';
import { promptForPassword, showInformationMessage } from '../host';
import logger from '../logger';
import app from '../app';
import { L } from '../i18n';
import { ConnectOption } from './remote-client/remoteClient';
import { takePendingSaves, storeCredential } from '../modules/secrets';
import {
  FileSystem,
  RemoteFileSystem,
  SFTPFileSystem,
  FTPFileSystem,
} from './fs';
import localFs from './localFs';

// Stable serialization (sorted keys, nested objects included). The previous implementation glued
// bare values together ('foo'+22 === 'foo2'+2), so two different hosts could collide on one cache
// slot and commands could run against the wrong connection.
function stableStringify(value: any): string {
  if (value === null || typeof value !== 'object') {
    return String(JSON.stringify(value));
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const body = Object.keys(value)
    .sort()
    .map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(',');
  return `{${body}}`;
}

// Secrets must never enter the connection-cache identity. The identity is used as a plain-string
// Map key (fsTable / _openedHostInfos), so a password there would leak into key enumeration; and
// keying by a resolved-vs-sentinel value would split one server across two cache slots. host +
// port + username + protocol identify a connection well enough.
const IDENTITY_SECRET_KEYS = ['password', 'passphrase', 'privateKey'];

export function stripSecretsForIdentity(option) {
  const copy = Object.assign({}, option);
  IDENTITY_SECRET_KEYS.forEach(key => {
    delete copy[key];
  });
  return copy;
}

// Single source of truth for "what connection is this" — shared by the connection cache here and
// by FileService._openedHostInfos so open and dispose compute the exact same key.
export function hostIdentity(option): string {
  return stableStringify(stripSecretsForIdentity(option));
}

function hashOption(option) {
  return hostIdentity(option);
}

class KeepAliveRemoteFs {
  private isValid: boolean = false;

  private pendingPromise: Promise<RemoteFileSystem> | null;

  private fs: RemoteFileSystem;

  async getFs(
    option: ConnectOption & {
      protocol: string;
      remoteTimeOffsetInHours: number;
    }
  ): Promise<RemoteFileSystem> {
    if (this.isValid) {
      this.pendingPromise = null;
      return Promise.resolve(this.fs);
    }

    if (this.pendingPromise) {
      return this.pendingPromise;
    }

    const connectOption = Object.assign({}, option);
    // tslint:disable variable-name
    let FsConstructor: typeof SFTPFileSystem | typeof FTPFileSystem;
    if (option.protocol === 'sftp') {
      connectOption.debug = function debug(str) {
        const log = str.match(/^DEBUG(?:\[SFTP\])?: (.*?): (.*?)$/);

        if (log) {
          if (log[1] === 'Parser') return;
          logger.debug(`${log[1]}: ${log[2]}`);
        } else {
          logger.debug(str);
        }
      };
      FsConstructor = SFTPFileSystem;
    } else if (option.protocol === 'ftp') {
      connectOption.debug = function debug(str) {
        const log = str.match(/^\[connection\] (>|<) (.*?)(\\r\\n)?$/);

        if (!log) return;

        if (log[2].match(/200 NOOP/)) return;

        if (/^PASS\b/i.test(log[2])) log[2] = 'PASS ******';

        logger.debug(`${log[1]} ${log[2]}`);
      };
      FsConstructor = FTPFileSystem;
    } else {
      throw new Error(`unsupported protocol ${option.protocol}`);
    }

    this.fs = new FsConstructor(upath, {
      clientOption: connectOption,
      remoteTimeOffsetInHours: option.remoteTimeOffsetInHours,
    });
    this.fs.onDisconnected(this.invalid.bind(this));

    // Capture the password / passphrase the user types so we can offer to persist it to the OS
    // keychain — but only AFTER the connection succeeds (never save a wrong secret) and only when
    // the config opted in via the "secretStorage" sentinel (resolveCredentials → registerPendingSave).
    const entered: { password?: string; passphrase?: string } = {};
    app.sftpBarItem.showMsg('connecting...', connectOption.connectTimeout);
    this.pendingPromise = this.fs
      .connect(connectOption, {
        askForPasswd: promptForPassword,
        onPasswordEntered: value => {
          entered.password = value;
        },
        onPassphraseEntered: value => {
          entered.passphrase = value;
        },
      })
      .then(
        () => {
          app.sftpBarItem.reset();
          this.isValid = true;
          // Don't block the connection (and the pending file operation) on the user answering the
          // save dialog — offer in the background, best-effort.
          offerToSaveEnteredCredentials(connectOption, entered).catch(() => {
            /* best-effort: never let a save prompt failure break a good connection */
          });
          return this.fs;
        },
        err => {
          this.fs.end();
          this.invalid('error');
          // The connect failed — discard any pending "save credential?" offer registered for this
          // identity so descriptors don't accumulate for never-successful connections.
          takePendingSaves(hostIdentity(connectOption));
          throw err;
        }
      );

    return this.pendingPromise;
  }

  invalid(reason: string) {
    this.pendingPromise = null;
    this.fs.end();
    this.isValid = false;
  }

  end() {
    this.fs.end();
  }
}

// Offer to persist the freshly-typed password / passphrase to the OS keychain. Runs only for
// identities a config registered via the "secretStorage" sentinel (resolveCredentials), so a
// plaintext or key-based config never triggers it. Non-modal so it doesn't block the editor.
async function offerToSaveEnteredCredentials(
  connectOption: any,
  entered: { password?: string; passphrase?: string }
): Promise<void> {
  const pending = takePendingSaves(hostIdentity(connectOption));
  for (const descriptor of pending) {
    const value = descriptor.type === 'password' ? entered.password : entered.passphrase;
    if (value === undefined) {
      continue;
    }
    const target = `${descriptor.username}@${descriptor.host}`;
    const what =
      descriptor.type === 'password'
        ? L({ en: 'password', ru: 'пароль' })
        : L({ en: 'passphrase', ru: 'passphrase' });
    const save = L({ en: 'Save', ru: 'Сохранить' });
    const answer = await showInformationMessage(
      L({
        en: `Save the ${what} for ${target} to the OS keychain?`,
        ru: `Сохранить ${what} для ${target} в системном хранилище?`,
      }),
      save,
      L({ en: "Don't save", ru: 'Не сохранять' })
    );
    if (answer === save) {
      await storeCredential(descriptor, value);
    }
  }
}

function getLocalFs() {
  return Promise.resolve(localFs);
}

const fsTable: {
  [x: string]: KeepAliveRemoteFs;
} = {};

export function createRemoteIfNoneExist(option): Promise<FileSystem> {
  if (option.protocol === 'local') {
    return getLocalFs();
  }

  const identity = hashOption(option);
  const fs = fsTable[identity];
  if (fs !== undefined) {
    return fs.getFs(option);
  }

  const fsInstance = new KeepAliveRemoteFs();
  fsTable[identity] = fsInstance;
  return fsInstance.getFs(option);
}

export function removeRemoteFs(option) {
  const identity = hashOption(option);
  const fs = fsTable[identity];
  if (fs !== undefined) {
    fs.end();
    delete fsTable[identity];
  }
}
