// Connection identity: a stable, secret-free string answering "which server is this connection for".
// It is the cache key (remoteFs.fsTable), the pending-save key, and the dispose key — so open and
// close must compute the exact same value. Kept free of heavy imports so it can be unit-tested directly.

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

// Secrets must never enter the connection identity. The identity is used as a plain-string Map key
// (fsTable / _openedHostInfos), so a password there would leak into key enumeration; and keying by a
// resolved-vs-sentinel value would split one server across two cache slots.
const IDENTITY_SECRET_KEYS = ['password', 'passphrase', 'privateKey'];

// Deep clone minus secrets. MUST recurse: a hop/jump-host block carries its own
// password/passphrase/privateKey, and SSHClient writes hop.privateKey back after it reads
// privateKeyPath — a shallow strip would (a) leak those into the identity string and into the
// long-lived _openedHostInfos map, and (b) make the identity unstable, because it would change the
// moment hop.privateKey is filled in, so a pending "save credential?" registered under the
// pre-connect identity would never be found or cleared post-connect. interactiveAuth is reduced to a
// bare boolean so predefined answers don't leak, while still telling interactive from non-interactive.
export function stripSecretsForIdentity(value: any): any {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(stripSecretsForIdentity);
  }
  const copy: any = {};
  Object.keys(value).forEach(key => {
    if (IDENTITY_SECRET_KEYS.indexOf(key) !== -1) {
      return;
    }
    if (key === 'interactiveAuth' && Array.isArray(value[key])) {
      copy[key] = true;
      return;
    }
    copy[key] = stripSecretsForIdentity(value[key]);
  });
  return copy;
}

// Single source of truth for "what connection is this" — shared by the connection cache (remoteFs)
// and FileService._openedHostInfos so open and dispose compute the exact same key.
export function hostIdentity(option: any): string {
  return stableStringify(stripSecretsForIdentity(option));
}
