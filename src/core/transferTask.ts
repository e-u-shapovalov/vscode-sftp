import { Readable } from 'stream';
import * as path from 'path';
import * as fileOperations from './fileBaseOperations';
import { FileSystem, FileType } from './fs';
import { Task } from './scheduler';
import logger from '../logger';
import * as transferProgress from '../ui/transferProgress';

let hasWarnedModifedTimePermission = false;

export enum TransferDirection {
  LOCAL_TO_REMOTE = 'local ➞ remote',
  REMOTE_TO_LOCAL = 'remote ➞ local',
}

interface FileHandle {
  fsPath: string;
  fileSystem: FileSystem;
}

export interface TransferOption {
  atime: number;
  mtime: number;
  mode?: number;
  filePerm?: number;
  dirPerm?: number;
  fallbackMode?: number;
  perserveTargetMode: boolean;
  useTempFile?: boolean;
  openSsh?: boolean;
}

export default class TransferTask implements Task {
  readonly fileType: FileType;
  private readonly _srcFsPath: string;
  private readonly _targetFsPath: string;
  private readonly _srcFs: FileSystem;
  private readonly _targetFs: FileSystem;
  private readonly _transferDirection: TransferDirection;
  private readonly _TransferOption: TransferOption;
  private _handle: Readable;
  private _cancelled: boolean;
  // private _fileStatus: FileStatus;

  constructor(
    src: FileHandle,
    target: FileHandle,
    option: {
      fileType: FileType;
      transferDirection: TransferDirection;
      transferOption: TransferOption;
    }
  ) {
    this._srcFsPath = src.fsPath;
    this._targetFsPath = target.fsPath;
    this._srcFs = src.fileSystem;
    this._targetFs = target.fileSystem;
    this._TransferOption = option.transferOption;
    this._transferDirection = option.transferDirection;
    this.fileType = option.fileType;
  }

  get localFsPath() {
    if (this._transferDirection === TransferDirection.REMOTE_TO_LOCAL) {
      return this._targetFsPath;
    } else {
      return this._srcFsPath;
    }
  }

  get srcFsPath() {
    return this._srcFsPath;
  }

  get targetFsPath() {
    return this._targetFsPath;
  }

  get srcFs() {
    return this._srcFs;
  }

  get targetFs() {
    return this._targetFs;
  }

  get transferType() {
    return this._transferDirection;
  }

  async run() {
    const src = this._srcFsPath;
    const target = this._targetFsPath;
    const srcFs = this._srcFs;
    const targetFs = this._targetFs;
    switch (this.fileType) {
      case FileType.File:
        await this._transferFile();
        break;
      case FileType.SymbolicLink:
        await fileOperations.transferSymlink(
          src,
          target,
          srcFs,
          targetFs,
          this._TransferOption
        );
        break;
      default:
        logger.warn(`Unsupported file type (type = ${this.fileType}). File ${src}`);
    }
  }

  cancel() {
    if (this._cancelled) {
      return;
    }
    // Always set the flag, even before the source stream exists — otherwise a cancel that lands
    // between open() and get() is silently lost and the transfer completes anyway.
    this._cancelled = true;
    if (this._handle) {
      FileSystem.abortReadableStream(this._handle);
    }
  }

  isCancelled(): boolean {
    return this._cancelled;
  }

  // Open the destination for writing; if that open fails after the source stream is already
  // acquired, abort the source so we never leak a half-open read handle.
  private async _openForWriteOrAbort(targetFs: FileSystem, uploadTarget: string) {
    try {
      return await targetFs.open(uploadTarget, 'w');
    } catch (err) {
      if (this._handle) {
        FileSystem.abortReadableStream(this._handle);
      }
      throw err;
    }
  }

  private async _transferFile() {
    const src = this._srcFsPath;
    const target = this._targetFsPath;
    const srcFs = this._srcFs;
    const targetFs = this._targetFs;
    const {
      perserveTargetMode,
      useTempFile,
      openSsh,
      fallbackMode,
      atime,
      mtime,
      filePerm
    } = this._TransferOption;

    // Declare the file size to the progress bar before we start acquiring streams so the bar
    // shows real movement for large files. Only pay the extra lstat when a session is active.
    if (transferProgress.isActive()) {
      let size = 0;
      try {
        size = (await srcFs.lstat(src)).size;
      } catch {
        // Ignore: size stays 0, bar shows transfer without a filled percentage.
      }
      // Don't inflate the bar's total for a file that was cancelled during enumeration.
      if (!this._cancelled) {
        transferProgress.addFile(size);
      }
    }
    // Set the mode if it's specified in the config, otherwise get mode from server.
    let mode = filePerm ? parseInt(String(filePerm), 8) : this._TransferOption.mode;
    let targetFd; // Destination file
    let uploadFd; // Temp file or destination file when no temp file is used
    let uploadedOk = false;
    const uploadTarget = target + (useTempFile ? ".new" : "");

    // Acquisition order matters when useTempFile is false: there `uploadTarget` IS the real target
    // and open(…, 'w') TRUNCATES it. We must obtain the source stream BEFORE truncating the
    // destination — otherwise a source that can't be read (vanished, no permission) empties the
    // existing remote file for nothing. With a temp file the real target is untouched, so opening
    // in parallel is safe.
    // Use mode first.
    // Then check perserveTargetMode and fallback to fallbackMode if fail to get mode of target
    if (mode === undefined && perserveTargetMode) {
      if (useTempFile) {
        [targetFd, uploadFd] = await Promise.all([
          targetFs.open(target, 'r')  // Get handle for reading the target mode
            .catch(() => null), // Return null if target file doesn't exist
          targetFs.open(uploadTarget, 'w')  // Get handle for the file upload
        ]);

        if (targetFd) {
          try {
            [this._handle, mode] = await Promise.all([
              srcFs.get(src),
              targetFs
                .fstat(targetFd)
                .then(stat => stat.mode)
                .catch(() => fallbackMode),
            ]);
          } finally {
            // Close the read handle even when srcFs.get() rejects, or the server-side fd leaks.
            await targetFs.close(targetFd).catch(() => undefined);
          }
        } else {
          this._handle = await srcFs.get(src);
          mode = fallbackMode;
        }
      } else {
        // Direct overwrite: read the source first, only then truncate-open the destination.
        this._handle = await srcFs.get(src);
        targetFd = uploadFd = await this._openForWriteOrAbort(targetFs, uploadTarget);
        mode = await targetFs
          .fstat(targetFd)
          .then(stat => stat.mode)
          .catch(() => fallbackMode);
      }
    } else {
      if (useTempFile) {
        [this._handle, uploadFd] = await Promise.all([
          srcFs.get(src),
          targetFs.open(uploadTarget, 'w'),
        ]);
      } else {
        // Direct overwrite: read the source first, only then truncate-open the destination.
        this._handle = await srcFs.get(src);
        uploadFd = await this._openForWriteOrAbort(targetFs, uploadTarget);
      }
    }

    try {
      if (useTempFile) {
        logger.info("uploading temp file: " + uploadTarget);
      }
      await targetFs.put(this._handle, uploadTarget, {
        mode,
        fd: uploadFd,
        autoClose: false,
        onProgress: transferProgress.isActive()
          ? (n: number) => transferProgress.addBytes(n, path.basename(this.localFsPath))
          : undefined,
      });
      if (atime && mtime) {
        try {
          await targetFs.futimes(
            uploadFd,
            Math.floor(atime / 1000),
            Math.floor(mtime / 1000)
          );
        } catch (error) {
          if (!hasWarnedModifedTimePermission) {
            hasWarnedModifedTimePermission = true;
            logger.warn(
              `Can't set modified time to the file because ${error.message}`
            );
          }
        }
      }

      uploadedOk = true;

      if (useTempFile) {
        logger.info("moving from: " + target + ".new" + " to: " + target);
        if(openSsh) {
          await targetFs.renameAtomic(uploadTarget, target);
        } else {
          // Try the plain rename first: most servers overwrite the target atomically. Only when
          // that fails fall back to unlink+rename — deleting the target up front opens a window
          // where a crash leaves NO file at all (the old one is gone, the new one not in place).
          try {
            await targetFs.rename(uploadTarget, target);
          } catch (renameError) {
            // ONLY unlink+retry when the server refused because the target already exists
            // (SFTP SSH_FX_FAILURE = 4, FTP 550). For any other failure (network drop, permission)
            // do NOT delete the target — that would destroy the original while the new content is
            // still only in `.new`. uploadedOk is already true, so the finally keeps `.new`.
            const code = renameError && (renameError as any).code;
            if (code !== 4 && code !== 550) {
              throw renameError;
            }
            await targetFs.unlink(target);
            await targetFs.rename(uploadTarget, target);
          }
        }
      }

    } finally {
      // Guard against an undefined fd: if an open failed before this try, uploadFd is unset and
      // close(undefined) would crash, masking the real error (mirrors the targetFd close above).
      if (uploadFd !== undefined) {
        await targetFs.close(uploadFd);
      }
      // Don't leave a half-written *.new file behind when the upload itself failed. If the upload
      // succeeded but the final move failed, KEEP the temp file — it holds the only complete copy.
      if (!uploadedOk && useTempFile) {
        await targetFs.unlink(uploadTarget).catch(() => undefined);
      }
    }
  }
}
