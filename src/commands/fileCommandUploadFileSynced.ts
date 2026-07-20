import { COMMAND_UPLOAD_FILE_SYNCED } from '../constants';
import uploadFileCommand from './fileCommandUploadFile';
import { checkFileCommand } from './abstract/createCommand';

// Identical behaviour to Upload; a separate command id only so the Synced context menu can show it with a
// struck-through title while keeping a force re-upload of an in-sync file available. Spreading the original
// reuses its getFileTarget/handleFile; the loader overwrites `name`, and only the id differs.
export default checkFileCommand({
  ...uploadFileCommand,
  id: COMMAND_UPLOAD_FILE_SYNCED,
});
