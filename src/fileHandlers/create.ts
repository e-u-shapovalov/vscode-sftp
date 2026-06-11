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
  async handle() {
    const remoteFs = await this.fileService.getRemoteFileSystem(this.config);
    const { remoteFsPath } = this.target;
    await fileOperations.createFile(remoteFsPath, remoteFs, {});
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
    await fileOperations.createDir(remoteFsPath, remoteFs, {});
  },
  async afterHandle() {
    await app.remoteExplorer.showCreated(this.target.remoteUri, true);
  },
});
