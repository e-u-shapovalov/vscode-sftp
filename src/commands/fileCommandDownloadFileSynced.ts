import { COMMAND_DOWNLOAD_FILE_SYNCED } from '../constants';
import downloadFileCommand from './fileCommandDownloadFile';
import { checkFileCommand } from './abstract/createCommand';

// Identical behaviour to Download; a separate command id only so the Synced context menu can show it with
// a struck-through title ("the file is identical — downloading is redundant") while keeping it fully
// functional (a force re-download of an in-sync file stays one click away). Spreading the original reuses
// its getFileTarget/handleFile; the loader overwrites `name`, and only the id differs.
export default checkFileCommand({
  ...downloadFileCommand,
  id: COMMAND_DOWNLOAD_FILE_SYNCED,
});
