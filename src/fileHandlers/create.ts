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
  afterHandle() {
    // Show the new file immediately, without the user pressing the refresh button.
    return app.remoteExplorer.showCreated(this.target.remoteUri, false);
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
  afterHandle() {
    return app.remoteExplorer.showCreated(this.target.remoteUri, true);
  },
});
