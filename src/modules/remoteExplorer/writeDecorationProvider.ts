import * as vscode from 'vscode';
import { REMOTE_SCHEME } from '../../constants';
import { L } from '../../i18n';
import RemoteTreeData, { NodeStatus } from './treeDataProvider';

// Paints the native VS Code file-decoration (badge + colour, the same mechanism git status uses) for the
// combined local↔remote status of a tree node, plus the "read-only for you" write hint. Both the status
// and the writability are computed by the tree (getChildren merge / _applyWriteHints); this only turns a
// node's cached flags into a decoration and repaints on the tree's signal. Priority when several apply:
// conflict (!) → server-unknown (?) → modified (M) → local-only (L) → read-only (RO).
export default class WriteDecorationProvider implements vscode.FileDecorationProvider {
  private _onDidChange = new vscode.EventEmitter<vscode.Uri[]>();
  readonly onDidChangeFileDecorations: vscode.Event<vscode.Uri[]> = this._onDidChange.event;
  private _sub: vscode.Disposable;

  constructor(private tree: RemoteTreeData) {
    this._sub = tree.onDidChangeDecorations(uris => this._onDidChange.fire(uris));
  }

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    // Only our own remote nodes carry these flags; ignore every other uri VS Code paints.
    if (uri.scheme !== REMOTE_SCHEME) {
      return undefined;
    }
    const item = this.tree.getItemByUri(uri) as
      | { writable?: boolean; status?: string }
      | undefined;
    if (!item) {
      return undefined;
    }
    switch (item.status) {
      case NodeStatus.Conflict:
        return {
          badge: '!',
          color: new vscode.ThemeColor('list.errorForeground'),
          tooltip: L({
            en: 'Type conflict — a file on one side, a directory on the other',
            ru: 'Конфликт типов — с одной стороны файл, с другой папка',
          }),
        };
      case NodeStatus.Denied:
        // Yellow, no badge — the row's description already reads "no access — right-click", and colour is
        // not the only signal. Actionable: View as root re-lists/opens it via su.
        return {
          color: new vscode.ThemeColor('list.warningForeground'),
          tooltip: L({
            en: 'No read access — right-click and choose “View as root” (enter the owner or root password).',
            ru: 'Нет прав на чтение — ПКМ → «Показать / открыть от root» (введите пароль владельца или root).',
          }),
        };
      case NodeStatus.Unknown:
        return {
          badge: '?',
          color: new vscode.ThemeColor('list.warningForeground'),
          tooltip: L({
            en: "Server state unknown — the server listing couldn't be read",
            ru: 'Состояние на сервере неизвестно — не удалось получить список с сервера',
          }),
        };
      case NodeStatus.Modified:
        return {
          badge: 'M',
          color: new vscode.ThemeColor('gitDecoration.modifiedResourceForeground'),
          tooltip: L({
            en: 'Differs between your local copy and the server',
            ru: 'Различается между локальной копией и сервером',
          }),
        };
      case NodeStatus.LocalOnly:
        return {
          badge: 'L',
          color: new vscode.ThemeColor('list.deemphasizedForeground'),
          tooltip: L({
            en: 'Local only — exists on disk but not on the server yet',
            ru: 'Только локально — есть на диске, но ещё не на сервере',
          }),
        };
    }
    if (item.writable === false) {
      return {
        badge: 'RO',
        color: new vscode.ThemeColor('disabledForeground'),
        tooltip: L({
          en: 'Read-only for you (no write permission)',
          ru: 'Только чтение для вас (нет прав на запись)',
        }),
      };
    }
    return undefined;
  }

  dispose(): void {
    this._sub.dispose();
    this._onDidChange.dispose();
  }
}
