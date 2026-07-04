import { window } from 'vscode';
import { FileSystem } from '../core';
import logger from '../logger';
import { L } from '../i18n';

// In-memory root passwords, keyed by the connection's real host:port (see passwordKey), kept only for
// the lifetime of the window so a batch of root operations doesn't re-prompt for every file. NEVER
// persisted to disk/keychain and never logged; dropped the moment su rejects it. Cleared implicitly on
// reload (module state resets).
const rootPwCache = new Map<string, string>();

// Thrown when the user dismisses the root-password prompt. Callers treat it as a silent no-op
// (the user changed their mind) rather than an error to report.
export class ElevationCancelled extends Error {
  constructor() {
    super('root elevation cancelled by user');
    this.name = 'ElevationCancelled';
  }
}

// POSIX single-quote a string so a path with spaces/quotes survives being pasted into a root shell.
export function shQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

// The exec-capable client behind a remote fs, or null (FTP / minimal servers have no shell).
function execClient(remoteFs: FileSystem): any {
  return (remoteFs as any).getClient ? (remoteFs as any).getClient() : null;
}

// True when this connection can run commands as root (SSH with an exec channel). FTP can't.
export function canElevate(remoteFs: FileSystem): boolean {
  const client = execClient(remoteFs);
  return !!client && typeof client.execRoot === 'function';
}

// Cache key for the root password: the connection's real host:port (so two servers behind the same
// hostname string never share a password). Falls back to the display host when the client can't report
// its endpoint.
function passwordKey(remoteFs: FileSystem, host: string): string {
  const client = execClient(remoteFs);
  if (client && typeof client.getEndpoint === 'function') {
    const { host: h, port } = client.getEndpoint();
    return `${h || host || 'server'}:${port || 22}`;
  }
  return host || 'server';
}

async function getRootPassword(
  key: string,
  displayHost: string,
  reprompt: boolean
): Promise<string | undefined> {
  if (!reprompt && rootPwCache.has(key)) {
    return rootPwCache.get(key);
  }
  const pw = await window.showInputBox({
    password: true,
    ignoreFocusOut: true,
    title: L({
      en: `Root password for ${displayHost || 'server'} (su)`,
      ru: `Пароль root для ${displayHost || 'сервер'} (su)`,
    }),
    prompt: reprompt
      ? L({
          en: 'Wrong password — try again. WireFerry runs the command as root via `su -`.',
          ru: 'Неверный пароль — попробуйте ещё раз. WireFerry выполняет команду от root через `su -`.',
        })
      : L({
          en: 'WireFerry will run the command as root via `su -`. The password is kept in memory only for this window.',
          ru: 'WireFerry выполнит команду от root через `su -`. Пароль хранится в памяти только на время этого окна.',
        }),
  });
  if (pw === undefined) {
    return undefined; // cancelled
  }
  rootPwCache.set(key, pw);
  return pw;
}

// Run `command` as root over the connection behind `remoteFs`, prompting for the root password and
// re-prompting once if su rejects it. `command` is passed verbatim to root's shell — the CALLER must
// shell-escape any injected path (use shQuote). Rejects with ElevationCancelled if the user backs
// out, or a plain Error if the command itself fails.
export async function execAsRoot(
  remoteFs: FileSystem,
  host: string,
  command: string
): Promise<{ code: number; output: string }> {
  const client = execClient(remoteFs);
  if (!client || typeof client.execRoot !== 'function') {
    throw new Error(
      L({
        en: 'Running as root needs an SSH connection with a shell (not available on FTP).',
        ru: 'Выполнение от root требует SSH-подключения с оболочкой (недоступно на FTP).',
      })
    );
  }

  const key = passwordKey(remoteFs, host);
  // At most two password attempts: the cached/first entry, then one re-prompt after an auth failure.
  for (let attempt = 0; attempt < 2; attempt++) {
    const pw = await getRootPassword(key, host, attempt > 0);
    if (pw === undefined) {
      throw new ElevationCancelled();
    }
    try {
      return await client.execRoot(command, pw);
    } catch (e: any) {
      if (e && e.authFailed) {
        rootPwCache.delete(key);
        logger.warn(`su authentication failed on ${host || 'server'}`);
        continue; // re-prompt
      }
      throw e;
    }
  }
  // Both attempts were rejected passwords.
  throw new Error(
    L({ en: 'su: authentication failed', ru: 'su: не удалось аутентифицироваться' })
  );
}
