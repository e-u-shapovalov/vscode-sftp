import { FileSystem } from './fs';
import { window } from 'vscode';
import { Readable } from 'stream';
import logger from '../logger';

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

export function removeDir(path: string, fs: FileSystem, option): Promise<void> {
  return fs.rmdir(path, true);
}

export function rename(srcPath: string, destPath: string, fs: FileSystem): Promise<void> {
  return fs.rename(srcPath, destPath);
}

export function createDir(path: string, fs: FileSystem, option): Promise<void> {
  return fs.mkdir(path);
}

export async function createFile(path: string, fs: FileSystem, option): Promise<void> {
  try {
    await fs.lstat(path);
    logger.warn(`Can't create file because file already exists`);
    window.showErrorMessage(`Can't create file because file already exists`);
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
