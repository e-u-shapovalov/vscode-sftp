import { COMMAND_CHECK_FOR_UPDATES } from '../constants';
import { checkForUpdatesNow } from '../modules/updateCheck';
import { checkCommand } from './abstract/createCommand';

// Manual "WireFerry: Check for Updates" (Part 9). Auto-registered by initCommands via the
// command*.ts require.context. Explicit user action, so it goes straight to the GitHub check.
export default checkCommand({
  id: COMMAND_CHECK_FOR_UPDATES,

  async handleCommand() {
    await checkForUpdatesNow();
  },
});
