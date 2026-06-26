import * as vscode from 'vscode';
import { COMMAND_CONFIG } from '../constants';
import { resolveConfigPath } from '../modules/config';
import { runConfigWizard } from '../modules/configWizard';
import {
  getWorkspaceFolders,
  showConfirmMessage,
  showOpenDialog,
  openFolder,
  addWorkspaceFolder,
  showTextDocument,
} from '../host';
import { checkCommand } from './abstract/createCommand';
import { L } from '../i18n';

// Open the existing config (current or legacy) if there is one; otherwise run the setup wizard. This
// is what the "Create Configuration" welcome button and the explorer-context "Config" command both do.
async function createOrOpenConfig(basePath: string): Promise<void> {
  const existing = await resolveConfigPath(basePath);
  if (existing) {
    await showTextDocument(vscode.Uri.file(existing));
    return;
  }
  await runConfigWizard(basePath);
}

export default checkCommand({
  id: COMMAND_CONFIG,

  async handleCommand() {
    const workspaceFolders = getWorkspaceFolders();
    if (!workspaceFolders) {
      const result = await showConfirmMessage(
        L({ en: 'WireFerry expects to work at a folder.', ru: 'WireFerry работает в открытой папке.' }),
        L({ en: 'Open Folder', ru: 'Открыть папку' }),
        L({ en: 'Ok', ru: 'Ок' })
      );

      if (!result) {
        return;
      }

      return openFolder();
    }

    if (workspaceFolders.length <= 0) {
      const result = await showConfirmMessage(
        L({
          en: 'There are no available folders in current workspace.',
          ru: 'В текущем рабочем пространстве нет доступных папок.',
        }),
        L({ en: 'Add Folder to Workspace', ru: 'Добавить папку в рабочее пространство' }),
        L({ en: 'Ok', ru: 'Ок' })
      );

      if (!result) {
        return;
      }

      const resources = await showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: true,
      });

      if (!resources) {
        return;
      }

      addWorkspaceFolder(...resources.map(uri => ({ uri })));
      return;
    }

    if (workspaceFolders.length === 1) {
      await createOrOpenConfig(workspaceFolders[0].uri.fsPath);
      return;
    }

    const initDirs = workspaceFolders.map(folder => ({
      value: folder.uri.fsPath,
      label: folder.name,
      description: folder.uri.fsPath,
    }));

    const item = await vscode.window.showQuickPick(initDirs, {
      placeHolder: L({ en: 'Select a folder...', ru: 'Выберите папку...' }),
    });
    if (item === undefined) {
      return;
    }

    await createOrOpenConfig(item.value);
  },
});
