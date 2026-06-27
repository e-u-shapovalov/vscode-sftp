import { COMMAND_REMOTEEXPLORER_EDITINLOCAL } from '../constants';
import { downloadFile } from '../fileHandlers';
import { suppressDownloadOnOpenOnce } from '../modules/fileActivityMonitor';
import { openDownloadedFile } from '../helper/smartOpen';
import { warnOutsideScopeOnce } from '../helper/outOfScope';
import { uriFromExplorerContextOrEditorContext } from './shared';
import { checkFileCommand } from './abstract/createCommand';

export default checkFileCommand({
  id: COMMAND_REMOTEEXPLORER_EDITINLOCAL,
  getFileTarget: uriFromExplorerContextOrEditorContext,
  // Reading is allowed anywhere, so opening a file the user browsed to ABOVE remotePath must not be
  // blocked by the containment guard — only this command opts out (auto-sync/upload stay strict).
  allowOutsideRoot: true,

  async handleFile(ctx) {
    // Opening such a file downloads a copy outside the workspace; explain that once per scope (where
    // the copy lands, how to widen the scope) without blocking. No-op for in-scope files.
    warnOutsideScopeOnce({
      scope: ctx.config.remotePath,
      remotePath: ctx.target.remoteFsPath,
      localPath: ctx.target.localFsPath,
      host: ctx.config.host,
    });

    await downloadFile(ctx, { ignore: null });
    // editInLocal already fetched the file intentionally; tell the file-open watcher not to run
    // downloadOnOpen for the open that immediately follows.
    suppressDownloadOnOpenOnce(ctx.target.localUri.fsPath);
    // Open it — but a binary blob or a >10 MB file freezes the editor, so openDownloadedFile asks
    // first in those cases instead of opening blindly.
    await openDownloadedFile(ctx.target.localUri, { preview: true });
  },
});
