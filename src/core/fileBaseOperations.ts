import { FileSystem, FileType, FileStats } from './fs';
import { window } from 'vscode';
import { Readable } from 'stream';
import logger from '../logger';
import { L } from '../i18n';

interface FileOption {
  mode?: number;
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

export function transferSymlink(
  src: string,
  des: string,
  srcFs: FileSystem,
  desFs: FileSystem,
  option: FileOption
): Promise<void> {
  return srcFs.readlink(src).then(targetPath => {
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

export async function createDir(path: string, fs: FileSystem, option): Promise<void> {
  try {
    await fs.lstat(path);
    logger.warn(`Can't create folder because it already exists`);
    window.showErrorMessage(
      L({ en: `Can't create folder because it already exists`, ru: 'Не удаётся создать папку: она уже существует' })
    );
    return;
  } catch (error) {
    // folder doesn't exist — proceed to create it
  }

  return fs.mkdir(path);
}

export async function createFile(path: string, fs: FileSystem, option): Promise<void> {
  try {
    await fs.lstat(path);
    logger.warn(`Can't create file because file already exists`);
    window.showErrorMessage(
      L({ en: `Can't create file because file already exists`, ru: 'Не удаётся создать файл: он уже существует' })
    );
    return;
  } catch (error) {
    // file doesn't exist — proceed to create it
  }

  // Write an empty stream to create a zero-byte file. Use the normal put() path, which opens,
  // writes and closes the handle itself. The previous version pre-opened the file and passed the
  // fd to put(); reusing that handle left the write stream without a 'finish' event, so createFile
  // never resolved and the post-create tree refresh (afterHandle) was silently skipped.
  const emptyContent = new Readable();
  emptyContent._read = () => {};
  emptyContent.push(null);
  return fs.put(emptyContent, path);
}
