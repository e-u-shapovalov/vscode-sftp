import { COMMAND_REMOTEEXPLORER_EDITINLOCAL } from '../constants';
import { downloadFile } from '../fileHandlers';
import { suppressDownloadOnOpenOnce } from '../modules/fileActivityMonitor';
import { openDownloadedFile } from '../helper/smartOpen';
import { uriFromExplorerContextOrEditorContext } from './shared';
import { checkFileCommand } from './abstract/createCommand';

export default checkFileCommand({
  id: COMMAND_REMOTEEXPLORER_EDITINLOCAL,
  getFileTarget: uriFromExplorerContextOrEditorContext,

  async handleFile(ctx) {
    await downloadFile(ctx, { ignore: null });
    // editInLocal already fetched the file intentionally; tell the file-open watcher not to run
    // downloadOnOpen for the open that immediately follows.
    suppressDownloadOnOpenOnce(ctx.target.localUri.fsPath);
    // Open it — but a binary blob or a >10 MB file freezes the editor, so openDownloadedFile asks
    // first in those cases instead of opening blindly.
    await openDownloadedFile(ctx.target.localUri, { preview: true });
  },
});
