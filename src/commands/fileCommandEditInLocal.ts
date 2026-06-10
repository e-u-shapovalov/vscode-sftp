import { COMMAND_REMOTEEXPLORER_EDITINLOCAL } from '../constants';
import { downloadFile } from '../fileHandlers';
import { showTextDocument } from '../host';
import { suppressDownloadOnOpenOnce } from '../modules/fileActivityMonitor';
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
    await showTextDocument(ctx.target.localUri, { preview: true });
  },
});
