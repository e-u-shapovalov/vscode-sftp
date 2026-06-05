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
    // Re-list the parent folder and reveal the new file so it appears in the tree immediately,
    // without the user pressing Refresh. An argument-less refresh() issues no readdir at all and
    // just collapses the tree to its roots, so it can't show the new entry in place.
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
