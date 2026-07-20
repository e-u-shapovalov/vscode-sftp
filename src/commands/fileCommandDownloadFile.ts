import { COMMAND_DOWNLOAD_FILE } from '../constants';
import { downloadFile } from '../fileHandlers';
import { isReadPermissionDenied, offerDownloadAsRoot } from '../modules/downloadFallback';
import { uriFromExplorerContextOrEditorContext } from './shared';
import { checkFileCommand } from './abstract/createCommand';

export default checkFileCommand({
  id: COMMAND_DOWNLOAD_FILE,
  getFileTarget: uriFromExplorerContextOrEditorContext,

  async handleFile(ctx) {
    try {
      await downloadFile(ctx, { ignore: null });
    } catch (e) {
      // A root-owned file the login user can't read → offer to fetch it AS ROOT into the local copy.
      if (!isReadPermissionDenied(e)) {
        throw e;
      }
      await offerDownloadAsRoot(ctx);
    }
  },
});
