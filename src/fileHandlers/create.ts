import { fileOperations } from '../core';
import createFileHandler from './createFileHandler';
import { FileHandleOption } from './option';
import app from '../app';

// Note: these handlers deliberately do NOT set an `ignore` transform. They only run from the explicit
// "Create File"/"Create Folder" commands, and the sync `ignore` filter is meant for bulk
// upload/download — applying it here would make an explicit create silently do nothing whenever the
// name matches an ignore rule (e.g. a `*.txt` pattern blocking every new .txt file).
export const createRemoteFile = createFileHandler<FileHandleOption & { skipDir?: boolean }>({
  name: 'createRemoteFile',
  // Resolves true when the file was really created, false when the name was already taken — the caller
  // (the command) must not go on to open a "new" file that is actually someone else's existing one.
  async handle() {
    const remoteFs = await this.fileService.getRemoteFileSystem(this.config);
    const { remoteFsPath } = this.target;
    return fileOperations.createFile(remoteFsPath, remoteFs, { filePerm: this.config.filePerm });
  },
  async afterHandle() {
    // Re-list the parent and reveal the new file so it appears in the tree without a manual refresh.
    await app.remoteExplorer.showCreated(this.target.remoteUri, false);
  },
});

export const createRemoteFolder = createFileHandler<FileHandleOption & { skipDir?: boolean }>({
  name: 'createRemoteFolder',
  async handle() {
    const remoteFs = await this.fileService.getRemoteFileSystem(this.config);
    const { remoteFsPath } = this.target;
    return fileOperations.createDir(remoteFsPath, remoteFs, { dirPerm: this.config.dirPerm });
  },
  async afterHandle() {
    await app.remoteExplorer.showCreated(this.target.remoteUri, true);
  },
});
