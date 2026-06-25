import * as vscode from 'vscode';
import logger from '../logger';

// Credential storage backed by the OS keychain via VS Code's SecretStorage (Windows Credential
// Manager / macOS Keychain / Linux libsecret). Lets a config keep `"password": "secretStorage"`
// instead of a plaintext secret. See src/core/fileService.ts (resolveCredentials) for the read
// path and commandDeleteSavedPassword for management.

export type CredentialType = 'password' | 'passphrase';

// Everything needed to compute a stable, collision-free keychain key. The tuple is RESOLVED
// (protocol/host/port/username after ssh-config merge + default-port fill) so the same real
// account always maps to the same entry.
export interface CredentialDescriptor {
  protocol: string;
  host: string;
  port: number;
  username: string;
  type: CredentialType;
}

// Parallel index of stored descriptors (NEVER the secret values). SecretStorage has no
// "enumerate keys" API, so without this a credential whose config was later renamed/removed would
// be orphaned in the OS keychain with no way to surface it for deletion.
const INDEX_KEY = 'wireferry.savedCredentials';

let _secrets: vscode.SecretStorage | undefined;
let _globalState: vscode.Memento | undefined;

export function initSecrets(context: vscode.ExtensionContext): void {
  _secrets = context.secrets;
  _globalState = context.globalState;
}

// encodeURIComponent each free-form part: a ':' inside an IPv6 host literal ([::1]) would
// otherwise merge two distinct identities — ('a','b:c') and ('a:b','c') must not collide.
// protocol + port are part of the key too: an FTP password and an SSH password for the same
// user@host are different secrets. `v1` lets the format evolve without clashing with old entries.
export function credentialKey(d: CredentialDescriptor): string {
  return `wireferry:v1:${d.protocol}:${encodeURIComponent(d.host)}:${d.port}:${encodeURIComponent(
    d.username
  )}:${d.type}`;
}

export async function getCredential(d: CredentialDescriptor): Promise<string | undefined> {
  if (!_secrets) {
    return undefined;
  }
  return _secrets.get(credentialKey(d));
}

export async function storeCredential(d: CredentialDescriptor, value: string): Promise<void> {
  if (!_secrets) {
    return;
  }
  await _secrets.store(credentialKey(d), value);
  await addToIndex(d);
}

export async function deleteCredential(d: CredentialDescriptor): Promise<void> {
  if (!_secrets) {
    return;
  }
  await _secrets.delete(credentialKey(d));
  await removeFromIndex(d);
}

// Descriptors known to be (or have been) stored — for the delete command's pick list. Values are
// never kept here; the actual secret stays in SecretStorage.
export function listIndexedCredentials(): CredentialDescriptor[] {
  if (!_globalState) {
    return [];
  }
  return _globalState.get<CredentialDescriptor[]>(INDEX_KEY, []);
}

// globalState has no atomic read-modify-write, so serialize every index mutation through a single
// promise chain. Two stores firing at once would otherwise both read the old list and the later
// update() would clobber the earlier append — a lost row leaves an orphaned keychain entry the
// delete UI can never surface. A rejected task must not poison the chain for the next writer.
let _indexWrite: Promise<void> = Promise.resolve();

function serializeIndexWrite(task: () => Promise<void>): Promise<void> {
  const run = _indexWrite.then(task, task);
  // Keep the chain alive if a write rejects, but don't swallow it silently: a failed index update
  // can leave a secret in the keychain that the delete UI (which lists only the index) can't show.
  _indexWrite = run.catch(err => {
    logger.warn(
      `wireferry: credential index write failed: ${err && err.message ? err.message : err}`
    );
  });
  return run;
}

function addToIndex(d: CredentialDescriptor): Promise<void> {
  return serializeIndexWrite(async () => {
    if (!_globalState) {
      return;
    }
    const key = credentialKey(d);
    const list = listIndexedCredentials();
    if (list.some(x => credentialKey(x) === key)) {
      return;
    }
    list.push({
      protocol: d.protocol,
      host: d.host,
      port: d.port,
      username: d.username,
      type: d.type,
    });
    await _globalState.update(INDEX_KEY, list);
  });
}

function removeFromIndex(d: CredentialDescriptor): Promise<void> {
  return serializeIndexWrite(async () => {
    if (!_globalState) {
      return;
    }
    const key = credentialKey(d);
    const list = listIndexedCredentials().filter(x => credentialKey(x) !== key);
    await _globalState.update(INDEX_KEY, list);
  });
}

// --- pending saves -----------------------------------------------------------------------------
// Identities whose config opted into keychain storage (sentinel "secretStorage") but had nothing
// saved yet. When such a connection succeeds we offer to save the value the user just typed. Keyed
// by the secret-free connection identity (src/core/remoteFs.hostIdentity) and cleared on read.
const _pendingSaves = new Map<string, CredentialDescriptor[]>();

export function registerPendingSave(identity: string, descriptor: CredentialDescriptor): void {
  const list = _pendingSaves.get(identity) || [];
  if (!list.some(d => credentialKey(d) === credentialKey(descriptor))) {
    list.push(descriptor);
  }
  _pendingSaves.set(identity, list);
}

export function takePendingSaves(identity: string): CredentialDescriptor[] {
  const list = _pendingSaves.get(identity) || [];
  _pendingSaves.delete(identity);
  return list;
}
