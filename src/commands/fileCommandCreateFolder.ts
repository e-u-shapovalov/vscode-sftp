import { COMMAND_CREATE_FOLDER } from '../constants';
import { createRemoteFolder } from '../fileHandlers';
import { upath, UResource } from '../core';
import { checkFileCommand } from './abstract/createCommand';
import { uriFromExplorerContextOrEditorContext } from './shared';
import { window } from 'vscode';

export default checkFileCommand({
  id: COMMAND_CREATE_FOLDER,
  async getFileTarget(item, items) {
    const targets = await uriFromExplorerContextOrEditorContext(item, items);
    if (!targets) {
      return;
    }
    const parentUri = Array.isArray(targets) ? targets[0] : targets;

    const result = await window.showInputBox({
      value: '',
      prompt: 'Please input folder name',
    });
    if (result === undefined) {
      return undefined;
    }

    // Build the child URI cleanly via UResource. A remote URI keeps its fsPath in the query, so
    // string-concatenating onto toString() corrupts it and breaks the tree refresh afterwards.
    const parent = UResource.makeResource(parentUri);
    const childPath = upath.join(parent.fsPath, result);
    return UResource.updateResource(parent, { remotePath: childPath }).uri;
  },

  handleFile: createRemoteFolder,
});
