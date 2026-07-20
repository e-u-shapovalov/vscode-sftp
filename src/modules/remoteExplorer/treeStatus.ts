import upath from '../../core/upath';
import FileSystem, { FileEntry, FileType } from '../../core/fs/fileSystem';

// Combined local↔remote status of a tree entry. A `const` object (NOT a `const enum`) keeps the
// transpile-only Jest build able to read the members across modules.
export const NodeStatus = {
  Synced: 'synced',
  Modified: 'modified',
  LocalOnly: 'localOnly',
  RemoteOnly: 'remoteOnly',
  Conflict: 'conflict',
  Unknown: 'unknown',
  Denied: 'denied',
} as const;
export type NodeStatusValue = typeof NodeStatus[keyof typeof NodeStatus];

export type ContentVerdict = 'equal' | 'different' | 'unavailable';

export interface ContentVerification {
  key: string;
  verdict: ContentVerdict;
}

export interface StatusDecision {
  status: NodeStatusValue;
  // Present only for two regular files whose sizes match but mtimes do not. The tree computes MD5 in
  // the background and feeds the resulting verdict back into this function on the next render.
  verificationKey?: string;
}

function sameMtimeSecond(a: number, b: number): boolean {
  return Math.floor(a / 1000) === Math.floor(b / 1000);
}

// The facts that make an MD5 verdict reusable. Any local/server size or mtime change produces a new
// key, so an old background result cannot repaint a file that changed while it was being hashed.
export function contentVerificationKey(remote: FileEntry, local: FileEntry): string {
  return JSON.stringify([
    remote.fspath,
    remote.size,
    remote.mtime,
    local.fspath,
    local.size,
    local.mtime,
  ]);
}

// Cheap facts first, MD5 only for the ambiguous case. A size/type difference proves the two sides
// differ. Equal size + equal mtime-second is the fast synced path. Equal size + different mtime needs
// a content check; while that check is pending we deliberately do not show M, because M is meant to
// describe content rather than a harmless timestamp difference. If MD5 is unavailable, mtime remains
// the compatibility fallback and the verdict is Modified.
export function decideStatus(
  remote: FileEntry,
  local?: FileEntry,
  verification?: ContentVerification
): StatusDecision {
  if (!local) {
    return { status: NodeStatus.RemoteOnly };
  }
  if (remote.type === FileType.Directory || local.type === FileType.Directory) {
    return {
      status: remote.type === local.type ? NodeStatus.Synced : NodeStatus.Conflict,
    };
  }
  if (remote.type !== local.type) {
    return { status: NodeStatus.Modified };
  }
  if (remote.size !== local.size) {
    return { status: NodeStatus.Modified };
  }
  if (sameMtimeSecond(remote.mtime, local.mtime)) {
    return { status: NodeStatus.Synced };
  }
  // Hash only real regular files. Hashing a symlink follows its target on one or both sides and would
  // answer a different question; unknown/special files retain the old metadata fallback.
  if (remote.type !== FileType.File) {
    return { status: NodeStatus.Modified };
  }

  const key = contentVerificationKey(remote, local);
  if (verification && verification.key === key) {
    return {
      status:
        verification.verdict === 'equal' ? NodeStatus.Synced : NodeStatus.Modified,
      verificationKey: key,
    };
  }
  return { status: NodeStatus.Synced, verificationKey: key };
}

// The tree node's contextValue for VS Code menu `when` clauses. A status suffix (Synced / RemoteOnly /
// LocalOnly) lets menus hide or relabel actions per state; Modified and the error states (Denied /
// Conflict / Unknown / not-yet-known) keep the bare file/folder value, so every existing `viewItem ==
// file` clause still matches them and only the two new states need new clauses.
export function contextValueFor(status: NodeStatusValue | undefined, isDirectory: boolean): string {
  const kind = isDirectory ? 'folder' : 'file';
  switch (status) {
    case NodeStatus.LocalOnly:
      return `${kind}LocalOnly`;
    case NodeStatus.RemoteOnly:
      return `${kind}RemoteOnly`;
    case NodeStatus.Synced:
      return `${kind}Synced`;
    default:
      return kind;
  }
}

// All parents of `itemPath`, nearest first and including `rootPath`. Returning paths (rather than tree
// nodes) keeps this logic pure; the provider maps only the ancestors already present in its cache.
export function ancestorPaths(itemPath: string, rootPath: string): string[] {
  // Normalise AND strip a trailing slash (except a bare "/") so a remotePath like "/var/www/" — or the
  // default "./" — compares equal to the walked-up parent. Without this the loop never recognises the
  // root: `current` reaches "/var/www" but `root` stays "/var/www/", so it walks one level PAST the root,
  // hits a "../" relative, and threw the whole ancestor list away — leaving every parent folder without
  // its descendant-M badge.
  const norm = (p: string): string => {
    const n = upath.normalize(p);
    return n.length > 1 ? n.replace(/\/+$/, '') || '/' : n;
  };
  const item = norm(itemPath);
  const root = norm(rootPath);
  const relative = upath.relative(root, item);
  if (relative === '' || relative === '..' || relative.startsWith('../') || upath.isAbsolute(relative)) {
    return [];
  }

  const result: string[] = [];
  let current = item;
  while (current !== root) {
    const parent = upath.dirname(current);
    if (parent === current) {
      // Reached the filesystem root without matching `root`. The relative check above already proved item
      // is under root, so this only guards against an infinite loop — return what we collected, never [].
      break;
    }
    result.push(parent);
    current = parent;
  }
  return result;
}

// Set a matching local file's mtime to the server value without touching a file that changed during
// hashing. Opening first and fstat-ing that exact handle closes the usual replace/change race as far as
// the filesystem metadata can tell. `false` means the snapshot is stale and should be recomputed.
export async function alignLocalMtimeIfUnchanged(
  localFs: FileSystem,
  localPath: string,
  expectedSize: number,
  expectedMtime: number,
  remoteMtime: number,
  beforeWrite?: () => void
): Promise<boolean> {
  const fd = await localFs.open(localPath, 'r');
  try {
    const current = await localFs.fstat(fd);
    if (
      current.type !== FileType.File ||
      current.size !== expectedSize ||
      current.mtime !== expectedMtime
    ) {
      return false;
    }
    // FileSystem.futimes uses seconds. Fractions preserve the local atime and the server timestamp down
    // to the precision supported by the local filesystem.
    if (beforeWrite) {
      beforeWrite();
    }
    await localFs.futimes(fd, current.atime / 1000, remoteMtime / 1000);
    return true;
  } finally {
    await localFs.close(fd);
  }
}
