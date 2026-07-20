// The current SSH user's identity, used to decide — advisory only — whether they can write a given
// remote file. Captured once per connection from `id` and compared against each entry's owner/group.
export interface UserIdentity {
  uid: number;
  // Effective group memberships: the primary gid plus every supplementary group.
  gids: Set<number>;
}

// Parse the output of `id`, e.g.
//   "uid=1000(deploy) gid=1000(deploy) groups=1000(deploy),27(sudo),33(www-data)"
// into { uid, gids }. Returns null when the line doesn't contain a uid (unexpected shell / no `id`).
export function parseId(output: unknown): UserIdentity | null {
  if (typeof output !== 'string') {
    return null;
  }
  const uidMatch = output.match(/uid=(\d+)/);
  if (!uidMatch) {
    return null;
  }
  const uid = parseInt(uidMatch[1], 10);
  const gids = new Set<number>();
  const gidMatch = output.match(/gid=(\d+)/);
  if (gidMatch) {
    gids.add(parseInt(gidMatch[1], 10));
  }
  const groupsMatch = output.match(/groups=([^\r\n]*)/);
  if (groupsMatch) {
    // Each entry is "<id>(<name>)"; take the numeric id that precedes each "(".
    let m: RegExpExecArray | null;
    const re = /(\d+)\(/g;
    // tslint:disable-next-line no-conditional-assignment
    while ((m = re.exec(groupsMatch[1])) !== null) {
      gids.add(parseInt(m[1], 10));
    }
    // busybox `id` prints bare numeric groups without "(name)" (e.g. "groups=0,1,2"). If the paren form
    // matched nothing, fall back to splitting the comma list so supplementary groups aren't lost.
    if (gids.size <= 1) {
      for (const part of groupsMatch[1].split(',')) {
        const n = parseInt(part.trim(), 10);
        if (!isNaN(n)) {
          gids.add(n);
        }
      }
    }
  }
  return { uid, gids };
}

// How the current user relates to a file's ownership — which permission class applies to them.
// 'owner' when they are the owner, 'group' when they're a member of the file's group (but not the
// owner), 'other' otherwise. undefined when the owner/group aren't known. Root is reported by its
// real relation; callers treat root as all-powerful separately.
export type OwnershipRelation = 'owner' | 'group' | 'other';

export function relationTo(
  uid: number | undefined,
  gid: number | undefined,
  id: UserIdentity
): OwnershipRelation | undefined {
  if (uid === undefined && gid === undefined) {
    return undefined;
  }
  if (uid !== undefined && uid === id.uid) {
    return 'owner';
  }
  if (gid !== undefined && id.gids.has(gid)) {
    return 'group';
  }
  return 'other';
}

// Whether `id` can write a file with the given POSIX `mode` (only the permission bits matter) owned by
// `uid`/`gid`. Mirrors the kernel's owner → group → other precedence. Advisory: it ignores ACLs,
// read-only mounts, and the write+execute a directory needs — callers use it as a hint, not a promise.
// Returns undefined when the file's numeric owner/group aren't known (e.g. FTP), so no claim is made.
export function canUserWrite(
  mode: number,
  uid: number | undefined,
  gid: number | undefined,
  id: UserIdentity
): boolean | undefined {
  if (id.uid === 0) {
    return true; // root ignores the permission bits
  }
  if (uid === undefined && gid === undefined) {
    return undefined; // nothing to compare against
  }
  // Owner class takes precedence: if the user IS the owner, only the owner-write bit counts — a file
  // you own but with mode 0400 is NOT writable even if group/other happen to allow it.
  if (uid !== undefined && uid === id.uid) {
    return (mode & 0o200) !== 0; // tslint:disable-line no-bitwise
  }
  if (gid !== undefined && id.gids.has(gid)) {
    return (mode & 0o020) !== 0; // tslint:disable-line no-bitwise
  }
  return (mode & 0o002) !== 0; // tslint:disable-line no-bitwise
}

// Whether `id` can READ a file's content — mirror of canUserWrite on the read bits (0o400/0o040/0o004),
// same owner → group → other precedence. Advisory (ignores ACLs / mounts). undefined when the numeric
// owner/group aren't known (FTP), so no claim is made; root reads everything.
export function canUserRead(
  mode: number,
  uid: number | undefined,
  gid: number | undefined,
  id: UserIdentity
): boolean | undefined {
  if (id.uid === 0) {
    return true; // root ignores the permission bits
  }
  if (uid === undefined && gid === undefined) {
    return undefined;
  }
  if (uid !== undefined && uid === id.uid) {
    return (mode & 0o400) !== 0; // tslint:disable-line no-bitwise
  }
  if (gid !== undefined && id.gids.has(gid)) {
    return (mode & 0o040) !== 0; // tslint:disable-line no-bitwise
  }
  return (mode & 0o004) !== 0; // tslint:disable-line no-bitwise
}
