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
    // Full tree refresh — the same mechanism as the toolbar Refresh button (which is known to work) —
    // so the newly created file shows up without the user pressing refresh.
    return app.remoteExplorer.refresh();
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
    return app.remoteExplorer.refresh();
  },
});
