import * as fse from 'fs-extra';
import { fileOperations } from '../core';
import { toRemotePath } from '../helper';
import createFileHandler from './createFileHandler';
import app from '../app';

// Rename or move a file/folder on the server. The handler target is the *source* (old) resource;
// the destination is supplied via options. Shared by:
//   - Remote Explorer "Rename"        → newRemotePath + localRename
//   - in-tree drag&drop move          → newRemotePath + localRename
//   - local→server rename/move sync   → newLocalPath (no local mirror: VS Code already moved it)
//   - git "Upload Changed Files"      → newLocalPath
//
// (Replaces the previous version, which fed local paths to a remote rename and swapped old/new —
// see ROADMAP. Source is target.remoteFsPath; the destination is an explicit remote path or a
// local path converted via the service config.)
export const renameRemote = createFileHandler<{
  newRemotePath?: string;
  newLocalPath?: string;
  localRename?: { from: string; to: string };
  skipRefresh?: boolean;
}>({
  name: 'rename',
  async handle({ newRemotePath, newLocalPath, localRename, skipRefresh }) {
    const remoteFs = await this.fileService.getRemoteFileSystem(this.config);
    const { remoteFsPath } = this.target;

    const destRemotePath =
      newRemotePath !== undefined
        ? newRemotePath
        : newLocalPath !== undefined
        ? toRemotePath(newLocalPath, this.config.context, this.config.remotePath)
        : undefined;

    const doRemote = destRemotePath !== undefined && destRemotePath !== remoteFsPath;
    const localFromExists =
      !!localRename &&
      localRename.from !== localRename.to &&
      (await fse.pathExists(localRename.from));

    // Preflight: fail BEFORE touching anything if a destination is already occupied, so we never end
    // up half-applied (server renamed but local left behind, or vice versa).
    if (localFromExists && (await fse.pathExists(localRename!.to))) {
      throw new Error(`Local target already exists: ${localRename!.to}`);
    }
    if (doRemote) {
      let remoteDestExists = false;
      try {
        await remoteFs.lstat(destRemotePath!);
        remoteDestExists = true;
      } catch (e) {
        remoteDestExists = false; // a stat error (ENOENT) means the destination is free — good.
      }
      if (remoteDestExists) {
        throw new Error(`Remote target already exists: ${destRemotePath}`);
      }
    }

    // Apply: server first, then mirror the local copy (Remote Explorer rename and in-tree drag&drop
    // opt in via localRename; local→server sync doesn't, since VS Code already moved the file).
    if (doRemote) {
      await fileOperations.rename(remoteFsPath, destRemotePath!, remoteFs);
    }
    if (localFromExists) {
      await fse.move(localRename!.from, localRename!.to, { overwrite: false });
    }

    if (!skipRefresh && app.remoteExplorer) {
      app.remoteExplorer.refresh();
    }
  },
});
