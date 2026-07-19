import { Readable } from 'stream';
import { randomBytes } from 'crypto';
import * as path from 'path';
import * as fileOperations from './fileBaseOperations';
import { FileSystem, FileType } from './fs';
import { Task } from './scheduler';
import logger from '../logger';
import * as transferProgress from '../ui/transferProgress';
import { parseOctalMode } from '../helper/mode';

// Warn once per target filesystem (≈ per connection/host) that mtimes can't be set — not once per
// session globally, which left a second server with the same restriction silent after the first warned.
const _warnedModifiedTimeFs = new WeakSet<FileSystem>();

// A staging temp file couldn't be created. Treat a permission failure as "directory not writable" and
// fall back to a direct overwrite (the file itself may still be writable); surface anything else.
//   local: EACCES / EPERM / EROFS   SFTP: SSH_FX_PERMISSION_DENIED = 3   FTP: 550 / 553
function isLikelyPermissionError(err: any): boolean {
  if (!err) {
    return false;
  }
  const code = (err as any).code;
  return (
    code === 3 ||
    code === 550 ||
    code === 553 ||
    code === 'EACCES' ||
    code === 'EPERM' ||
    code === 'EROFS'
  );
}

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
  private readonly _remoteHost?: string;
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
      // The remote server's host, carried so the completion hook can name WHICH server a transfer
      // went to (or failed on) — essential for "Upload to All Profiles" reports.
      remoteHost?: string;
    }
  ) {
    this._srcFsPath = src.fsPath;
    this._targetFsPath = target.fsPath;
    this._srcFs = src.fileSystem;
    this._targetFs = target.fileSystem;
    this._TransferOption = option.transferOption;
    this._transferDirection = option.transferDirection;
    this._remoteHost = option.remoteHost;
    this.fileType = option.fileType;
  }

  get remoteHost(): string | undefined {
    return this._remoteHost;
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

  // A cancel can land in the window between acquiring the source stream and writing the destination.
  // cancel() only aborts an already-assigned _handle, so without an explicit check the transfer would
  // run to completion (truncating + rewriting the target) even though the user asked to stop. Call
  // this before every destructive step: it aborts the source stream (if any) and throws so run()
  // unwinds. Throwing — rather than returning — guarantees we never proceed to open/put after cancel.
  private _abortAndThrowIfCancelled() {
    if (!this._cancelled) {
      return;
    }
    if (this._handle) {
      FileSystem.abortReadableStream(this._handle);
    }
    const err: any = new Error('Transfer cancelled');
    err.code = 'TRANSFER_CANCELLED';
    throw err;
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
    // Bail out before we acquire any stream if the task was cancelled during enumeration.
    this._abortAndThrowIfCancelled();

    // Resolve the upload mode: an explicit, VALID filePerm wins; otherwise we may preserve the target's
    // mode. parseOctalMode returns undefined for absent/garbage input (so we don't chmod with NaN/000).
    const parsedFilePerm = parseOctalMode(filePerm);
    let mode = parsedFilePerm !== undefined ? parsedFilePerm : this._TransferOption.mode;

    // Acquire the SOURCE first. get() hands back a lazy stream — a resolved await does NOT prove the
    // source is readable (the real read starts when put() pipes). So we never truncate the live target
    // up front: by default we stage a complete copy into a unique temp file beside the target and
    // atomically rename it over the target, leaving the original intact if anything fails mid-transfer.
    this._handle = await srcFs.get(src);
    this._abortAndThrowIfCancelled();

    // Preserve the existing target's mode when asked — read it while the target is still intact.
    if (mode === undefined && perserveTargetMode) {
      const probeFd = await targetFs.open(target, 'r').catch(() => null);
      if (probeFd) {
        try {
          mode = await targetFs.fstat(probeFd).then(stat => stat.mode).catch(() => fallbackMode);
        } finally {
          // Close the read handle even on failure, or the server-side fd leaks.
          await targetFs.close(probeFd).catch(() => undefined);
        }
      } else {
        mode = fallbackMode;
      }
    }

    // Default = stage into a UNIQUE temp file, then atomically rename it onto the target: the original
    // is never truncated until a complete copy exists, and a per-task-unique name means two concurrent
    // writers to the same target never share one staging file. `useTempFile: false` is an explicit
    // opt-out (direct overwrite); we ALSO fall back to direct automatically when the temp can't be
    // created because the directory isn't writable (a file can be writable while its dir is not).
    const preferTemp = useTempFile !== false;
    let uploadTarget = target;
    let usingTemp = false;
    let uploadFd;

    if (preferTemp) {
      const tempTarget = `${target}.wf-${process.pid}-${randomBytes(6).toString('hex')}.tmp`;
      try {
        uploadFd = await targetFs.open(tempTarget, 'w');
        uploadTarget = tempTarget;
        usingTemp = true;
      } catch (err) {
        if (!isLikelyPermissionError(err)) {
          // Real failure (not a read-only dir): abort the source stream so its handle doesn't leak.
          FileSystem.abortReadableStream(this._handle);
          throw err;
        }
        // Directory not writable — fall back to a direct overwrite rather than failing outright.
        logger.info(`temp staging not permitted for "${target}"; writing directly`);
      }
    }

    if (!usingTemp) {
      // Direct overwrite (explicit opt-out or the read-only-dir fallback): the source is already
      // acquired; truncate-open the destination now. A cancel landing here is caught by the gate below;
      // _openForWriteOrAbort aborts the source if the open itself fails.
      this._abortAndThrowIfCancelled();
      uploadFd = await this._openForWriteOrAbort(targetFs, target);
    }

    let putOk = false;
    try {
      this._abortAndThrowIfCancelled();
      if (usingTemp) {
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
      if (atime != null && mtime != null) {
        try {
          await targetFs.futimes(
            uploadFd,
            Math.floor(atime / 1000),
            Math.floor(mtime / 1000)
          );
        } catch (error) {
          if (!_warnedModifiedTimeFs.has(targetFs)) {
            _warnedModifiedTimeFs.add(targetFs);
            logger.warn(
              `Can't set modified time to the file because ${error.message}`
            );
          }
        }
      }

      // The staged copy now holds the COMPLETE file. Past this point it must never be deleted on
      // failure — if the rename fails it is the only complete copy.
      putOk = true;

      if (usingTemp) {
        // Close the staging handle before renaming: some servers refuse to rename an open file.
        await targetFs.close(uploadFd);
        uploadFd = undefined;
        this._abortAndThrowIfCancelled();
        logger.info("moving from: " + uploadTarget + " to: " + target);
        await this._replaceTarget(targetFs, uploadTarget, target, !!openSsh);
      }
    } finally {
      // Close the write handle unless we already closed it before the rename. Swallow a close() error
      // so it can't mask the real failure or skip the staging cleanup below.
      if (uploadFd !== undefined) {
        await targetFs.close(uploadFd).catch(() => undefined);
      }
      // Remove the staging copy ONLY if the upload itself didn't complete. If put() succeeded but the
      // rename failed, KEEP it — _replaceTarget's error already points the user at the recovery path.
      if (usingTemp && !putOk) {
        await targetFs.unlink(uploadTarget).catch(() => undefined);
      }
    }
  }

  // Move a freshly-staged temp file onto the target. OpenSSH servers get a true atomic rename; others
  // try a plain rename (most overwrite atomically) and only fall back to unlink+rename when the server
  // refuses because the target already exists (SFTP SSH_FX_FAILURE = 4, FTP 550). That fallback opens a
  // brief window with no target, but the staged copy is complete, so a second failure points the user
  // at it rather than losing data.
  private async _replaceTarget(
    targetFs: FileSystem,
    tempTarget: string,
    target: string,
    openSsh: boolean
  ) {
    if (openSsh) {
      await targetFs.renameAtomic(tempTarget, target);
      return;
    }
    try {
      await targetFs.rename(tempTarget, target);
    } catch (renameError) {
      const code = renameError && (renameError as any).code;
      if (code !== 4 && code !== 550) {
        throw renameError;
      }
      await targetFs.unlink(target);
      try {
        await targetFs.rename(tempTarget, target);
      } catch (secondError) {
        (secondError as any).message =
          `${(secondError as any).message} — the uploaded copy is kept at "${tempTarget}"; ` +
          `rename it to "${target}" on the server to recover`;
        throw secondError;
      }
    }
  }
}
