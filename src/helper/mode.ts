// Parse a user-supplied octal permission (the JSONC config's filePerm / dirPerm). Accepts a number or a
// string of 1-4 octal digits (e.g. 644, "0755", 600) and returns the numeric mode. Returns undefined for
// anything that is NOT a clean octal literal — an unset value, or a footgun like 888 / "0o644" / "rwx" — so
// callers SKIP the chmod instead of applying a garbage mode: parseInt("888", 8) is NaN, and
// parseInt("0o644", 8) stops at the 'o' and yields 0 (mode 000). A digit string is read as OCTAL by
// convention (644 -> 0o644), matching the schema (`number`) and the docs ("octal, e.g. 644"). An explicit
// 0 / "000" is honoured (mode 000) — only truly absent/invalid input is skipped.
export function parseOctalMode(value: unknown): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const s = String(value).trim();
  if (!/^[0-7]{1,4}$/.test(s)) {
    return undefined;
  }
  return parseInt(s, 8);
}
