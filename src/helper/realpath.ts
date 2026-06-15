import * as fs from 'fs';

/**
 * Return the on-disk canonical path for `fsPath`, but ONLY when it differs by letter case alone.
 *
 * On upload-on-save we realpath() the saved file so the transfer uses the canonical on-disk casing
 * (Windows drive letter / UNC host — #589). The catch: `realpathSync.native` also resolves symlinks
 * (Linux/macOS) and expands subst / mapped virtual drives (Windows) to a *structurally different*
 * location. The config service is registered in the path trie under the path the workspace was opened
 * with, so adopting that different real path makes the trie prefix-lookup miss — which surfaces as
 * "Config Not Found" on save (#339 Visual Subst, #397 symlinked home on Linux, #521 macOS, #512).
 *
 * So: adopt the real path on a case-only change (safe, keeps #589 fixed); reject any structural change
 * and keep the original path (which already resolves a service). Mirrors the guard in
 * `getFileSystemPath` (helper/paths.ts). The `realpath` argument is injectable for tests.
 */
export function realpathIfCaseOnly(
  fsPath: string,
  realpath: (p: string) => string = p => fs.realpathSync.native(p)
): string {
  try {
    const real = realpath(fsPath);
    return real.toLowerCase() === fsPath.toLowerCase() ? real : fsPath;
  } catch {
    // The path may have vanished before the save flushed, or lives on a flaky network drive — keep
    // the original path rather than failing the save.
    return fsPath;
  }
}
