import { fileOperations } from '../core';
import createFileHandler from './createFileHandler';
import { FileHandleOption } from './option';
import app from '../app';

export const createRemoteFile = createFileHandler<FileHandleOption & { skipDir?: boolean }>({
  name: 'createRemoteFile',
  async handle(option) {
    const remoteFs = await this.fileService.getRemoteFileSystem(this.config);
    const { remoteFsPath } = this.target;
    await fileOperations.createFile(remoteFsPath, remoteFs, {});
  },
  transformOption() {
    return {
      ignore: this.config.ignore,
    };
  },
  async afterHandle() {
    // Re-list the parent and reveal the new file so it appears in the tree without a manual refresh.
    await app.remoteExplorer.showCreated(this.target.remoteUri, false);
  },
});

export const createRemoteFolder = createFileHandler<FileHandleOption & { skipDir?: boolean }>({
  name: 'createRemoteFolder',
  async handle(option) {
    const remoteFs = await this.fileService.getRemoteFileSystem(this.config);
    const { remoteFsPath } = this.target;
    await fileOperations.createDir(remoteFsPath, remoteFs, {});
  },
  transformOption() {
    return {
      ignore: this.config.ignore,
    };
  },
  async afterHandle() {
    await app.remoteExplorer.showCreated(this.target.remoteUri, true);
  },
});
