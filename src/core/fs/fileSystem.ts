import { Readable } from 'stream';
import * as fs from 'fs';

interface FileSystemError extends Error {
  code: string;
}

export const ERROR_MSG_STREAM_INTERRUPT = 'sftp.stream.interrupt';

export type FileHandle = unknown;

export enum FileType {
  Directory = 1,
  File,
  SymbolicLink,
  Unknown,
}

export interface FileOption {
  flags?: string;
  encoding?: string;
  mode?: number;
  autoClose?: boolean;
  fd?: FileHandle;
  // Per-chunk byte callback for progress reporting; optional so existing callers are unaffected.
  onProgress?: (bytes: number) => void;
  // Hard cap for readFile: abort the stream once this many bytes have been buffered. Guards preview /
  // in-memory reads against an oversized or lying remote (lstat size can't be trusted).
  maxBytes?: number;
}

export interface FileStats {
  type: FileType;
  mode: number;
  size: number;
  mtime: number;
  atime: number;
  // Numeric owner/group ids straight from the protocol stat. SFTP always reports them; other
  // backends (FTP) leave them undefined. Names are resolved separately (see FileEntry.owner/group).
  uid?: number;
  gid?: number;
  // symbol link target
  target?: string;
}

export type FileEntry = FileStats & {
  fspath: string;
  name: string;
  // Owner/group NAMES (e.g. "root", "www-data"). Only a directory listing can carry them cheaply —
  // OpenSSH puts them in each readdir entry's `longname` (the `ls -l` line), so no extra request is
  // needed. A bare lstat has no names, only the numeric uid/gid above.
  owner?: string;
  group?: string;
};

export default abstract class FileSystem {
  static getFileTypecharacter(stat: fs.Stats): FileType {
    if (stat.isDirectory()) {
      return FileType.Directory;
    } else if (stat.isFile()) {
      return FileType.File;
    } else if (stat.isSymbolicLink()) {
      return FileType.SymbolicLink;
    } else {
      return FileType.Unknown;
    }
  }

  pathResolver: any;

  constructor(pathResolver: any) {
    this.pathResolver = pathResolver;
  }

  abstract readFile(path: string, option?: FileOption): Promise<string | Buffer>;
  abstract open(path: string, flags: string, mode?: number): Promise<FileHandle>;
  abstract close(fd: FileHandle): Promise<void>;
  abstract fstat(fd: FileHandle): Promise<FileStats>;
  /**
   * Change the file system timestamps of the object referenced by the supplied file descriptor.
   *
   * @abstract
   * @param {FileHandle} fd
   * @param {number} atime time in seconds
   * @param {number} mtime time in seconds
   * @returns {Promise<void>}
   * @memberof FileSystem
   */
  abstract futimes(fd: FileHandle, atime: number, mtime: number): Promise<void>;
  abstract get(path: string, option?: FileOption): Promise<Readable>;
  abstract put(input: Readable, path, option?: FileOption): Promise<void>;
  abstract mkdir(dir: string): Promise<void>;
  abstract ensureDir(dir: string): Promise<void>;
  abstract chmod(path: string, mode: number): Promise<void>;
  abstract list(dir: string, option?): Promise<FileEntry[]>;
  abstract lstat(path: string): Promise<FileStats>;
  abstract readlink(path: string): Promise<string>;
  abstract symlink(targetPath: string, path: string): Promise<void>;
  abstract unlink(path: string): Promise<void>;
  abstract rmdir(path: string, recursive: boolean): Promise<void>;
  abstract rename(srcPath: string, destPath: string): Promise<void>;
  abstract renameAtomic(srcPath: string, destPath: string): Promise<void>;

  static abortReadableStream(stream: Readable) {
    const err = new Error('Transfer Aborted') as FileSystemError;
    err.code = ERROR_MSG_STREAM_INTERRUPT;

    // don't do `stream.destroy(err)`! `sftp.ReadaStream` do not support `err` parameter in `destory` method.
    // emit('error') with NO listener throws synchronously (Node EventEmitter), which would skip the
    // destroy() below and turn a controlled cancel (e.g. between get() and put() wiring up its handler)
    // into an uncaught throw. Only emit when someone is listening; always destroy.
    try {
      if (stream.listenerCount('error') > 0) {
        stream.emit('error', err);
      }
    } finally {
      stream.destroy();
    }
  }

  static isAbortedError(err: FileSystemError) {
    return err.code === ERROR_MSG_STREAM_INTERRUPT;
  }
}
