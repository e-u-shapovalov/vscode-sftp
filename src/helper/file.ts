import * as path from 'path';
import * as tmp from 'tmp';
import * as vscode from 'vscode';
import { CONFIG_PATH, LEGACY_CONFIG_PATH } from '../constants';
import { upath } from '../core';

const isWindows = process.platform === 'win32';

export function isValidFile(uri: vscode.Uri) {
  return uri.scheme === 'file';
}

// Only the workspace's own .vscode/wireferry.json (or legacy .vscode/sftp.json) is the extension
// config. Matching on basename alone treated ANY file named wireferry.json/sftp.json anywhere in the
// tree (e.g. fixtures/, a sample under src/) as the config — saving one tore down the live services
// and reloaded that arbitrary file. Compare the full path against the workspace folder instead.
export function isConfigFile(uri: vscode.Uri) {
  const folder = vscode.workspace.getWorkspaceFolder(uri);
  if (!folder) {
    return false;
  }
  const target = path.normalize(uri.fsPath);
  const eq = (a: string) => {
    const normalized = path.normalize(a);
    return isWindows
      ? normalized.toLowerCase() === target.toLowerCase()
      : normalized === target;
  };
  return (
    eq(path.join(folder.uri.fsPath, CONFIG_PATH)) ||
    eq(path.join(folder.uri.fsPath, LEGACY_CONFIG_PATH))
  );
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
