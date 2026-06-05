import * as vscode from 'vscode';
import * as fs from 'fs';
import { refreshRemoteExplorer } from './shared';
import { fileOperations, FileType } from '../core';
import createFileHandler from './createFileHandler';
import { FileHandleOption } from './option';
import logger from '../logger';

export const removeRemote = createFileHandler<
  FileHandleOption & { skipDir?: boolean; removeLocalCopy?: boolean }
>({
  name: 'removeRemote',
  async handle(option) {
    const remoteFs = await this.fileService.getRemoteFileSystem(this.config);
    const { remoteFsPath } = this.target;
    const stat = await remoteFs.lstat(remoteFsPath);
    let promise;
    switch (stat.type) {
      case FileType.Directory:
        if (option.skipDir) {
          return;
        }

        promise = fileOperations.removeDir(remoteFsPath, remoteFs, {});
        break;
      case FileType.File:
      case FileType.SymbolicLink:
        promise = fileOperations.removeFile(remoteFsPath, remoteFs, {});
        break;
      default:
        logger.warn(`Unsupported file type (type = ${stat.type}). File ${remoteFsPath}`);
    }
    await promise;

    // Optionally mirror the deletion to the local copy. Only the Remote Explorer
    // "Delete" command opts in via removeLocalCopy; other callers (file watcher,
    // upload-changed-files) act on files that are already gone locally.
    // We move it to the OS trash (not a permanent delete) so an accidental delete is recoverable.
    if (option.removeLocalCopy) {
      const { localFsPath } = this.target;
      if (localFsPath && fs.existsSync(localFsPath)) {
        try {
          await vscode.workspace.fs.delete(vscode.Uri.file(localFsPath), {
            recursive: true,
            useTrash: true,
          });
        } catch (error) {
          logger.warn(`Failed to move local copy '${localFsPath}' to trash: ${error.message}`);
        }
      }
    }
  },
  transformOption() {
    const config = this.config;
    return {
      ignore: config.ignore,
    };
  },
  afterHandle() {
    refreshRemoteExplorer(this.target, false);
  },
});
