import * as vscode from 'vscode';
import {
  registerCommand,
  executeCommand,
  showWarningMessage,
  showErrorMessage,
} from '../../host';
import {
  COMMAND_REMOTEEXPLORER_REFRESH,
  COMMAND_REMOTEEXPLORER_REFRESH_ACTIVE_FILE,
  COMMAND_REMOTEEXPLORER_VIEW_CONTENT,
  COMMAND_REMOTEEXPLORER_COPY_PATH,
  COMMAND_REMOTEEXPLORER_OPEN_BY_PATH,
  COMMAND_REMOTEEXPLORER_EDITINLOCAL,
} from '../../constants';
import { UResource, upath } from '../../core';
import { toRemotePath } from '../../helper';
import { REMOTE_SCHEME } from '../../constants';
import { getFileService } from '../serviceManager';
import RemoteTreeDataProvider, { ExplorerItem, ExplorerRoot } from './treeDataProvider';
import RemoteDragAndDropController from './dragAndDrop';

// Is `target` the same as `rootPath` or nested inside it? Remote paths are POSIX, so we compare with
// upath (forward slashes) instead of the platform-specific `path`, which would break on Windows.
function isUnderRoot(rootPath: string, target: string): boolean {
  const root = upath.normalize(rootPath).replace(/\/+$/, '') || '/';
  const t = upath.normalize(target);
  if (root === '/') {
    return t.startsWith('/');
  }
  return t === root || t.startsWith(root + '/');
}

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
      dragAndDropController: new RemoteDragAndDropController(this._treeDataProvider),
    });

    // Custom panel title — just the extension version. VS Code already prefixes the view-container
    // title ("WireFerry"), so we don't repeat it here. TreeView.title postdates the pinned
    // @types/vscode (1.40), so it's set through a typed cast; it exists at runtime (VS Code >= 1.41).
    const ext = vscode.extensions.getExtension('EvgeniiShapovalov.wireferry');
    const version = ext && ext.packageJSON ? ext.packageJSON.version : '';
    (this._explorerView as { title?: string }).title = version || undefined;

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
    // Toolbar "Open Remote File by Path": type a full server path, the tree expands down to it and
    // the file is downloaded + opened for editing.
    registerCommand(context, COMMAND_REMOTEEXPLORER_OPEN_BY_PATH, () => this.openByPath());
  }

  refresh(item?: ExplorerItem) {
    if (item && !UResource.isRemote(item.resource.uri)) {
      const uri = item.resource.uri;
      const fileService = getFileService(uri);
      if (!fileService) {
        throw new Error(`Config Not Found. (${uri.toString(true)})`);
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

  // "Open Remote File by Path" toolbar action. Prompts for a server path, figures out which
  // configured remote it belongs to, expands the tree down to it, then downloads + opens it.
  async openByPath(): Promise<void> {
    const roots = this._treeDataProvider.getRoots();
    if (roots.length === 0) {
      showWarningMessage(
        'WireFerry: no remote is configured. Open a workspace with .vscode/wireferry.json first.'
      );
      return;
    }

    const input = await vscode.window.showInputBox({
      ignoreFocusOut: true,
      prompt: 'Open a remote file by its full path',
      placeHolder: 'e.g. /etc/acpi/handler.sh',
    });
    if (input === undefined) {
      return; // dismissed
    }
    const raw = input.trim();
    if (!raw) {
      return;
    }

    let root: ExplorerRoot | undefined;
    let remotePath: string | undefined;
    if (raw.startsWith('/')) {
      // Absolute server path — pick the remote(s) whose root contains it.
      const abs = upath.normalize(raw);
      remotePath = abs;
      const matching = roots.filter(r => isUnderRoot(r.resource.fsPath, abs));
      if (matching.length === 0) {
        showWarningMessage(
          `WireFerry:"${abs}" is outside every configured remote root ` +
            `(${roots.map(r => r.resource.fsPath).join(', ')}).`
        );
        return;
      }
      root = matching.length === 1 ? matching[0] : await this._pickRoot(matching);
    } else {
      // Relative path — resolve it against the chosen remote's root.
      root = roots.length === 1 ? roots[0] : await this._pickRoot(roots);
      if (root) {
        remotePath = upath.normalize(upath.join(root.resource.fsPath, raw));
      }
    }
    if (!root || remotePath === undefined) {
      return; // profile pick cancelled
    }

    let item: ExplorerItem | undefined;
    try {
      item = await this._resolveByPath(root, remotePath);
    } catch (error) {
      const detail = error && (error as Error).message ? (error as Error).message : String(error);
      showErrorMessage(`WireFerry:failed to reach "${remotePath}". ${detail}`);
      return;
    }
    if (!item) {
      showWarningMessage(`WireFerry:"${remotePath}" was not found on the server.`);
      return;
    }

    await this.reveal(item, { select: true, focus: true, expand: true });

    // Directories are only revealed/expanded; files are downloaded and opened for editing.
    if (!item.isDirectory) {
      await executeCommand(COMMAND_REMOTEEXPLORER_EDITINLOCAL, item);
    }
  }

  private async _pickRoot(roots: ExplorerRoot[]): Promise<ExplorerRoot | undefined> {
    const picks = roots.map(r => ({
      label: r.explorerContext.fileService.name || r.resource.fsPath,
      description: `${r.explorerContext.config.host} — ${r.resource.fsPath}`,
      root: r,
    }));
    const picked = await vscode.window.showQuickPick(picks, {
      placeHolder: 'Select the remote this path belongs to',
    });
    return picked ? picked.root : undefined;
  }

  // Walk the tree from the remote root down to `remotePath`, listing each directory along the way so
  // the returned item is the real, cached node the tree view can reveal. Returns undefined if any
  // segment is missing (or hidden by remoteExplorer.filesExclude).
  private async _resolveByPath(
    root: ExplorerRoot,
    remotePath: string
  ): Promise<ExplorerItem | undefined> {
    const relative = upath.relative(root.resource.fsPath, remotePath);
    if (!relative || relative === '.') {
      return root;
    }
    const segments = relative.split('/').filter(segment => segment.length > 0);
    let current: ExplorerItem = root;
    for (const segment of segments) {
      if (!current.isDirectory) {
        return undefined; // a path component points at a file — can't descend further
      }
      const children = await this._treeDataProvider.getChildren(current);
      const next = children.find(child => upath.basename(child.resource.fsPath) === segment);
      if (!next) {
        return undefined;
      }
      current = next;
    }
    return current;
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
