const { parseId, relationTo, canUserWrite, canUserRead } = require('../src/helper/identity');

// The write-permission hints in the tree hinge on parsing `id` and applying POSIX owner→group→other
// precedence. Guard both.
describe('parseId', () => {
  test('typical id line — uid, gid, and all supplementary groups', () => {
    const id = parseId('uid=1000(deploy) gid=1000(deploy) groups=1000(deploy),27(sudo),33(www-data)');
    expect(id.uid).toBe(1000);
    expect([...id.gids].sort((a, b) => a - b)).toEqual([27, 33, 1000]);
  });

  test('root', () => {
    const id = parseId('uid=0(root) gid=0(root) groups=0(root)');
    expect(id.uid).toBe(0);
    expect(id.gids.has(0)).toBe(true);
  });

  test('no groups= section still yields the primary gid', () => {
    const id = parseId('uid=1000(x) gid=1000(x)');
    expect(id.uid).toBe(1000);
    expect([...id.gids]).toEqual([1000]);
  });

  test('busybox id — bare numeric groups without (name)', () => {
    const id = parseId('uid=0(root) gid=0(root) groups=0,1,2,3');
    expect(id.uid).toBe(0);
    expect([...id.gids].sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);
  });

  test('garbage / missing uid returns null', () => {
    expect(parseId('not an id line')).toBeNull();
    expect(parseId('')).toBeNull();
    expect(parseId(undefined)).toBeNull();
  });
});

describe('relationTo', () => {
  const id = { uid: 1000, gids: new Set([1000, 33]) };
  test('owner / group / other', () => {
    expect(relationTo(1000, 5, id)).toBe('owner');
    expect(relationTo(0, 33, id)).toBe('group');
    expect(relationTo(0, 0, id)).toBe('other');
  });
  test('unknown owner and group => undefined', () => {
    expect(relationTo(undefined, undefined, id)).toBeUndefined();
  });
});

describe('canUserWrite', () => {
  const user = { uid: 1000, gids: new Set([1000, 33]) };

  test('root writes anything', () => {
    const root = { uid: 0, gids: new Set([0]) };
    expect(canUserWrite(0o400, 0, 0, root)).toBe(true);
  });

  test('owner uses the owner-write bit, not group/other', () => {
    // owner, mode 644 -> owner has write
    expect(canUserWrite(0o644, 1000, 0, user)).toBe(true);
    // owner, mode 400 -> NO owner write, even though nothing else grants it
    expect(canUserWrite(0o400, 1000, 0, user)).toBe(false);
    // owner, mode 4 (o+r only) -> owner has neither r nor w for owner class -> not writable
    expect(canUserWrite(0o004, 1000, 0, user)).toBe(false);
  });

  test('group member uses the group-write bit', () => {
    expect(canUserWrite(0o664, 0, 33, user)).toBe(true); // group has write
    expect(canUserWrite(0o644, 0, 33, user)).toBe(false); // group read-only
  });

  test('other: the root-owned 644 config case is read-only', () => {
    expect(canUserWrite(0o644, 0, 0, user)).toBe(false);
    expect(canUserWrite(0o646, 0, 0, user)).toBe(true); // world-writable
  });

  test('unknown owner/group => undefined (no claim)', () => {
    expect(canUserWrite(0o644, undefined, undefined, user)).toBeUndefined();
  });

  test('known owner (not us) + unknown group falls through to other', () => {
    // uid=0 (root-owned, not us), gid unknown → owner/group classes skipped, "other" bit decides
    expect(canUserWrite(0o646, 0, undefined, user)).toBe(true); // other-writable
    expect(canUserWrite(0o644, 0, undefined, user)).toBe(false); // other read-only
  });
});

describe('canUserRead', () => {
  const user = { uid: 1000, gids: new Set([1000, 33]) };
  const root = { uid: 0, gids: new Set([0]) };

  test('root reads anything', () => {
    expect(canUserRead(0o000, 0, 0, root)).toBe(true);
  });

  test('owner uses the owner-read bit, not group/other', () => {
    expect(canUserRead(0o400, 1000, 0, user)).toBe(true); // owner readable
    expect(canUserRead(0o044, 1000, 0, user)).toBe(false); // owner has no read even though group/other do
  });

  test('the root-owned 600 file is unreadable to a non-root user (the 🔒 case)', () => {
    expect(canUserRead(0o600, 0, 0, user)).toBe(false); // root:root 600 → other has no read
    expect(canUserRead(0o644, 0, 0, user)).toBe(true); // root:root 644 → other-readable
  });

  test('group member uses the group-read bit', () => {
    expect(canUserRead(0o640, 0, 33, user)).toBe(true); // group read
    expect(canUserRead(0o600, 0, 33, user)).toBe(false); // group no read
  });

  test('unknown owner/group => undefined (no claim)', () => {
    expect(canUserRead(0o644, undefined, undefined, user)).toBeUndefined();
  });
});
