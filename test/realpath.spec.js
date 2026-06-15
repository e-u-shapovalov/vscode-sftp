const { realpathIfCaseOnly } = require('../src/helper/realpath');

// Regression guard for the upload-on-save "Config Not Found" family. realpath() on save must only
// adopt a *case-only* canonicalisation; a structural change (symlink / subst drive) has to be
// rejected, otherwise the path trie lookup misses and the save fails. See fileActivityMonitor
// handleFileSave and CHANGELOG 2.0.3 (#589) / the symlink+subst follow-up (#339, #397, #521).
describe('realpathIfCaseOnly', () => {
  test('adopts realpath when it differs only by case (keeps the #589 UNC/case fix)', () => {
    const original = '\\\\Pc_test\\share\\proj\\file.php';
    const canonical = '\\\\pc_test\\share\\proj\\file.php'; // same path, different case
    expect(realpathIfCaseOnly(original, () => canonical)).toBe(canonical);
  });

  test('rejects a resolved symlink — structural change (Linux #397)', () => {
    const original = '/home/user/proj/index.php';
    const resolved = '/nfs/data/user/proj/index.php'; // /home/user is a symlink to /nfs/data/user
    expect(realpathIfCaseOnly(original, () => resolved)).toBe(original);
  });

  test('rejects an expanded subst / mapped drive — structural change (Windows #339)', () => {
    const original = 'V:\\proj\\todo.txt';
    const resolved = 'E:\\work\\proj\\todo.txt'; // Visual Subst expands V: to its real target
    expect(realpathIfCaseOnly(original, () => resolved)).toBe(original);
  });

  test('falls back to the original path when realpath throws (file vanished)', () => {
    const original = '/home/user/proj/index.php';
    expect(
      realpathIfCaseOnly(original, () => {
        throw new Error('ENOENT');
      })
    ).toBe(original);
  });

  test('an identical real path round-trips unchanged', () => {
    const p = '/srv/app/file.txt';
    expect(realpathIfCaseOnly(p, () => p)).toBe(p);
  });
});
