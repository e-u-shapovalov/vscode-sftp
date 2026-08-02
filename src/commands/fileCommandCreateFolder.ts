import { COMMAND_CREATE_FOLDER } from '../constants';
import { createRemoteFolder } from '../fileHandlers';
import { upath, UResource } from '../core';
import { checkFileCommand } from './abstract/createCommand';
import { uriFromExplorerContextOrEditorContext, validateRemoteEntryName } from './shared';
import { isCreatePermissionDenied, offerCreateAsRoot } from '../modules/createFallback';
import { window, ProgressLocation } from 'vscode';
import { L } from '../i18n';

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
      prompt: L({ en: 'Please input folder name', ru: 'Введите имя папки' }),
      validateInput: validateRemoteEntryName,
    });
    if (result === undefined || validateRemoteEntryName(result) !== undefined) {
      return undefined;
    }

    // Build the child URI cleanly via UResource. A remote URI keeps its fsPath in the query, so
    // string-concatenating onto toString() corrupts it and breaks the tree refresh afterwards.
    const parent = UResource.makeResource(parentUri);
    const childPath = upath.join(parent.fsPath, result);
    return UResource.updateResource(parent, { remotePath: childPath }).uri;
  },

  async handleFile(ctx) {
    try {
      // Same reason as the file command: mkdir + chmod + re-listing the parent are server round trips, and
      // without a visible sign the window just looks stuck. The root fallback below has its own progress.
      await window.withProgress(
        {
          location: ProgressLocation.Notification,
          title: L({ en: 'WireFerry: creating the folder…', ru: 'WireFerry: создаю папку…' }),
        },
        () => createRemoteFolder(ctx)
      );
    } catch (e) {
      // Same wall as "Create File": a root-owned parent refuses the mkdir. Offer the escalated create;
      // anything that isn't a permission problem keeps going to the normal error report.
      if (!isCreatePermissionDenied(e)) {
        throw e;
      }
      await offerCreateAsRoot(ctx, true);
    }
  },
});
