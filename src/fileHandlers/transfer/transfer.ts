import {
  FileSystem,
  FileEntry,
  FileType,
  TransferTask,
  TransferOption as TransferTaskTransferOption,
  TransferDirection,
  fileOperations,
} from '../../core';
import * as path from 'path';
import * as vscode from 'vscode';
import { FileHandleOption } from '../option';
import { flatten } from '../../utils';
import logger from '../../logger';
import { getOpenTextDocuments } from '../../host';
import { L } from '../../i18n';

// Per-operation skip counter, keyed by the root srcFsPath of the top-level transfer/sync call.
// Recursive helpers accumulate here; the root exported function reads and clears the entry after
// the operation finishes, then shows a single info message if any files were skipped.
// Using a module-level Map avoids threading an extra mutable argument through every recursive call.
const _skipCounters: Map<string, { count: number; thresholdMB: number }> = new Map();
// Per-operation nonce so two concurrent transfers rooted at the same path don't share (and clobber)
// one skip counter.
let _skipKeySeq = 0;

// Windows paths are case-insensitive and VS Code does not guarantee a stable drive-letter case,
// so an exact === between document.fileName and the config path can silently miss (cf. #589).
const isWindows = process.platform === 'win32';
function isSameLocalPath(a: string, b: string): boolean {
  const na = path.normalize(a);
  const nb = path.normalize(b);
  return isWindows ? na.toLowerCase() === nb.toLowerCase() : na === nb;
}

interface InternalTransferOption extends FileHandleOption, TransferTaskTransferOption {
  // Maximum file size (megabytes) for batch transfers; absent/0 means the check is disabled.
  // Set by each handler's transformOption() from config.maxFileSize. Single-file explicit commands
  // leave this unset so they are never filtered regardless of size.
  maxFileSize?: number;
}

type ExternalTransferOption<T extends InternalTransferOption> = Pick<
  T,
  Exclude<keyof T, 'mtime' | 'atime' | 'mode' | 'fallbackMode'>
>;

type TransferOption = ExternalTransferOption<InternalTransferOption>;
interface SyncOption extends TransferOption {
  // delete extraneous files from dest dirs
  delete?: boolean;

  // skip creating new files on dest
  skipCreate?: boolean;

  // skip updating files that exist on dest
  ignoreExisting?: boolean;

  // update the dest only if a newer version is on the src filesystem
  update?: boolean;

  // make newest file to be present in both locations.
  bothDirections?: boolean;
}

interface BaseTransferHandleConfig {
  srcFsPath: string;
  targetFsPath: string;
  dirPerm?: number,
  filePerm?: number,
  srcFs: FileSystem;
  targetFs: FileSystem;
  transferDirection: TransferDirection;
  // The remote server host. Threaded onto every TransferTask (via the config spread used throughout
  // the recursive helpers) so the completion hook can report which server each file went to/failed on.
  remoteHost?: string;
}

interface TransferHandleConfig<T> extends BaseTransferHandleConfig {
  transferOption: T;
}

function getAltDirection(direction: TransferDirection) {
  return direction === TransferDirection.LOCAL_TO_REMOTE
    ? TransferDirection.REMOTE_TO_LOCAL
    : TransferDirection.LOCAL_TO_REMOTE;
}

function isFileModified(a: FileEntry, b: FileEntry): boolean {
  // compare time at seconds
  return Math.floor(a.mtime / 1000) !== Math.floor(b.mtime / 1000) || a.size !== b.size;
}

function toHash<T, R = T>(items: T[], key: string, transform?: (a: T) => R): { [key: string]: R } {
  return items.reduce((hash, item) => {
    const transformedItem = transform ? transform(item) : item;
    hash[transformedItem[key]] = transformedItem;
    return hash;
  }, {});
}

async function transferFolder(
  config: TransferHandleConfig<TransferOption>,
  collect: (t: TransferTask) => void,
  skipKey?: string
) {
  const { srcFsPath, targetFsPath, srcFs, targetFs, transferOption } = config;

  if (transferOption.ignore && transferOption.ignore(srcFsPath)) {
    return;
  }

  // Need this to make sure file can correct transfer
  await targetFs.ensureDir(targetFsPath);

  // If dirPerm is configured, we chmod the remote directory after creation.
  if (config.transferOption.dirPerm) {
    logger.info('chmod remote directory as configured by dirPerm, dirPerm is: ', config.transferOption.dirPerm);
    try {
      await targetFs.chmod(targetFsPath, parseInt(String(config.transferOption.dirPerm), 8));
    } catch (error) {
      logger.warn('failed to chmod remote directory (dirPerm):', error);
    }
  }

  const fileEntries = await srcFs.list(srcFsPath);

  // Resolve the byte threshold once per call; a maxFileSize of 0 or absent means no filtering.
  const maxFileSizeMB: number = (transferOption as InternalTransferOption).maxFileSize || 0;
  const bytesLimit: number = maxFileSizeMB > 0 ? maxFileSizeMB * 1024 * 1024 : 0;

  await Promise.all(
    fileEntries.map(file => {
      // Only filter regular files (not directories or symlinks); bytesLimit 0 = disabled.
      if (bytesLimit > 0 && file.type === FileType.File && file.size > bytesLimit) {
        logger.info(`skip (too large) ${file.fspath} (${file.size} bytes > ${maxFileSizeMB} MB limit)`);
        if (skipKey) {
          const entry = _skipCounters.get(skipKey);
          if (entry) {
            entry.count += 1;
          }
        }
        return Promise.resolve();
      }

      return transferWithType(
        {
          ...config,
          transferOption: {
            ...config.transferOption,
            mtime: file.mtime,
            atime: file.atime,
          },
          srcFsPath: file.fspath,
          targetFsPath: targetFs.pathResolver.join(targetFsPath, file.name),
          ensureDirExist: false,
        },
        file.type,
        collect,
        skipKey
      );
    })
  );

  logger.info('folder transfered.');
}

async function transferFile(
  config: TransferHandleConfig<InternalTransferOption>,
  fileType: FileType,
  collect: (t: TransferTask) => void
) {
  if (config.transferOption.ignore && config.transferOption.ignore(config.srcFsPath)) {
    return;
  }

  collect(
    new TransferTask(
      {
        fsPath: config.srcFsPath,
        fileSystem: config.srcFs,
      },
      {
        fsPath: config.targetFsPath,
        fileSystem: config.targetFs,
      },
      {
        fileType,
        transferDirection: config.transferDirection,
        transferOption: config.transferOption,
        remoteHost: config.remoteHost,
      }
    )
  );
}

async function transferWithType(
  config: TransferHandleConfig<InternalTransferOption> & {
    ensureDirExist: boolean;
  },
  fileType: FileType,
  collect: (t: TransferTask) => void,
  // Key into _skipCounters for the current root operation; absent means no skip accounting
  // (e.g. a single-file explicit command that was NOT called from transferFolder/_sync).
  skipKey?: string
) {
  switch (fileType) {
    case FileType.Directory:
      await transferFolder(config, collect, skipKey);
      break;
    case FileType.File:
    case FileType.SymbolicLink:
      if (config.ensureDirExist) {
        const { targetFs, targetFsPath } = config;
        await targetFs.ensureDir(targetFs.pathResolver.dirname(targetFsPath));
        // If dirPerm is configured, we chmod the remote directory after creation.
        if (config.transferOption.dirPerm) {
          logger.info('Running chmod on remote directory with perm: ', config.transferOption.dirPerm);
          try {
            await targetFs.chmod(targetFs.pathResolver.dirname(targetFsPath), parseInt(String(config.transferOption.dirPerm), 8));
          } catch (error) {
            logger.warn('failed to chmod remote directory (dirPerm):', error);
          }
        }
      }
      // <<< save before upload: start
      if (config.transferDirection === TransferDirection.LOCAL_TO_REMOTE) {
        const textDocuments = getOpenTextDocuments();
        const document = textDocuments.find(doc => isSameLocalPath(doc.fileName, config.srcFsPath));
        if (document && !document.isClosed && document.isDirty) {
          await document.save();
          // Update mtime after file was saved
          const stat = await config.srcFs.lstat(config.srcFsPath);
          config.transferOption.mtime = stat.mtime;
          logger.info('save before upload.');
        }
      }
      // save before upload: end >>>
      transferFile(config, fileType, collect);
      break;
    default:
      logger.warn(`Unsupported file type (type = ${fileType}). File ${config.srcFsPath}`);
  }
}

async function removeFile(file: string, fs: FileSystem, fileType: FileType, option) {
  if (option.ignore && option.ignore(file)) {
    return;
  }

  // Keep removals non-fatal: a single failed delete should be logged, not abort the whole sync.
  try {
    switch (fileType) {
      case FileType.Directory:
        await fileOperations.removeDir(file, fs, option);
        logger.info('folder removed.');
        break;
      case FileType.File:
      case FileType.SymbolicLink:
        await fileOperations.removeFile(file, fs, option);
        logger.info('file removed.');
        break;
      default:
        break;
    }
  } catch (error) {
    logger.error(`failed to remove ${file}`, error);
  }
}

async function _sync(
  config: TransferHandleConfig<SyncOption>,
  collect: (t: TransferTask) => void,
  deleted: FileEntry[],
  // Key into _skipCounters for the root sync operation (threaded through recursion).
  skipKey?: string
) {

  const { srcFsPath, targetFsPath, srcFs, targetFs, transferOption, transferDirection } = config;
  if (transferOption.ignore && transferOption.ignore(srcFsPath)) {
    return;
  }

  const altDirection = getAltDirection(transferDirection);

  // For `bothDirections`, items that flow the OTHER way (e.g. server → local during a
  // local → remote sync) must swap the filesystems too, not merely carry a flipped direction
  // label. Without the swap we'd read the remote path from the local fs (ENOENT, so the file is
  // silently never downloaded) and try to write the local path onto the remote fs.
  const routeFsByDirection = (direction: TransferDirection) =>
    direction === transferDirection
      ? { srcFs, targetFs }
      : { srcFs: targetFs, targetFs: srcFs };

  // Byte limit for this sync operation (0 = disabled).
  const _syncMaxFileSizeMB: number = (transferOption as InternalTransferOption).maxFileSize || 0;
  const _syncBytesLimit: number = _syncMaxFileSizeMB > 0 ? _syncMaxFileSizeMB * 1024 * 1024 : 0;

  // Returns true when the file should be skipped due to size and records the skip.
  const _isTooBig = (entry: FileEntry): boolean => {
    if (_syncBytesLimit <= 0 || entry.type !== FileType.File) {
      return false;
    }
    if (entry.size > _syncBytesLimit) {
      logger.info(`skip (too large) ${entry.fspath} (${entry.size} bytes > ${_syncMaxFileSizeMB} MB limit)`);
      if (skipKey) {
        const counter = _skipCounters.get(skipKey);
        if (counter) {
          counter.count += 1;
        }
      }
      return true;
    }
    return false;
  };

  const syncFiles = (srcFileEntries: FileEntry[], desFileEntries: FileEntry[]) => {
    const srcFileTable = toHash(srcFileEntries, 'id', fileEntry => ({
      ...fileEntry,
      id: fileEntry.name,
    }));

    const desFileTable = toHash(desFileEntries, 'id', fileEntry => ({
      ...fileEntry,
      id: fileEntry.name,
    }));

    const file2trans: [string, string, TransferDirection, InternalTransferOption][] = [];
    const dir2trans: [string, string, TransferDirection][] = [];
    const dir2sync: [string, string][] = [];

    const fileMissed: string[] = [];
    const dirMissed: string[] = [];

    Object.keys(srcFileTable).forEach(id => {
      const srcFile = srcFileTable[id];
      const desFile = desFileTable[id];
      delete desFileTable[id];

      // files exist on both side
      if (desFile) {
        if (transferOption.ignoreExisting) {
          return;
        }

        let from: FileEntry = srcFile;
        let to: FileEntry = desFile;
        let direction: TransferDirection = transferDirection;
        switch (from.type) {
          case FileType.Directory:
            dir2sync.push([from.fspath, to.fspath]);
            break;
          case FileType.File:
          case FileType.SymbolicLink:
            if (transferOption.bothDirections) {
              // from new to old
              if (desFile.mtime > srcFile.mtime) {
                from = desFile;
                to = srcFile;
                direction = altDirection;
              }
            }

            if (transferOption.update) {
              if (from.mtime <= to.mtime) {
                return;
              }
            }

            // only transfer changed files
            if (isFileModified(from, to) && !_isTooBig(from)) {
              file2trans.push([
                from.fspath,
                to.fspath,
                direction,
                {
                  ...transferOption,
                  mode: to.mode, // prefer target mode
                  mtime: from.mtime,
                  atime: from.atime,
                },
              ]);
            }
            break;
          default:
          // do not process
        }
        return;
      }

      // files exist only on src
      if (transferOption.skipCreate) {
        return;
      }

      const fspath = targetFs.pathResolver.join(targetFsPath, srcFile.name);
      switch (srcFile.type) {
        case FileType.Directory:
          dir2trans.push([srcFile.fspath, fspath, transferDirection]);
          break;
        case FileType.File:
        case FileType.SymbolicLink:
          if (!_isTooBig(srcFile)) {
            file2trans.push([
              srcFile.fspath,
              fspath,
              transferDirection,
              {
                ...transferOption,
                fallbackMode: srcFile.mode,
                mtime: srcFile.mtime,
                atime: srcFile.atime,
              },
            ]);
          }
          break;
        default:
        // do not process
      }
    });

    // files exist only on target
    if (transferOption.bothDirections) {
      if (transferOption.skipCreate !== true) {
        Object.keys(desFileTable).forEach(id => {
          const file = desFileTable[id];
          const fspath = srcFs.pathResolver.join(srcFsPath, file.name);
          switch (file.type) {
            case FileType.Directory:
              dir2trans.push([file.fspath, fspath, altDirection]);
              break;
            case FileType.File:
            case FileType.SymbolicLink:
              if (!_isTooBig(file)) {
                file2trans.push([
                  file.fspath,
                  fspath,
                  altDirection,
                  {
                    ...transferOption,
                    fallbackMode: file.mode,
                    mtime: file.mtime,
                    atime: file.atime,
                  },
                ]);
              }
              break;
            default:
            // do not process
          }
        });
      }
    } else if (transferOption.delete) {
      Object.keys(desFileTable).forEach(id => {
        const file = desFileTable[id];
        deleted.push(file);
        switch (file.type) {
          case FileType.Directory:
            dirMissed.push(file.fspath);
            break;
          case FileType.File:
          case FileType.SymbolicLink:
            fileMissed.push(file.fspath);
            break;
          default:
          // do not process
        }
      });
    }

    // side-effect: collect deletions so they are awaited together with the transfers below;
    // otherwise the command can report success before the deletes actually finish.
    const removePromise = [
      ...fileMissed.map(file => removeFile(file, targetFs, FileType.File, transferOption)),
      ...dirMissed.map(file => removeFile(file, targetFs, FileType.Directory, transferOption)),
    ];

    const transFilePromise = file2trans.map(([src, target, direction, option]) =>
      transferFile(
        {
          ...config,
          ...routeFsByDirection(direction),
          transferDirection: direction,
          transferOption: option,
          srcFsPath: src,
          targetFsPath: target,
        },
        FileType.File,
        collect
      )
    );

    const transDirPromise = dir2trans.map(([src, target, direction]) =>
      transferFolder(
        {
          ...config,
          ...routeFsByDirection(direction),
          transferDirection: direction,
          srcFsPath: src,
          targetFsPath: target,
        },
        collect,
        skipKey
      )
    );

    const syncPromise = dir2sync.map(([src, target]) =>
      _sync(
        {
          ...config,
          srcFsPath: src,
          targetFsPath: target,
        },
        collect,
        deleted,
        skipKey
      )
    );

    return Promise.all([
      ...removePromise,
      ...transFilePromise,
      ...transDirPromise,
      ...syncPromise,
    ]).then(flatten);
  };

  // create dir here so we don't have to ensure it for children files.
  await targetFs.ensureDir(targetFsPath);

  // A failed list MUST abort the sync. Treating it as an empty directory is catastrophic with
  // syncOption.delete: every file on the other side becomes "extraneous" and gets deleted.
  const listOrFail = (fs: FileSystem, fsPath: string, side: string) =>
    fs.list(fsPath).catch(err => {
      throw new Error(
        `sync aborted: cannot list ${side} directory "${fsPath}": ${err && err.message ? err.message : err}`
      );
    });

  const files = await Promise.all([
    listOrFail(srcFs, srcFsPath, 'source'),
    listOrFail(targetFs, targetFsPath, 'target'),
  ]);
  await syncFiles(...files);
}

export { TransferOption, SyncOption, TransferDirection };

// Show an info message if any files were skipped due to the maxFileSize threshold.
function _reportSkips(key: string): void {
  const entry = _skipCounters.get(key);
  _skipCounters.delete(key);
  if (!entry || entry.count === 0) {
    return;
  }
  const count = entry.count;
  const mb = entry.thresholdMB;
  // Canonical Russian plural for "файл" (mod-10/mod-100 rule): 21 → файл, 22-24 → файла,
  // 11-14 and 5-20 → файлов.
  const m10 = count % 10;
  const m100 = count % 100;
  const ruWord =
    m10 === 1 && m100 !== 11
      ? 'файл'
      : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)
      ? 'файла'
      : 'файлов';
  vscode.window.showInformationMessage(
    L({
      en: `Skipped ${count} file${count !== 1 ? 's' : ''} larger than ${mb} MB`,
      ru: `Пропущено ${count} ${ruWord} больше ${mb} МБ`,
    })
  );
}

export async function transfer(
  config: TransferHandleConfig<TransferOption>,
  collect: (t: TransferTask) => void
) {
  const stat = await config.srcFs.lstat(config.srcFsPath);
  const transferOption = {
    ...config.transferOption,
    fallbackMode: stat.mode,
    mtime: stat.mtime,
    atime: stat.atime,
    filePerm: config?.filePerm,
    dirPerm: config?.dirPerm
  };

  // For a folder transfer, enable skip-counting so oversized files inside are silently skipped
  // and a single summary message is shown at the end. For a single-file explicit command we pass
  // no skipKey, which means transferWithType/transferFile will never apply the size filter —
  // the user explicitly asked for that one file, so we always honour it.
  const maxFileSizeMB: number = (transferOption as InternalTransferOption).maxFileSize || 0;
  const isFolderOp = stat.type === FileType.Directory;
  const skipKey = (isFolderOp && maxFileSizeMB > 0) ? `${config.srcFsPath}#${++_skipKeySeq}` : undefined;
  if (skipKey) {
    _skipCounters.set(skipKey, { count: 0, thresholdMB: maxFileSizeMB });
  }

  try {
    await transferWithType({ ...config, transferOption, ensureDirExist: true }, stat.type, collect, skipKey);
  } finally {
    if (skipKey) {
      _reportSkips(skipKey);
    }
  }
}

export async function sync(
  config: TransferHandleConfig<SyncOption>,
  collect: (t: TransferTask) => void
): Promise<FileEntry[]> {
  const deleted: FileEntry[] = [];

  // Register a skip counter keyed by the root source path for the duration of this sync.
  const maxFileSizeMB: number = (config.transferOption as InternalTransferOption).maxFileSize || 0;
  const skipKey = maxFileSizeMB > 0 ? `${config.srcFsPath}#${++_skipKeySeq}` : undefined;
  if (skipKey) {
    _skipCounters.set(skipKey, { count: 0, thresholdMB: maxFileSizeMB });
  }

  try {
    await _sync(config, collect, deleted, skipKey);
  } finally {
    if (skipKey) {
      _reportSkips(skipKey);
    }
  }

  return deleted;
}
