import type { FileServiceConfig } from './fileService';

// Config keys whose value is a nested object: a profile must MERGE into these, not replace them
// wholesale, so overriding one sub-key keeps the base's other sub-keys. A shallow replace dropped
// the rest — e.g. a syncOption.delete-only profile wiped skipCreate/ignoreExisting/update, and a
// remoteExplorer.filesExclude-only profile wiped `order` (later read as NaN by the tree sort).
const DEEP_MERGE_KEYS = ['watcher', 'syncOption', 'remoteExplorer'];

function isPlainObject(value: any): boolean {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Overlay a named profile on top of the base config. `ignore` is concatenated (base + profile); the
// nested config objects above are deep-merged one level; every other key is taken from the profile
// when present.
export function mergeProfile(
  target: FileServiceConfig,
  source: FileServiceConfig
): FileServiceConfig {
  const res = Object.assign({}, target);
  delete res.profiles;

  const keys = Object.keys(source);
  for (const key of keys) {
    if (key === 'ignore') {
      // Guard against a base config without `ignore`: Object.assign copies it as undefined, and
      // undefined.concat would throw, breaking getConfig() for every operation on that profile.
      res.ignore = (res.ignore || []).concat(source.ignore || []);
    } else if (
      DEEP_MERGE_KEYS.indexOf(key) !== -1 &&
      isPlainObject(res[key]) &&
      isPlainObject(source[key])
    ) {
      // Deep-merge one level: keep the base's sub-keys, let the profile override its own.
      res[key] = { ...res[key], ...source[key] };
    } else {
      res[key] = source[key];
    }
  }

  return res;
}
