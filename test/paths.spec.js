const os = require('os');
const path = require('path');
const { isRemoteSubpathOf, isSubpathOf, replaceHomePath } = require('../src/helper/paths');

// Regression guard for the containment check used by UResource.from (both the remote branch and the
// local branch added in the reliability pass). A relative remotePath — including the DEFAULT './' —
// must be accepted for legitimate children, while a leading '..' escape must still be rejected.
describe('isRemoteSubpathOf', () => {
  test('relative root "./" / "." contains its children (default remotePath)', () => {
    expect(isRemoteSubpathOf('./', 'file.txt')).toBe(true);
    expect(isRemoteSubpathOf('./', 'dir/sub/file.txt')).toBe(true);
    expect(isRemoteSubpathOf('.', 'file.txt')).toBe(true);
  });

  test('relative root still rejects a leading ".." escape', () => {
    expect(isRemoteSubpathOf('./', '../escape')).toBe(false);
    expect(isRemoteSubpathOf('./', '..')).toBe(false);
    expect(isRemoteSubpathOf('.', '../../etc/passwd')).toBe(false);
  });

  test('absolute root contains children and rejects outsiders + sibling-prefix', () => {
    expect(isRemoteSubpathOf('/var/www', '/var/www/x')).toBe(true);
    expect(isRemoteSubpathOf('/var/www', '/var/www')).toBe(true);
    expect(isRemoteSubpathOf('/var/www/', '/var/www/x')).toBe(true);
    expect(isRemoteSubpathOf('/var/www', '/etc/passwd')).toBe(false);
    expect(isRemoteSubpathOf('/var/www', '/var/www-evil/x')).toBe(false);
  });

  test('relative non-trivial root', () => {
    expect(isRemoteSubpathOf('sub/dir', 'sub/dir/f')).toBe(true);
    expect(isRemoteSubpathOf('sub/dir', 'x')).toBe(false);
  });
});

describe('isSubpathOf', () => {
  test('contains children and rejects sibling with shared prefix', () => {
    const sep = require('path').sep;
    const root = `${sep}a${sep}b`;
    expect(isSubpathOf(root, `${root}${sep}c`)).toBe(true);
    expect(isSubpathOf(root, root)).toBe(true);
    expect(isSubpathOf(root, `${sep}a${sep}b-x${sep}c`)).toBe(false);
  });
});

describe('replaceHomePath', () => {
  test('expands a ~/ home prefix', () => {
    expect(replaceHomePath('~/foo')).toBe(path.join(os.homedir(), 'foo'));
  });

  test('expands a ~\\ home prefix (Windows-style privateKeyPath / sshConfigPath)', () => {
    expect(replaceHomePath('~\\foo')).toBe(path.join(os.homedir(), 'foo'));
  });

  test('leaves non-home paths untouched', () => {
    expect(replaceHomePath('relative/path')).toBe('relative/path');
    expect(replaceHomePath('/abs/path')).toBe('/abs/path');
    // "~user" is a username prefix, not a home shortcut — must not be expanded.
    expect(replaceHomePath('~user/foo')).toBe('~user/foo');
  });
});
