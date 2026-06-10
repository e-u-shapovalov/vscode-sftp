import * as vscode from 'vscode';
import { COMMAND_DELETE_REMOTE } from '../constants';
import { upath } from '../core';
import { removeRemote } from '../fileHandlers';
import { reportError } from '../helper';
import { checkCommand } from './abstract/createCommand';
import { uriFromExplorerContextOrEditorContext } from './shared';
import { L } from '../i18n';

type DeleteScope = 'server' | 'local' | 'both';

// Modal "where do you want to delete this?" prompt. Returns the chosen scope, or undefined when the
// user cancels (Esc / Cancel / dialog dismissed).
async function askDeleteScope(name: string): Promise<DeleteScope | undefined> {
  const onServer = { title: L({ en: 'On server', ru: 'На сервере' }) };
  const onComputer = { title: L({ en: 'On computer', ru: 'На компьютере' }) };
  const onBoth = { title: L({ en: 'On both', ru: 'И там, и там' }) };
  const cancel = { title: L({ en: 'Cancel', ru: 'Отмена' }), isCloseAffordance: true };

  const picked = await vscode.window.showWarningMessage(
    L({ en: `Delete '${name}'?`, ru: `Удалить «${name}»?` }),
    {
      modal: true,
      detail: L({
        en: 'Choose where to delete it. The local copy is moved to the OS trash, not erased.',
        ru: 'Выберите, где удалить. Локальная копия уходит в Корзину ОС, а не стирается безвозвратно.',
      }),
    },
    onServer,
    onComputer,
    onBoth,
    cancel
  );

  if (!picked || picked.title === cancel.title) {
    return undefined;
  }
  if (picked.title === onServer.title) {
    return 'server';
  }
  if (picked.title === onComputer.title) {
    return 'local';
  }
  return 'both';
}

export default checkCommand({
  id: COMMAND_DELETE_REMOTE,

  async handleCommand(item, items) {
    const targets = uriFromExplorerContextOrEditorContext(item, items);
    if (!targets) {
      return;
    }

    const targetList = Array.isArray(targets) ? targets : [targets];
    const filename = targetList.map(t => upath.basename(t.fsPath)).join(', ');

    const scope = await askDeleteScope(filename);
    if (scope === undefined) {
      return;
    }

    // 'server' → remote only; 'local' → local copy only (server untouched); 'both' → remote + local.
    const option =
      scope === 'server'
        ? { removeLocalCopy: false }
        : scope === 'local'
        ? { removeLocalCopy: true, skipRemote: true }
        : { removeLocalCopy: true };

    await Promise.all(
      targetList.map(async uri => {
        try {
          await removeRemote(uri, option);
        } catch (error) {
          reportError(error);
        }
      })
    );
  },
});
