const { mergeProfile } = require('../../src/core/mergeProfile');

// A profile overlays the base config. Nested config objects (watcher, syncOption, remoteExplorer)
// must be DEEP-merged: a profile that overrides one sub-key must keep the base's other sub-keys.
// A shallow merge replaced the whole object, silently dropping the rest (e.g. a profile setting only
// syncOption.delete wiped skipCreate/ignoreExisting/update; a remoteExplorer.filesExclude-only
// profile wiped `order`, later read as NaN by the tree sort).
describe('mergeProfile', () => {
  test('deep-merges syncOption so overriding one sub-key keeps the rest', () => {
    const base = {
      syncOption: { delete: false, skipCreate: false, ignoreExisting: false, update: false },
    };
    const profile = { syncOption: { delete: true } };

    expect(mergeProfile(base, profile).syncOption).toEqual({
      delete: true,
      skipCreate: false,
      ignoreExisting: false,
      update: false,
    });
  });

  test('deep-merges remoteExplorer so a filesExclude-only profile keeps order', () => {
    const base = { remoteExplorer: { order: 0 } };
    const profile = { remoteExplorer: { filesExclude: ['*.log'] } };

    expect(mergeProfile(base, profile).remoteExplorer).toEqual({
      order: 0,
      filesExclude: ['*.log'],
    });
  });

  test('deep-merges watcher so an autoUpload-only profile keeps files', () => {
    const base = { watcher: { files: '**/*.js', autoUpload: false } };
    const profile = { watcher: { autoUpload: true } };

    expect(mergeProfile(base, profile).watcher).toEqual({
      files: '**/*.js',
      autoUpload: true,
    });
  });

  test('replaces (not merges) a nested key the base does not have', () => {
    expect(mergeProfile({}, { syncOption: { delete: true } }).syncOption).toEqual({ delete: true });
  });

  test('still concatenates ignore (base + profile)', () => {
    expect(mergeProfile({ ignore: ['a'] }, { ignore: ['b'] }).ignore).toEqual(['a', 'b']);
  });

  test('replaces scalar keys and never mutates the base config', () => {
    const base = { host: 'base.example', syncOption: { delete: false } };
    const merged = mergeProfile(base, { host: 'profile.example', syncOption: { delete: true } });

    expect(merged.host).toBe('profile.example');
    // the base object must be left exactly as it was
    expect(base.host).toBe('base.example');
    expect(base.syncOption).toEqual({ delete: false });
  });

  test('strips the profiles map from the merged result', () => {
    expect(mergeProfile({ host: 'h', profiles: { dev: {} } }, { host: 'h2' }).profiles).toBeUndefined();
  });
});
