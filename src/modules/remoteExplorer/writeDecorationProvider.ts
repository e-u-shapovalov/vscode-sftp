import * as vscode from 'vscode';
import { REMOTE_SCHEME } from '../../constants';
import { L } from '../../i18n';
import RemoteTreeData from './treeDataProvider';

// Dims remote files the current user can't write and tags them "RO", the same native mechanism VS Code
// uses for git status colors. The writability itself is computed by the tree (see _applyWriteHints);
// this only turns a node's `writable === false` into a decoration and repaints on the tree's signal.
export default class WriteDecorationProvider implements vscode.FileDecorationProvider {
  private _onDidChange = new vscode.EventEmitter<vscode.Uri[]>();
  readonly onDidChangeFileDecorations: vscode.Event<vscode.Uri[]> = this._onDidChange.event;
  private _sub: vscode.Disposable;

  constructor(private tree: RemoteTreeData) {
    this._sub = tree.onDidChangeDecorations(uris => this._onDidChange.fire(uris));
  }

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    // Only our own remote nodes carry the flag; ignore every other uri VS Code paints.
    if (uri.scheme !== REMOTE_SCHEME) {
      return undefined;
    }
    const item = this.tree.getItemByUri(uri) as { writable?: boolean } | undefined;
    if (item && item.writable === false) {
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
