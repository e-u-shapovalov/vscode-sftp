import { window, ProgressLocation } from 'vscode';
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

// Thrown when both su password attempts were rejected. A batch caller treats it like a cancellation —
// the user can't elevate, so re-prompting for every remaining file would just repeat the failure.
export class ElevationAuthFailed extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ElevationAuthFailed';
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
// A safe POSIX user name (so it can be placed after `su -` without shell-escaping). Rejects anything
// with spaces/quotes/metacharacters; the trailing `$` allows Samba-style machine accounts.
export const SAFE_USER = /^[a-z_][a-z0-9_-]*\$?$/i;

// A remote path safe to hand to a `su -` command: it must be ABSOLUTE. Under `su -` the CWD becomes root's
// home, so a relative path (from a `remotePath: "./"` config) would resolve against /root and hit — or
// destroy — the wrong object. Callers that DELETE must additionally reject the root "/" itself.
export function isAbsoluteRemotePath(p: string | undefined): boolean {
  return !!p && p[0] === '/';
}

function passwordKey(remoteFs: FileSystem, host: string, asUser: string): string {
  const client = execClient(remoteFs);
  let base = host || 'server';
  if (client && typeof client.getEndpoint === 'function') {
    const { host: h, port } = client.getEndpoint();
    base = `${h || host || 'server'}:${port || 22}`;
  }
  // Key by user too: root and a named user have DIFFERENT passwords on the same host.
  return `${base}#${asUser}`;
}

async function getRootPassword(
  key: string,
  displayHost: string,
  reprompt: boolean,
  asUser: string
): Promise<string | undefined> {
  if (!reprompt && rootPwCache.has(key)) {
    return rootPwCache.get(key);
  }
  const pw = await window.showInputBox({
    password: true,
    ignoreFocusOut: true,
    title: L({
      en: `Password for ${asUser}@${displayHost || 'server'} (su)`,
      ru: `Пароль ${asUser} на ${displayHost || 'сервер'} (su)`,
    }),
    prompt: reprompt
      ? L({
          en: `Wrong password — try again. WireFerry runs the command as ${asUser} via \`su\`.`,
          ru: `Неверный пароль — попробуйте ещё раз. WireFerry выполняет команду от ${asUser} через \`su\`.`,
        })
      : L({
          en: `WireFerry will run the command as ${asUser} via \`su\`. The password is kept in memory only for this window.`,
          ru: `WireFerry выполнит команду от ${asUser} через \`su\`. Пароль хранится в памяти только на время этого окна.`,
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
  command: string,
  asUser?: string,
  rawOutput = false
): Promise<{ code: number; output: string }> {
  // Default / 'root' → su to root; a named user → su to that user (with THAT user's password).
  const user = asUser && asUser !== 'root' ? asUser : 'root';
  if (user !== 'root' && !SAFE_USER.test(user)) {
    throw new Error(
      L({
        en: `Refusing to su to an unsafe user name: ${user}`,
        ru: `Небезопасное имя пользователя для su: ${user}`,
      })
    );
  }
  const client = execClient(remoteFs);
  if (!client || typeof client.execRoot !== 'function') {
    throw new Error(
      L({
        en: 'Running as root needs an SSH connection with a shell (not available on FTP).',
        ru: 'Выполнение от root требует SSH-подключения с оболочкой (недоступно на FTP).',
      })
    );
  }

  const key = passwordKey(remoteFs, host, user);
  // At most two password attempts: the cached/first entry, then one re-prompt after an auth failure.
  for (let attempt = 0; attempt < 2; attempt++) {
    const pw = await getRootPassword(key, host, attempt > 0, user);
    if (pw === undefined) {
      throw new ElevationCancelled();
    }
    try {
      // Show a spinner while su authenticates and runs on the server. After the password prompt closes
      // there is otherwise a dead pause (network round-trip + su), so the user can't tell whether it hung
      // or is still checking the password — this makes "working…" visible until the server answers.
      return await window.withProgress(
        {
          location: ProgressLocation.Notification,
          title: L({
            en: `WireFerry: running as ${user} on ${host || 'the server'}…`,
            ru: `WireFerry: выполняю от ${user} на ${host || 'сервере'}…`,
          }),
        },
        () => client.execRoot(command, pw, user === 'root' ? undefined : user, rawOutput)
      );
    } catch (e: any) {
      if (e && e.authFailed) {
        rootPwCache.delete(key);
        logger.warn(`su authentication failed on ${host || 'server'}`);
        continue; // re-prompt
      }
      throw e;
    }
  }
  // Both attempts were rejected passwords — a dedicated type so a batch caller can abort the rest
  // instead of re-prompting per file.
  throw new ElevationAuthFailed(
    L({ en: 'su: authentication failed', ru: 'su: не удалось аутентифицироваться' })
  );
}
