const { parseLongnameOwner } = require('../src/helper/longname');

// Owner/group in the tooltip come free from the OpenSSH readdir `longname` (the `ls -l` line). Guard
// the parser: real lines yield the right names, and anything that doesn't look like an ls -l line
// yields no names (so the tooltip falls back to numeric uid/gid instead of showing garbage).
describe('parseLongnameOwner', () => {
  test('regular file line — owner and group', () => {
    expect(parseLongnameOwner('-rw-r--r--   1 root     www-data     1234 Jan  1 12:00 nginx.conf')).toEqual({
      owner: 'root',
      group: 'www-data',
    });
  });

  test('directory line', () => {
    expect(parseLongnameOwner('drwxr-xr-x   2 deploy   deploy       4096 Feb 10 09:30 sites')).toEqual({
      owner: 'deploy',
      group: 'deploy',
    });
  });

  test('symlink line (l type char)', () => {
    expect(
      parseLongnameOwner('lrwxrwxrwx   1 root     root           11 Jan  1 00:00 link -> target')
    ).toEqual({ owner: 'root', group: 'root' });
  });

  test('setuid/sticky perm chars are accepted', () => {
    expect(parseLongnameOwner('-rwsr-xr-x   1 root     root        12345 Jan  1 00:00 passwd')).toEqual({
      owner: 'root',
      group: 'root',
    });
    expect(parseLongnameOwner('drwxrwxrwt   5 root     root         4096 Jan  1 00:00 tmp')).toEqual({
      owner: 'root',
      group: 'root',
    });
  });

  test('numeric owner/group (no name resolution on server) still parse as strings', () => {
    expect(parseLongnameOwner('-rw-r--r--   1 1000     1000          10 Jan  1 00:00 file')).toEqual({
      owner: '1000',
      group: '1000',
    });
  });

  test('non-ls-l content yields no names', () => {
    expect(parseLongnameOwner('file.txt')).toEqual({});
    expect(parseLongnameOwner('')).toEqual({});
    expect(parseLongnameOwner(undefined)).toEqual({});
    expect(parseLongnameOwner(null)).toEqual({});
    expect(parseLongnameOwner('just some free text here')).toEqual({});
  });
});
