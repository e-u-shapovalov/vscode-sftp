import { COMMAND_UPLOAD_FOLDER } from '../constants';
import { uploadFolder } from '../fileHandlers';
import { isWritePermissionDenied, offerUploadAsRoot } from '../modules/uploadFallback';
import { checkFileCommand } from './abstract/createCommand';
import { uriFromExplorerContextOrEditorContext } from './shared';

export default checkFileCommand({
  id: COMMAND_UPLOAD_FOLDER,
  getFileTarget: uriFromExplorerContextOrEditorContext,

  async handleFile(ctx) {
    try {
      await uploadFolder(ctx);
    } catch (e) {
      // Dropping a folder into a directory the login user can't write (e.g. /root) fails at MKDIR —
      // offer to redo the whole upload AS ROOT (stage to /tmp, then `su` cp into place). Anything else
      // propagates to the normal error toast.
      if (!isWritePermissionDenied(e)) {
        throw e;
      }
      await offerUploadAsRoot(ctx);
    }
  },
});
