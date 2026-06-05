import { fileOperations } from '../core';
import { refreshRemoteExplorer } from './shared';
import createFileHandler from './createFileHandler';
import { FileHandleOption } from './option';

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
    // Refresh the parent folder so the new file shows up in the tree without a manual refresh.
    // Passing isDirectory=false makes refresh() fire the PARENT (re-listing it) — the exact same
    // mechanism the Delete command uses, which is known to update the tree correctly.
    refreshRemoteExplorer(this.target, false);
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
    refreshRemoteExplorer(this.target, false);
  },
});
