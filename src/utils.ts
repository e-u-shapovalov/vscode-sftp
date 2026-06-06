export function flatten(items) {
  const accumulater = (result, item) => result.concat(item);
  return items.reduce(accumulater, []);
}

export function interpolate(str: string, props: { [x: string]: string }) {
  return str.replace(/\${([^{}]*)}/g, (match, expr) => {
    const value = props[expr];
    return typeof value === 'string' || typeof value === 'number' ? value : match;
  });
}

// A remote directory-listing entry must be a single path segment. A malicious or
// compromised server could return a crafted name (e.g. '../../foo') that, once joined
// to a local download path, escapes the target directory (path traversal -> arbitrary
// file write). Reject empty names, '.', '..', NUL, and anything with a path separator.
export function isUnsafeRemoteSegment(name: string): boolean {
  return (
    !name ||
    name === '.' ||
    name === '..' ||
    name.indexOf('/') !== -1 ||
    name.indexOf('\\') !== -1 ||
    name.indexOf('\0') !== -1
  );
}
