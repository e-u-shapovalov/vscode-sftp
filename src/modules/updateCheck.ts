import * as vscode from 'vscode';
import { L } from '../i18n';

const EXTENSION_ID = 'EvgeniiShapovalov.wireferry';
const CHECK_MARKETPLACE_UPDATES_COMMAND = 'workbench.extensions.action.checkForUpdates';

// Marketplace builds update through VS Code itself. This command is kept as a convenient
// WireFerry entry point: it asks VS Code to refresh extension updates and opens our details page.
export async function checkForUpdatesNow(): Promise<void> {
  let checked = true;
  try {
    await vscode.commands.executeCommand(CHECK_MARKETPLACE_UPDATES_COMMAND);
  } catch (e) {
    checked = false;
  }

  try {
    await vscode.commands.executeCommand('extension.open', EXTENSION_ID);
  } catch (e) {
    await vscode.env.openExternal(
      vscode.Uri.parse(`https://marketplace.visualstudio.com/items?itemName=${EXTENSION_ID}`)
    );
  }

  vscode.window.showInformationMessage(
    checked
      ? L({
          en: 'WireFerry: VS Code is checking Marketplace for extension updates. If an update is available, use the Update button on the extension page.',
          ru: 'WireFerry: VS Code проверяет обновления расширений в Marketplace. Если обновление доступно, используйте кнопку Update на странице расширения.',
        })
      : L({
          en: 'WireFerry: opened the extension page. VS Code Marketplace updates are handled by the Extensions view.',
          ru: 'WireFerry: открыта страница расширения. Обновления из Marketplace обрабатываются в разделе Extensions.',
        })
  );
}
