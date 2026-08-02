import * as fse from 'fs-extra';
import { COMMAND_CREATE_FILE } from '../constants';
import { createRemoteFile, FileHandlerContext } from '../fileHandlers';
import { upath, UResource } from '../core';
import { checkFileCommand } from './abstract/createCommand';
import { uriFromExplorerContextOrEditorContext, validateRemoteEntryName } from './shared';
import { isCreatePermissionDenied, offerCreateAsRoot } from '../modules/createFallback';
import { suppressDownloadOnOpenOnce } from '../modules/fileActivityMonitor';
import { openDownloadedFile } from '../helper/smartOpen';
import { showTextDocument } from '../host';
import logger from '../logger';
import { window, ProgressLocation } from 'vscode';
import { L } from '../i18n';

// A just-created remote file is empty, so there is nothing to download: touch the workspace copy and open
// it, the way "Edit in Local" opens a fetched file — the user asked for a new file to write in, not for an
// entry to admire in the tree. ensureFile never truncates, so a name that already exists locally keeps its
// content — and because that content would then be uploaded over the new (empty) server file on the first
// save, the non-empty case asks before opening.
async function openNewFileLocally(ctx: FileHandlerContext): Promise<void> {
  const localPath = ctx.target.localFsPath;
  if (!localPath) {
    return;
  }
  try {
    await fse.ensureFile(localPath);
  } catch (e) {
    // The local copy couldn't be created (read-only folder, path too long). The server file IS there, so
    // this must not fail the command — just say why nothing opened.
    logger.warn(`create: couldn't prepare the local copy ${localPath}: ${(e && (e as Error).message) || e}`);
    return;
  }
  const size = await fse
    .stat(localPath)
    .then(s => s.size)
    .catch(() => -1);

  if (size > 0) {
    // The workspace already held a file under this name and ensureFile deliberately left it alone — so what
    // opens is that OLD local content, while the entry we just made on the server is empty. Left unsaid, it
    // reads as "the new file already has text in it", and the next save would push that old content onto the
    // freshly created (possibly root-owned) path. Confirm before opening rather than after the fact.
    const open = { title: L({ en: 'Open local copy', ru: 'Открыть локальную копию' }) };
    const cancel = { title: L({ en: 'Cancel', ru: 'Отмена' }), isCloseAffordance: true };
    const pick = await window.showWarningMessage(
      L({
        en: `A local file "${upath.basename(localPath)}" already exists and is not empty.`,
        ru: `Локальный файл «${upath.basename(localPath)}» уже существует и не пуст.`,
      }),
      {
        modal: true,
        detail: L({
          en: 'The file created on the server is empty. Opening shows your existing LOCAL content — saving it would upload that content over the new server file.',
          ru: 'Созданный на сервере файл пуст. Откроется ваше существующее ЛОКАЛЬНОЕ содержимое — при сохранении оно уедет на сервер поверх нового файла.',
        }),
      },
      open,
      cancel
    );
    if (!pick || pick.title !== open.title) {
      return; // the server entry is created either way; the user just doesn't want the local copy opened
    }
    // Suppression only lives for 3s, so it is armed AFTER the dialog — arming it before would let the
    // timeout lapse while the dialog is up and hand the open back to downloadOnOpen.
    suppressDownloadOnOpenOnce(localPath);
    await openDownloadedFile(ctx.target.localUri, { preview: false });
    return;
  }

  // We created this file on purpose — the open that follows must not trigger downloadOnOpen.
  suppressDownloadOnOpenOnce(localPath);
  // A brand-new file is 0 bytes: open it directly, since smartOpen's binary/size heuristic would ask
  // "this looks binary, open anyway?" purely because of the extension (a new `.dat`, `.conf.d/x`) with
  // nothing in the file to be dangerous.
  await showTextDocument(ctx.target.localUri, { preview: false });
}

export default checkFileCommand({
  id: COMMAND_CREATE_FILE,
  async getFileTarget(item, items) {
    const targets = await uriFromExplorerContextOrEditorContext(item, items);
    if (!targets) {
      return;
    }
    const parentUri = Array.isArray(targets) ? targets[0] : targets;

    const result = await window.showInputBox({
      value: '',
      prompt: L({ en: 'Please input file name', ru: 'Введите имя файла' }),
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
      // Creating is several server round trips (lstat → write → chmod → re-list the parent for the tree),
      // which on a slow link reads as a frozen editor. Show it working. The progress covers only this part:
      // the root fallback below brings its own (execAsRoot), and the dialogs must not sit behind a spinner.
      // false = the name was already taken on the server (createRemoteFile reported it). Opening then would
      // touch an EXISTING remote file through an empty local copy, and the next save would wipe it.
      const created = await window.withProgress(
        {
          location: ProgressLocation.Notification,
          title: L({ en: 'WireFerry: creating the file…', ru: 'WireFerry: создаю файл…' }),
        },
        () => createRemoteFile(ctx)
      );
      if (created === false) {
        return;
      }
    } catch (e) {
      // Creating inside a root-owned directory (/etc, /usr/local/…) is refused at the SFTP write — offer to
      // create it AS ROOT instead of dead-ending on a "Permission denied" toast. Anything else propagates
      // to the normal error report.
      if (!isCreatePermissionDenied(e)) {
        throw e;
      }
      if (!(await offerCreateAsRoot(ctx, false))) {
        return; // declined or failed — offerCreateAsRoot already surfaced the reason
      }
    }
    await openNewFileLocally(ctx);
  },
});
