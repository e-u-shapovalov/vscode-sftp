import * as vscode from 'vscode';
import { COMMAND_DELETE_REMOTE } from '../constants';
import { upath } from '../core';
import { removeRemote } from '../fileHandlers';
import { reportError } from '../helper';
import { checkCommand } from './abstract/createCommand';
import { uriFromExplorerContextOrEditorContext } from './shared';
import { L } from '../i18n';
import * as operationReport from '../ui/operationReport';

type DeleteScope = 'server' | 'local' | 'both';

// Russian plural for a count subject: 1 элемент, 2 элемента, 5 элементов.
function pluralRu(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

// Modal "where do you want to delete this?" prompt. Returns the chosen scope, or undefined when the
// user cancels (Esc / Cancel / dialog dismissed). `subject` is pre-formatted: a quoted name list, or a
// "N items" count for a big multi-select (so the modal doesn't grow absurdly tall).
async function askDeleteScope(subject: string): Promise<DeleteScope | undefined> {
  const onServer = { title: L({ en: 'On server', ru: 'На сервере' }) };
  const onComputer = { title: L({ en: 'On computer', ru: 'На компьютере' }) };
  const onBoth = { title: L({ en: 'On both', ru: 'И там, и там' }) };
  const cancel = { title: L({ en: 'Cancel', ru: 'Отмена' }), isCloseAffordance: true };

  const picked = await vscode.window.showWarningMessage(
    L({ en: `Delete ${subject}?`, ru: `Удалить ${subject}?` }),
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
    const names = targetList.map(t => upath.basename(t.fsPath));
    // Listing every name makes the modal absurdly tall on a big multi-select — past 5, show the count.
    const subject =
      names.length > 5
        ? L({
            en: `${names.length} items`,
            ru: `${names.length} ${pluralRu(names.length, 'элемент', 'элемента', 'элементов')}`,
          })
        : L({ en: `'${names.join(', ')}'`, ru: `«${names.join(', ')}»` });

    const scope = await askDeleteScope(subject);
    if (scope === undefined) {
      return;
    }

    // 'server' → remote only; 'local' → local copy only (server untouched); 'both' → remote + local.
    // `ignore: null` bypasses the sync `ignore` filter: this is an explicit delete of a file the user
    // can see in the tree, so an ignore rule (e.g. `*.txt`) must not silently skip it. Auto-sync
    // callers of removeRemote (file watcher, upload-changed-files) don't pass this and still honour it.
    // `reportScope` is forwarded into removeRemote so each report row carries the chosen scope.
    const option =
      scope === 'server'
        ? { removeLocalCopy: false, ignore: null, reportScope: 'server' as const }
        : scope === 'local'
        ? { removeLocalCopy: true, skipRemote: true, ignore: null, reportScope: 'local' as const }
        : { removeLocalCopy: true, ignore: null, reportScope: 'both' as const };

    await operationReport.withReport('delete', () =>
      Promise.all(
        targetList.map(async uri => {
          try {
            await removeRemote(uri, option);
          } catch (error) {
            reportError(error);
          }
        })
      )
    );
  },
});
