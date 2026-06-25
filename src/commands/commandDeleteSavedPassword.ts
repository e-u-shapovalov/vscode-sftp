import * as vscode from 'vscode';
import { COMMAND_DELETE_SAVED_PASSWORD } from '../constants';
import { showInformationMessage } from '../host';
import { L } from '../i18n';
import {
  listIndexedCredentials,
  deleteCredential,
  CredentialDescriptor,
} from '../modules/secrets';
import { checkCommand } from './abstract/createCommand';

interface CredentialItem extends vscode.QuickPickItem {
  descriptor: CredentialDescriptor;
}

// SecretStorage can't enumerate its own keys, so the pick list is built from the descriptor index
// we keep in globalState (src/modules/secrets). That index is the only reliable way to surface and
// remove credentials whose config was later renamed, removed, or pointed elsewhere.
export default checkCommand({
  id: COMMAND_DELETE_SAVED_PASSWORD,

  async handleCommand() {
    const creds = listIndexedCredentials();
    if (creds.length === 0) {
      showInformationMessage(
        L({
          en: 'WireFerry: no saved credentials found.',
          ru: 'WireFerry: сохранённых учётных данных не найдено.',
        })
      );
      return;
    }

    const items: CredentialItem[] = creds.map(d => {
      const kind =
        d.type === 'password'
          ? L({ en: 'Password', ru: 'Пароль' })
          : L({ en: 'Passphrase', ru: 'Passphrase' });
      return {
        descriptor: d,
        label: `$(key) ${kind} · ${d.username}@${d.host}:${d.port}`,
        description: d.protocol.toUpperCase(),
      };
    });

    const selected = await vscode.window.showQuickPick(items, {
      canPickMany: true,
      placeHolder: L({
        en: 'Select saved credential(s) to delete from the OS keychain',
        ru: 'Выберите учётные данные для удаления из системного хранилища',
      }),
    });

    if (!selected || selected.length === 0) {
      return;
    }

    for (const item of selected) {
      await deleteCredential(item.descriptor);
    }

    showInformationMessage(
      L({
        en: `WireFerry: deleted ${selected.length} saved credential(s).`,
        ru: `WireFerry: удалено учётных данных — ${selected.length}.`,
      })
    );
  },
});
