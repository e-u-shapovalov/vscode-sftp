import { COMMAND_CHECK_FOR_UPDATES } from '../constants';
import { checkForUpdatesNow } from '../modules/updateCheck';
import { checkCommand } from './abstract/createCommand';

// Manual "WireFerry: Check for Updates". Auto-registered by initCommands via the command*.ts
// require.context; delegates to VS Code's Marketplace update flow.
export default checkCommand({
  id: COMMAND_CHECK_FOR_UPDATES,

  async handleCommand() {
    await checkForUpdatesNow();
  },
});
