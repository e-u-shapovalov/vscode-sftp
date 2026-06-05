import * as vscode from 'vscode';
import { registerCommand } from '../../host';
import {
  COMMAND_REMOTEEXPLORER_REFRESH,
  COMMAND_REMOTEEXPLORER_REFRESH_ACTIVE_FILE,
  COMMAND_REMOTEEXPLORER_VIEW_CONTENT,
  COMMAND_REMOTEEXPLORER_COPY_PATH,
} from '../../constants';
import { UResource } from '../../core';
import { toRemotePath } from '../../helper';
import { REMOTE_SCHEME } from '../../constants';
import { getFileService } from '../serviceManager';
import RemoteTreeDataProvider, { ExplorerItem } from './treeDataProvider';

export default class RemoteExplorer {
  private _explorerView: vscode.TreeView<ExplorerItem>;
  private _treeDataProvider: RemoteTreeDataProvider;

  constructor(context: vscode.ExtensionContext) {
    this._treeDataProvider = new RemoteTreeDataProvider();
    context.subscriptions.push(
      vscode.workspace.registerTextDocumentContentProvider(REMOTE_SCHEME, this._treeDataProvider)
    );

    this._explorerView = vscode.window.createTreeView('remoteExplorer', {
      showCollapseAll: true,
      treeDataProvider: this._treeDataProvider,
      canSelectMany: true,
    });

    // Custom panel title. VS Code already prefixes the view-container title ("SFTP:"), so we omit
    // "SFTP" here to avoid "SFTP: SFTP …". TreeView.title postdates the pinned @types/vscode (1.40),
    // so it's set through a typed cast; it exists at runtime (VS Code >= 1.41).
    const ext = vscode.extensions.getExtension('EvgeniiShapovalov.sftp-link');
    const version = ext && ext.packageJSON ? ext.packageJSON.version : '';
    (this._explorerView as { title?: string }).title = `eushapovalov${version ? ': ' + version : ''}`;

    // The toolbar refresh button always does a full refresh of the whole tree, so newly
    // created/removed files on the server show up regardless of the current selection.
    registerCommand(context, COMMAND_REMOTEEXPLORER_REFRESH, () => this.refresh());
    registerCommand(context, COMMAND_REMOTEEXPLORER_REFRESH_ACTIVE_FILE, () => this._refreshActiveRemoteFile());
    registerCommand(context, COMMAND_REMOTEEXPLORER_VIEW_CONTENT, (item: ExplorerItem) =>
      this._treeDataProvider.showItem(item)
    );
    // Copy the remote (server-side) path of the selected file/folder to the clipboard.
    registerCommand(context, COMMAND_REMOTEEXPLORER_COPY_PATH, (item: ExplorerItem) => {
      vscode.env.clipboard.writeText(item.resource.fsPath);
    });
  }

  refresh(item?: ExplorerItem) {
    if (item && !UResource.isRemote(item.resource.uri)) {
      const uri = item.resource.uri;
      const fileService = getFileService(uri);
      if (!fileService) {
        if (uri.toString(true) == "file:///${command:sftp.sync.remoteToLocal}") {
          throw '';
        } else {
          throw new Error(`Config Not Found. (${uri.toString(true)})`);
        }
      }
      const config = fileService.getConfig();
      const localPath = item.resource.fsPath;
      const remotePath = toRemotePath(localPath, config.context, config.remotePath);
      item.resource = UResource.makeResource({
        remote: {
          host: config.host,
          port: config.port,
        },
        fsPath: remotePath,
        remoteId: fileService.id,
      });
    }

    return this._treeDataProvider.refresh(item);
  }

  reveal(
    item: ExplorerItem,
    options?: { select?: boolean, focus?: boolean, expand?: boolean | number }
  ): Thenable<void> {
    return item ? this._explorerView.reveal(item, options) : Promise.resolve();
  }

  // Make a freshly created remote file/folder visible and selected in the tree without a manual
  // refresh: re-list the parent (which fires the tree-data change) and then reveal/select the
  // new entry.
  async showCreated(remoteUri: vscode.Uri, isDirectory: boolean): Promise<void> {
    const item: ExplorerItem = {
      resource: UResource.makeResource(remoteUri),
      isDirectory,
    };

    let parent: ExplorerItem;
    try {
      parent = await this._treeDataProvider.getParent(item);
    } catch (e) {
      // Tree isn't initialized yet (no roots) — nothing to reveal into.
      return;
    }

    // Re-list the parent: this runs the readdir, lands the new entry in the provider's map,
    // and fires onDidChangeTreeData(parent). Returns the parent's children.
    let created: ExplorerItem | undefined;
    try {
      const children = (await this._treeDataProvider.refresh(parent)) as ExplorerItem[] | undefined;
      created = children && children.find(c => c.resource.uri.query === item.resource.uri.query);
    } catch (e) {
      // Couldn't re-list the parent; leave the tree as-is.
    }

    // Reveal + select the new entry so it is visible without any manual action.
    if (created) {
      try {
        await this.reveal(created, { select: true, focus: false, expand: true });
      } catch (e) {
        // reveal() can throw if VS Code hasn't registered the node yet; the refresh already showed it.
      }
    }
  }

  findRoot(remoteUri: vscode.Uri) {
    return this._treeDataProvider.findRoot(remoteUri);
  }

  private _refreshActiveRemoteFile() {
    const focusedEditor = vscode.window.activeTextEditor;
    if (focusedEditor) {

      const remoteFileUri = focusedEditor.document.uri;
      const root = this._treeDataProvider.findRoot(remoteFileUri);
      const incompleteResource = UResource.makeResource(remoteFileUri);

      if (!root) {
        return;
      }
      const remoteFileItem = {
        resource: UResource.updateResource(root.resource, {
          remotePath: incompleteResource.fsPath
        }),
        isDirectory: false
      };

      this.refresh(remoteFileItem);
    }

  }
}
