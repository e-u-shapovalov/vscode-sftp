import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import URI from 'vscode-uri';
import { upath } from '../core';
import { pathRelativeToWorkspace, getWorkspaceFolders } from '../host';

// from https://github.com/microsoft/vscode-eslint/blob/d97a8b5e99ad30d2ce32ffa5646447202f873413/server/src/eslintServer.ts#L816
function getFileSystemPath(uri: URI): string {
	let result = uri.fsPath;
	if (process.platform === 'win32' && result.length >= 2 && result[1] === ':') {
		// Node by default uses an upper case drive letter and ESLint uses
		// === to compare paths which results in the equal check failing
		// if the drive letter is lower case in th URI. Ensure upper case.
		result = result[0].toUpperCase() + result.substr(1);
	}
	if (process.platform === 'win32' || process.platform === 'darwin') {
		try {
			const realpath = fs.realpathSync.native(result);
			// Only use the real path if only the casing has changed.
			if (realpath.toLowerCase() === result.toLowerCase()) {
				result = realpath;
			}
		} catch (e) {
			// The path may not exist (e.g. a file that was just deleted, or a remote-only
			// path being mapped to its local counterpart). Fall back to the normalized result.
		}
	}
	return result;
}

export function simplifyPath(absolutePath: string) {
  return pathRelativeToWorkspace(absolutePath);
}

// FIXME: use fs.pathResolver instead of upath
export function toRemotePath(localPath: string, localContext: string, remoteContext: string) {
  return upath.join(
    remoteContext,
    path.relative(getFileSystemPath(URI.file(localContext)), getFileSystemPath(URI.file(localPath)))
  );
}

// FIXME: use fs.pathResolver instead of upath
export function toLocalPath(remotePath: string, remoteContext: string, localContext: string) {
  return path.join(localContext, upath.relative(remoteContext, remotePath));
}

export function isSubpathOf(possiableParentPath: string, pathname: string) {
  const parent = path.normalize(possiableParentPath);
  const child = path.normalize(pathname);
  if (child === parent) {
    return true;
  }
  // Append a separator so `/foo` is not treated as a parent of `/foo-bar`.
  const parentWithSep = parent.endsWith(path.sep) ? parent : parent + path.sep;
  return child.indexOf(parentWithSep) === 0;
}

// Containment check for remote (always forward-slash) paths — the `path`/`isSubpathOf` version
// would mangle Unix paths on Windows (it swaps / for \). Used to reject a forged remote: URI whose
// fsPath points outside the configured remote root.
export function isRemoteSubpathOf(possiableParentPath: string, pathname: string) {
  const parent = upath.normalize(possiableParentPath).replace(/\/+$/, '') || '/';
  const child = upath.normalize(pathname);
  // A relative root ('.', produced by a relative remotePath like the default './' or '.') contains any
  // child that doesn't climb above it. toRemotePath/upath.join already fold interior '..', so a
  // surviving leading '..' is a genuine escape. Without this branch isRemoteSubpathOf('.', 'file') is
  // false and the containment guard throws on EVERY operation when remotePath is relative.
  if (parent === '.') {
    return child !== '..' && child.indexOf('../') !== 0;
  }
  if (child === parent) {
    return true;
  }
  const parentWithSep = parent === '/' ? '/' : parent + '/';
  return child.indexOf(parentWithSep) === 0;
}

export function replaceHomePath(pathname: string) {
  // Accept a backslash home prefix (~\) as well as ~/ so a Windows privateKeyPath / sshConfigPath
  // written with native separators is expanded instead of being passed to fs verbatim. `~\` is a
  // Windows-ism; treating it as home on any platform is harmless (it never denotes a real POSIX path).
  const prefix = pathname.slice(0, 2);
  return prefix === '~/' || prefix === '~\\'
    ? path.join(os.homedir(), pathname.slice(2))
    : pathname;
}

export function resolvePath(from: string, to: string) {
  return path.resolve(from, replaceHomePath(to));
}

export function isInWorkspace(filepath: string) {
  const workspaceFolders = getWorkspaceFolders();
  // vscode can't keep filepath's stable, covert them to toLowerCase before check
  const target = filepath.toLowerCase();
  return (
    workspaceFolders &&
    workspaceFolders.some(folder => {
      const root = folder.uri.fsPath.toLowerCase();
      if (target === root) {
        return true;
      }
      // Append a separator so a sibling like `/foo-bar` is not matched against root `/foo`.
      const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
      return target.indexOf(rootWithSep) === 0;
    })
  );
}
