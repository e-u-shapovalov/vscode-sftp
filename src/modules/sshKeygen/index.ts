import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';
import * as fse from 'fs-extra';
import * as ssh2 from 'ssh2';
import * as sshConfig from 'ssh-config';
import { modify, applyEdits } from 'jsonc-parser';
import app from '../../app';
import logger from '../../logger';
import { replaceHomePath } from '../../helper';

// Low-level SSH key generation + deployment operations. UI / orchestration lives in
// commandGenerateSshKey; everything here is side-effecting but prompt-free so it can be unit-reasoned
// about and reused for the "all servers in profile" fan-out.

const isWindows = process.platform === 'win32';
export const DEFAULT_SSH_CONFIG = '~/.ssh/config';

export type KeyType = 'ed25519' | 'rsa';

export interface GeneratedKey {
  private: string;
  public: string;
}

// --- key generation ----------------------------------------------------------------------------

// Wrap ssh2's async generator. RSA REQUIRES `bits` (a bare type throws); a passphrase REQUIRES a
// `cipher` (aes256-ctr — OpenSSH-compatible). Async (not the *Sync variant) so a slow RSA-4096
// generation never freezes the extension host.
export function generateKeyPair(opts: {
  type: KeyType;
  comment: string;
  passphrase?: string;
}): Promise<GeneratedKey> {
  const genOpts: any = { comment: opts.comment };
  if (opts.type === 'rsa') {
    genOpts.bits = 4096;
  }
  if (opts.passphrase) {
    genOpts.passphrase = opts.passphrase;
    genOpts.cipher = 'aes256-ctr';
  }
  return new Promise((resolve, reject) => {
    (ssh2 as any).utils.generateKeyPair(opts.type, genOpts, (err: Error, keys: GeneratedKey) => {
      if (err) {
        return reject(err);
      }
      resolve(keys);
    });
  });
}

// --- naming ------------------------------------------------------------------------------------

// A stable, filesystem- and ssh-config-safe alias derived from the profile name (preferred) or host.
// Never the raw host: an IP can change and a wildcard/space would be unsafe in ~/.ssh/config.
export function sanitizeAlias(raw: string): string {
  const cleaned = (raw || '').replace(/[^A-Za-z0-9._-]/g, '_').replace(/^_+|_+$/g, '');
  // `.` and `..` survive the allow-list but are confusing/unsafe as an ssh-config Host and as a
  // key-file name component (`wireferry_..`) — fall back to a safe default.
  if (cleaned === '' || cleaned === '.' || cleaned === '..') {
    return 'server';
  }
  return cleaned;
}

// Pick ~/.ssh/<baseName>, bumping _2, _3… so we never silently overwrite an existing key pair.
export async function uniqueKeyPath(baseName: string): Promise<string> {
  const sshDir = path.join(os.homedir(), '.ssh');
  let candidate = path.join(sshDir, baseName);
  let i = 2;
  // eslint-disable-next-line no-await-in-loop
  while ((await fse.pathExists(candidate)) || (await fse.pathExists(`${candidate}.pub`))) {
    candidate = path.join(sshDir, `${baseName}_${i}`);
    i += 1;
  }
  return candidate;
}

// --- local key files ---------------------------------------------------------------------------

// Write the key pair locally with private-key permissions locked down. On *nix that's chmod 600; on
// Windows `ssh` refuses a key whose ACL is inheritable / world-readable, so we strip inheritance and
// grant only the current user. Best-effort on the ACL step — the key still exists if icacls fails.
export async function writeKeyFiles(privateKeyPath: string, keys: GeneratedKey): Promise<void> {
  await fse.ensureDir(path.dirname(privateKeyPath));
  const privateBody = keys.private.endsWith('\n') ? keys.private : `${keys.private}\n`;
  await fse.writeFile(privateKeyPath, privateBody, { mode: 0o600 });
  await fse.writeFile(`${privateKeyPath}.pub`, `${keys.public.trim()}\n`, { mode: 0o644 });
  await restrictPrivateKeyPermissions(privateKeyPath);
}

async function restrictPrivateKeyPermissions(keyPath: string): Promise<void> {
  if (!isWindows) {
    await fse.chmod(keyPath, 0o600);
    return;
  }
  const user = os.userInfo().username;
  await new Promise<void>(resolve => {
    // /inheritance:r drops inherited ACEs; /grant:r replaces with full control for just this user.
    execFile('icacls', [keyPath, '/inheritance:r', '/grant:r', `${user}:F`], err => {
      if (err) {
        logger.warn(
          `icacls failed to lock down ${keyPath}: ${err.message}. ssh may refuse the key until its permissions are tightened.`
        );
      }
      resolve();
    });
  });
}

// --- remote deploy -----------------------------------------------------------------------------

// SFTP paths don't expand `~`, so resolve the real home via realpath('.') before touching ~/.ssh.
async function resolveRemoteHome(sftp: any): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    sftp.realpath('.', (err: Error, abs: string) => (err ? reject(err) : resolve(abs)));
  });
}

// First two tokens (algo + base64 blob) identify a public key; the trailing comment varies between
// generations, so dedup must ignore it.
function keyId(line: string): string {
  const parts = line.trim().split(/\s+/);
  if (parts.length >= 2 && /^(ssh-|ecdsa-|sk-)/.test(parts[0])) {
    return `${parts[0]} ${parts[1]}`;
  }
  return '';
}

// Append the public key to the server's authorized_keys (idempotent: skips if the same key is
// already present). Creates ~/.ssh (700) and locks authorized_keys to 600. Never logs file content
// (it may hold other users' keys). `remotefs` is the SFTPFileSystem from fileService; we use its raw
// ssh2 sftp handle. Returns whether the key was newly added.
export async function deployPublicKey(remotefs: any, publicKey: string): Promise<boolean> {
  const sftp = remotefs.sftp;
  const home = await resolveRemoteHome(sftp);
  const sshDir = `${home}/.ssh`;
  const authKeys = `${sshDir}/authorized_keys`;

  await sftpMkdir(sftp, sshDir);
  await sftpChmod(sftp, sshDir, 0o700);

  let existing = '';
  try {
    existing = (await sftpReadFile(sftp, authKeys)).toString('utf8');
  } catch (err) {
    // Only a genuinely-missing file means "start fresh". Any other read error (permission, transient,
    // protocol) must abort: treating it as empty would rewrite authorized_keys with just the new key
    // and lock the user — and every existing key — out.
    if (!isNoSuchFile(err)) {
      throw new Error(
        `cannot read ${authKeys}; refusing to overwrite it: ${(err && (err as any).message) || err}`
      );
    }
    existing = '';
  }

  const newEntry = publicKey.trim();
  const newId = keyId(newEntry);
  const alreadyPresent =
    newId !== '' && existing.split(/\r?\n/).some(line => keyId(line) === newId);
  if (alreadyPresent) {
    return false;
  }

  const needsNewline = existing.length > 0 && !existing.endsWith('\n');
  const content = `${existing}${needsNewline ? '\n' : ''}${newEntry}\n`;
  await sftpWriteFile(sftp, authKeys, content, 0o600);
  await sftpChmod(sftp, authKeys, 0o600);
  return true;
}

function sftpMkdir(sftp: any, dir: string): Promise<void> {
  // Ignore errors: the dir usually already exists (EEXIST). chmod afterwards fixes loose perms.
  return new Promise<void>(resolve => sftp.mkdir(dir, { mode: 0o700 }, () => resolve()));
}

function sftpChmod(sftp: any, p: string, mode: number): Promise<void> {
  return new Promise<void>(resolve => sftp.chmod(p, mode, () => resolve()));
}

function sftpReadFile(sftp: any, p: string): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) =>
    sftp.readFile(p, (err: Error, data: Buffer) => (err ? reject(err) : resolve(data)))
  );
}

// ssh2 surfaces SFTP status 2 (SSH_FX_NO_SUCH_FILE) as err.code === 2; some layers use 'ENOENT'.
// Anything else (e.g. permission denied) is NOT "missing" and must not be treated as an empty file.
// Match ONLY the structured code — never sniff the message text. A permission-denied or transient
// error whose message merely contains "no such file" (some sshd/sftp wrappers phrase EACCES that way)
// would otherwise be misread as "missing", reset `existing` to '', and overwrite authorized_keys with
// just the new key — wiping every other key and locking the user out. The code is authoritative.
function isNoSuchFile(err: any): boolean {
  if (!err) {
    return false;
  }
  return err.code === 2 || err.code === 'ENOENT';
}

function sftpWriteFile(sftp: any, p: string, data: string, mode: number): Promise<void> {
  return new Promise<void>((resolve, reject) =>
    sftp.writeFile(p, data, { mode }, (err: Error) => (err ? reject(err) : resolve()))
  );
}

// --- ~/.ssh/config -----------------------------------------------------------------------------

// Reject anything that could break out of a single ssh-config directive: control chars / newlines
// (multi-line injection), quotes, and glob metacharacters (a `*` in Host would apply our key to
// other hosts → key leak). The generated alias is already clean; host/user/path come from config.
function isSafeSshValue(v: string): boolean {
  return (
    typeof v === 'string' &&
    v.length > 0 &&
    !/\s/.test(v) && // no whitespace (newlines/tabs/space) blocks directive injection
    !/["'`]/.test(v) &&
    !/[*?!]/.test(v)
  );
}

// IdentityFile is a local PATH, where a space is normal (Windows: C:\Users\John Doe\.ssh\…). The
// ssh-config library quotes a spaced value on its own, so we only block newlines/tabs (directive
// injection) and quotes — not spaces, which the strict value check above would wrongly reject.
function isSafePathValue(v: string): boolean {
  return typeof v === 'string' && v.length > 0 && !/[\r\n\t]/.test(v) && !/["'`]/.test(v);
}

function timestampSuffix(): string {
  return new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\..+$/, '')
    .replace('T', '_');
}

export interface SshConfigEntry {
  alias: string;
  hostName: string;
  user: string;
  port: number;
  identityFile: string;
  sshConfigPath?: string;
}

// Add a Host section pointing at the new key. Skips (returns 'exists') if the alias is already
// defined — never duplicates or clobbers existing sections. Timestamped backup before writing.
// Invalidates WireFerry's cached copy of the file so the new IdentityFile is picked up this session.
export async function updateSshConfig(
  entry: SshConfigEntry
): Promise<'written' | 'exists'> {
  const file = replaceHomePath(entry.sshConfigPath || DEFAULT_SSH_CONFIG);

  for (const [k, v] of Object.entries({
    Host: entry.alias,
    HostName: entry.hostName,
    User: entry.user,
  })) {
    if (!isSafeSshValue(v as string)) {
      throw new Error(`Refusing to write an unsafe value into ~/.ssh/config (${k}): ${v}`);
    }
  }
  if (!isSafePathValue(entry.identityFile)) {
    throw new Error(
      `Refusing to write an unsafe IdentityFile into ~/.ssh/config: ${entry.identityFile}`
    );
  }

  let content = '';
  try {
    content = await fse.readFile(file, 'utf8');
  } catch {
    content = '';
  }

  const parsed = sshConfig.parse(content);
  if (parsed.find({ Host: entry.alias })) {
    return 'exists';
  }

  if (content) {
    await fse.writeFile(`${file}.bak.${timestampSuffix()}`, content);
  }

  parsed.append({
    Host: entry.alias,
    HostName: entry.hostName,
    User: entry.user,
    Port: String(entry.port),
    IdentityFile: entry.identityFile,
    IdentitiesOnly: 'yes',
  });

  await fse.ensureDir(path.dirname(file));
  await fse.writeFile(file, parsed.toString(), { mode: 0o600 });
  // Drop WireFerry's cached read of this file (src/core/fileService reads it through app.fsCache).
  app.fsCache.del(file);
  return 'written';
}

// --- verify before commit ----------------------------------------------------------------------

// Try a real key-based login before we touch the profile / remove a password. A blind append to
// authorized_keys can "succeed" while sshd ignores the file (Windows OpenSSH, managed hosts,
// AuthorizedKeysFile policy), so we never switch the user over to an unverified key.
export function testKeyAuth(params: {
  host: string;
  port: number;
  username: string;
  privateKey: string;
  passphrase?: string;
}): Promise<boolean> {
  return new Promise<boolean>(resolve => {
    const conn = new ssh2.Client();
    let settled = false;
    let timer: any;
    const finish = (ok: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      try {
        conn.end();
      } catch {
        /* ignore */
      }
      resolve(ok);
    };
    // Guard the whole attempt: readyTimeout covers the SSH handshake, but a host that never answers
    // the TCP SYN can otherwise hang on the OS connect timeout (minutes), freezing the setup wizard.
    timer = setTimeout(() => finish(false), 20000);
    conn
      .on('ready', () => finish(true))
      .on('error', () => finish(false));
    try {
      conn.connect({
        host: params.host,
        port: params.port,
        username: params.username,
        privateKey: params.privateKey,
        passphrase: params.passphrase,
        readyTimeout: 15000,
      });
    } catch {
      finish(false);
    }
  });
}

// --- profile config edit -----------------------------------------------------------------------

const JSONC_FORMAT = { tabSize: 2, insertSpaces: true } as const;

// Set privateKeyPath (and optionally clear the plaintext password) at a precise location in the
// JSONC config, preserving comments/formatting via jsonc-parser. `basePath` points at the object to
// edit: [] for a single-object config, ['profiles', name] for a profile. Caller computes basePath
// and must be sure of it — we never guess across an array of servers.
export async function updateProfileConfig(params: {
  filePath: string;
  basePath: (string | number)[];
  identityFile: string;
  clearPassword: boolean;
  clearInheritedPassword?: boolean;
  passphraseMode?: 'keychain' | 'prompt';
}): Promise<void> {
  let text = await fse.readFile(params.filePath, 'utf8');

  text = applyJsoncEdit(text, [...params.basePath, 'privateKeyPath'], params.identityFile);
  if (params.clearPassword) {
    // undefined deletes the property; null is written explicitly to SHADOW a password inherited from
    // a top-level field (deleting only the profile's own key would leave the inherited one active).
    text = applyJsoncEdit(
      text,
      [...params.basePath, 'password'],
      params.clearInheritedPassword ? null : undefined
    );
  }
  if (params.passphraseMode === 'keychain') {
    // The key is encrypted and its passphrase was saved to the keychain — route it there so a
    // future connect can decrypt the key instead of failing silently.
    text = applyJsoncEdit(text, [...params.basePath, 'passphrase'], 'secretStorage');
  } else if (params.passphraseMode === 'prompt') {
    // Encrypted key, but the passphrase was not stored — prompt on every connect (true) rather
    // than point at an empty keychain slot, which would re-offer to save each time.
    text = applyJsoncEdit(text, [...params.basePath, 'passphrase'], true);
  }

  await fse.writeFile(params.filePath, text);
}

function applyJsoncEdit(text: string, jsonPath: (string | number)[], value: any): string {
  const edits = modify(text, jsonPath, value, { formattingOptions: JSONC_FORMAT });
  return applyEdits(text, edits);
}

// Locate the JSONC node to edit for a given server: [] for a single-object config, [index] for an
// array (matched on the full identity protocol/host/port/username — null when there isn't exactly
// one match, so the caller can fall back to manual editing), or ['profiles', name]. Shared by the
// generate-key and save-password commands so both edit the exact same node.
export function resolveServerBasePath(
  parsed: any,
  target: { config: any; profile?: string }
): (string | number)[] | null {
  if (Array.isArray(parsed)) {
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
    return matches.length === 1 ? [parsed.indexOf(matches[0])] : null;
  }
  if (parsed && parsed.profiles && target.profile) {
    return ['profiles', target.profile];
  }
  if (parsed && typeof parsed === 'object') {
    return [];
  }
  return null;
}

// Write a single field at a precise JSONC node, preserving comments and formatting.
export async function setProfileField(
  filePath: string,
  basePath: (string | number)[],
  field: string,
  value: any
): Promise<void> {
  let text = await fse.readFile(filePath, 'utf8');
  text = applyJsoncEdit(text, [...basePath, field], value);
  await fse.writeFile(filePath, text);
}
