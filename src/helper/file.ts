import * as path from 'path';
import * as tmp from 'tmp';
import * as vscode from 'vscode';
import { CONGIF_FILENAME, LEGACY_CONFIG_FILENAME } from '../constants';
import { upath } from '../core';

export function isValidFile(uri: vscode.Uri) {
  return uri.scheme === 'file';
}

export function isConfigFile(uri: vscode.Uri) {
  const filename = path.basename(uri.fsPath);
  return filename === CONGIF_FILENAME || filename === LEGACY_CONFIG_FILENAME;
}

export function fileDepth(file: string) {
  return upath.normalize(file).split('/').length;
}

// Tell tmp to remove the files it created when the process exits. We hand back only the path
// (discardDescriptor) and drop tmp's per-file cleanup callback, so without this each diff would
// leave a full copy of the remote file on disk indefinitely.
tmp.setGracefulCleanup();

export function makeTmpFile(option): Promise<string> {
  return new Promise((resolve, reject) => {
    tmp.file({ ...option, discardDescriptor: true }, (err, tmpPath) => {
      if (err) {
        reject(err);
        return;
      }

      resolve(tmpPath);
    });
  });
}
