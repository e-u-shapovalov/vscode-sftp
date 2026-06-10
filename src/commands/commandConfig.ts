import * as vscode from 'vscode';
import { COMMAND_CONFIG } from '../constants';
import { newConfig } from '../modules/config';
import {
  getWorkspaceFolders,
  showConfirmMessage,
  showOpenDialog,
  openFolder,
  addWorkspaceFolder,
} from '../host';
import { checkCommand } from './abstract/createCommand';
import { L } from '../i18n';

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
      newConfig(workspaceFolders[0].uri.fsPath);
      return;
    }

    const initDirs = workspaceFolders.map(folder => ({
      value: folder.uri.fsPath,
      label: folder.name,
      description: folder.uri.fsPath,
    }));

    vscode.window
      .showQuickPick(initDirs, {
        placeHolder: L({ en: 'Select a folder...', ru: 'Выберите папку...' }),
      })
      .then(item => {
        if (item === undefined) {
          return;
        }

        newConfig(item.value);
      });
  },
});
