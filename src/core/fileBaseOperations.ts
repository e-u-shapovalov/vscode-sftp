import { FileSystem, FileType, FileStats } from './fs';
import { window } from 'vscode';
import { Readable } from 'stream';
import logger from '../logger';
import { L } from '../i18n';
import { parseOctalMode } from '../helper/mode';

interface FileOption {
  mode?: number;
}

// Distinguish a real "not found" from permission/transient lstat errors, so create* doesn't read an
// EACCES/timeout as "absent" and proceed to create (masking the real cause).
//   SFTP lstat → err.code 2 / 'ENOENT'; FTP lstat → Error('file not exist') (no code).
function isNotFoundError(err: any): boolean {
  return !!err && (err.code === 2 || err.code === 'ENOENT' || err.message === 'file not exist');
}

export async function transferFile(
  src: string,
  des: string,
  srcFs: FileSystem,
  desFs: FileSystem,
  option?: FileOption
): Promise<void> {
  const inputStream = await srcFs.get(src, option);
  await desFs.put(inputStream, des, option);
}

// The link target is whatever the source FS returns from readlink — on a download it comes from the
// (possibly hostile/misconfigured) remote. Refuse an absolute target (or a NUL): recreating it
// verbatim would plant a link to /etc/passwd, ~/.ssh/id_rsa, C:\Windows\… that backup/grep/build tools
// later dereference. Absolute targets aren't portable across machines anyway, so this loses nothing
// legitimate; relative targets are kept (they stay within the transferred tree's own layout).
function isUnsafeSymlinkTarget(target: string): boolean {
  if (!target || target.indexOf('\0') !== -1) {
    return true;
  }
  return (
    target.charAt(0) === '/' || // POSIX absolute
    /^[A-Za-z]:[\\/]/.test(target) || // Windows drive (C:\ , C:/)
    target.indexOf('\\\\') === 0 // Windows UNC (\\host\share)
  );
}

export function transferSymlink(
  src: string,
  des: string,
  srcFs: FileSystem,
  desFs: FileSystem,
  option: FileOption
): Promise<void> {
  return srcFs.readlink(src).then(targetPath => {
    if (isUnsafeSymlinkTarget(targetPath)) {
      throw Object.assign(
        new Error(`Refusing to create symlink "${des}" with unsafe target: ${targetPath}`),
        { code: 'UNSAFE_SYMLINK' }
      );
    }
    return desFs.symlink(targetPath, des).catch(err => {
      // ignore file already exist
      if (err.code === 4 || err.code === 'EEXIST') {
        return;
      }
      throw err;
    });
  });
}

export function removeFile(path: string, fs: FileSystem, option): Promise<void> {
  return fs.unlink(path);
}

export interface RemoveDirOption {
  /**
   * Called after each successfully removed entry (file, symlink, or empty directory).
   * Receives the path, type, and (for files/symlinks) the stats of the deleted item.
   * Stats come from the fs.list() result so no extra I/O is needed.
   */
  onEntry?: (entry: { path: string; type: FileType; stats?: FileStats }) => void;
  /**
   * Polled before every deletion. When it returns true the walk stops immediately;
   * the caller accepts partial removal — no exception is thrown.
   */
  shouldCancel?: () => boolean;
}

export async function removeDir(path: string, fs: FileSystem, option: RemoveDirOption): Promise<void> {
  const entries = await fs.list(path);

  for (const entry of entries) {
    // Check for cancellation before each item so callers can abort mid-walk.
    if (option.shouldCancel && option.shouldCancel()) {
      return;
    }

    if (entry.type === FileType.Directory) {
      // Recurse depth-first: children must be removed before the parent directory
      // can accept rmdir(recursive=false).
      await removeDir(entry.fspath, fs, option);
    } else {
      // Files and symlinks: call unlink on the link itself, never follow the target.
      // Capture stats from the listing entry before unlinking — no extra I/O needed.
      await fs.unlink(entry.fspath);
      // Pass the FileStats fields (size/mode/mtime/atime/type) from the FileEntry directly;
      // FileEntry is FileStats & {fspath,name} so the entry itself satisfies FileStats.
      option.onEntry?.({ path: entry.fspath, type: entry.type, stats: entry });
    }
  }

  // If cancellation landed on the last child, stop here too — honour the "partial removal" contract
  // and leave the (now-empty) parent directory in place rather than deleting it post-cancel.
  if (option.shouldCancel && option.shouldCancel()) {
    return;
  }

  // All children are gone; remove the now-empty directory.
  await fs.rmdir(path, false);
  // Directories don't carry meaningful stats at removal time; pass without stats.
  option.onEntry?.({ path, type: FileType.Directory });
}

export function rename(srcPath: string, destPath: string, fs: FileSystem): Promise<void> {
  return fs.rename(srcPath, destPath);
}

// Returns true when the folder was actually created, false when the path was already taken (reported to
// the user here, but not an error). Callers must not treat "already exists" as a fresh creation — acting
// on it would touch someone else's existing data.
export async function createDir(path: string, fs: FileSystem, option): Promise<boolean> {
  try {
    await fs.lstat(path);
    logger.warn(`Can't create folder because it already exists`);
    window.showErrorMessage(
      L({ en: `Can't create folder because it already exists`, ru: 'Не удаётся создать папку: она уже существует' })
    );
    return false;
  } catch (error) {
    // Only a genuine not-found means "go ahead and create"; a permission/transient error must surface
    // rather than be misread as "absent".
    if (!isNotFoundError(error)) {
      throw error;
    }
  }

  await fs.mkdir(path);

  // Default to 755 when dirPerm isn't configured: mkdir over SFTP otherwise leaves the new directory at the
  // server default/umask (which can be world-writable). 755 = others enter/read, only you write. An explicit
  // dirPerm (including a permissive one) still wins.
  const dirMode = parseOctalMode(option ? option.dirPerm : undefined) ?? 0o755;
  try {
    await fs.chmod(path, dirMode);
  } catch (error) {
    logger.warn('failed to chmod new folder (dirPerm):', error);
  }
  return true;
}

// Returns true when the file was actually created, false when the path was already taken (reported to the
// user here, but not an error). The distinction matters to the caller: "already exists" means the server
// still holds SOMEONE ELSE'S content, so it must not be treated as a new empty file.
export async function createFile(path: string, fs: FileSystem, option): Promise<boolean> {
  try {
    await fs.lstat(path);
    logger.warn(`Can't create file because file already exists`);
    window.showErrorMessage(
      L({ en: `Can't create file because file already exists`, ru: 'Не удаётся создать файл: он уже существует' })
    );
    return false;
  } catch (error) {
    // Only a genuine not-found means "go ahead and create"; a permission/transient error must surface.
    if (!isNotFoundError(error)) {
      throw error;
    }
  }

  // Write an empty stream to create a zero-byte file. Use the normal put() path, which opens,
  // writes and closes the handle itself. The previous version pre-opened the file and passed the
  // fd to put(); reusing that handle left the write stream without a 'finish' event, so createFile
  // never resolved and the post-create tree refresh (afterHandle) was silently skipped.
  const emptyContent = new Readable();
  emptyContent._read = () => {};
  emptyContent.push(null);
  await fs.put(emptyContent, path);

  // Default to 644 when filePerm isn't configured: a new empty file is otherwise left at the SFTP default
  // (0o666 — world-writable, the "666" reported in issue #2). 644 = owner-writable, others read-only (safe
  // for web). chmod after creation makes the result exact regardless of the server umask; an explicit
  // filePerm (including a permissive one) still wins. A failure is non-fatal and only warned.
  const fileMode = parseOctalMode(option ? option.filePerm : undefined) ?? 0o644;
  try {
    await fs.chmod(path, fileMode);
  } catch (error) {
    logger.warn('failed to chmod new file (filePerm):', error);
  }
  return true;
}
