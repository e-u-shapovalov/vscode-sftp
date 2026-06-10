import * as vscode from 'vscode';
import { COMMAND_SET_PROFILE } from '../constants';
import { showInformationMessage } from '../host';
import app from '../app';
import logger from '../logger';
import { getAllFileService } from '../modules/serviceManager';
import { checkCommand } from './abstract/createCommand';
import { L } from '../i18n';

export default checkCommand({
  id: COMMAND_SET_PROFILE,

  async handleCommand(definedProfile) {
    const profiles = getAllFileService().reduce<
      Array<vscode.QuickPickItem & { value: string | null }>
    >(
      (acc, service) => {
        if (service.getAvailableProfiles().length <= 0) {
          return acc;
        }

        service.getAvailableProfiles().forEach(profile => {
          acc.push({
            value: profile,
            label:
              app.state.profile === profile
                ? `${profile} ${L({ en: '(active)', ru: '(активный)' })}`
                : profile,
          });
        });
        return acc;
      },
      [
        {
          value: null,
          label: L({ en: 'UNSET', ru: 'НЕ ЗАДАН' }),
        },
      ]
    );

    if (profiles.length <= 1) {
      showInformationMessage(L({ en: 'No Available Profile.', ru: 'Нет доступных профилей.' }));
      return;
    }

    if (definedProfile !== undefined) {
      const index = profiles.findIndex(a => a.value === definedProfile);
      if (index !== -1) {
        app.state.profile = definedProfile;
      } else {
        app.state.profile = null;
        logger.warn(`try to set a unknown profile "${definedProfile}"`);
      }
      return;
    }

    const item = await vscode.window.showQuickPick(profiles, {
      placeHolder: L({ en: 'select a profile', ru: 'выберите профиль' }),
    });
    if (item === undefined) return;
    app.state.profile = item.value;
  },
});
