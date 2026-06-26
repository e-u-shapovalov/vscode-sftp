import * as path from 'path';
import * as fse from 'fs-extra';
import * as vscode from 'vscode';
import { diffFiles } from '../host';
import { EXTENSION_NAME } from '../constants';
import { fileOperations } from '../core';
import { makeTmpFile } from '../helper';
import createFileHandler from './createFileHandler';

export const diff = createFileHandler({
  name: 'diff',
  async handle() {
    const remoteFs = await this.fileService.getRemoteFileSystem(this.config);
    const localFs = this.fileService.getLocalFileSystem();
    const { localFsPath, remoteFsPath } = this.target;
    const tmpPath = await makeTmpFile({
      prefix: `${EXTENSION_NAME}-`,
      postfix: path.extname(localFsPath),
    });

    await fileOperations.transferFile(remoteFsPath, tmpPath, remoteFs, localFs);
    // Remove the downloaded temp copy once its diff editor closes. makeTmpFile only registers a
    // process-exit cleanup (setGracefulCleanup), so without this every diff leaves a full copy of the
    // remote file in os.tmpdir() for the rest of the session. Best-effort; the exit cleanup is the
    // backstop if the close event never arrives.
    const sub = vscode.workspace.onDidCloseTextDocument(doc => {
      if (doc.uri.scheme === 'file' && doc.uri.fsPath === tmpPath) {
        sub.dispose();
        fse.remove(tmpPath).catch(() => undefined);
      }
    });
    await diffFiles(
      tmpPath,
      localFsPath,
      `${path.basename(localFsPath)} (${this.fileService.name || 'remote'} ↔ local)`
    );
  },
});
