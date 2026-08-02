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
  COMMAND_REMOTEEXPLORER_OPEN_SYMLINK,
  COMMAND_REMOTEEXPLORER_EDITINLOCAL,
  COMMAND_REMOTEEXPLORER_SORT_BY_SIZE,
  COMMAND_REMOTEEXPLORER_SORT_BY_NAME,
  COMMAND_REMOTEEXPLORER_SHOW_SIZES,
  COMMAND_REMOTEEXPLORER_HIDE_SIZES,
  COMMAND_REMOTEEXPLORER_MEASURING_SIZES,
  COMMAND_OPEN_EXTENSION_PAGE,
  COMMAND_REMOTEEXPLORER_VIEW_AS_ROOT,
  COMMAND_REMOTEEXPLORER_RECHECK_MODIFIED,
  EXTENSION_NAME,
} from '../../constants';
import { UResource, upath, FileType, FileSystem } from '../../core';
import { toRemotePath } from '../../helper';
import { L } from '../../i18n';
import app from '../../app';
import { REMOTE_SCHEME } from '../../constants';
import { getFileService } from '../serviceManager';
import RemoteTreeDataProvider, { ExplorerItem, ExplorerRoot, TreeNode } from './treeDataProvider';
import RemoteDragAndDropController from './dragAndDrop';
import WriteDecorationProvider from './writeDecorationProvider';
import { execAsRoot, canElevate, ElevationCancelled, shQuote, SAFE_USER } from '../privilegedExec';
import { parseFindListing, FIND_PRINTF } from '../../helper/elevatedListing';
import { makeTmpFile } from '../../helper';
import * as fse from 'fs-extra';

// Is `target` the same as `rootPath` or nested inside it? Remote paths are POSIX, so we compare with
// upath (forward slashes) instead of the platform-specific `path`, which would break on Windows.
function isUnderRoot(rootPath: string, target: string): boolean {
  const root = upath.normalize(rootPath).replace(/\/+$/, '') || '/';
  const t = upath.normalize(target);
  if (root === '/') {
    return t.startsWith('/');
  }
  // A relative root (default "./" → ".") mirrors isRemoteSubpathOf: any target that doesn't climb out
  // (no leading "..") and isn't absolute is inside it. Without this branch a valid relative path like
  // "dir/file" reads as "outside the remote root" and Open-by-Path refuses every relative input.
  if (root === '.') {
    return t !== '..' && !t.startsWith('../') && !upath.isAbsolute(t);
  }
  return t === root || t.startsWith(root + '/');
}

export default class RemoteExplorer {
  private _explorerView: vscode.TreeView<TreeNode>;
  private _treeDataProvider: RemoteTreeDataProvider;

  constructor(context: vscode.ExtensionContext) {
    this._treeDataProvider = new RemoteTreeDataProvider();
    context.subscriptions.push(
      vscode.workspace.registerTextDocumentContentProvider(REMOTE_SCHEME, this._treeDataProvider)
    );

    // Dim files the current user can't write (advisory, like git's decorations). The provider reads the
    // per-node `writable` flag the tree computes and repaints on its change signal.
    const writeDecorations = new WriteDecorationProvider(this._treeDataProvider);
    context.subscriptions.push(
      writeDecorations,
      vscode.window.registerFileDecorationProvider(writeDecorations)
    );

    this._explorerView = vscode.window.createTreeView<TreeNode>('remoteExplorer', {
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
    // No item → full toolbar refresh; with an item (e.g. the notice row's "Retry") → re-list just that folder.
    registerCommand(context, COMMAND_REMOTEEXPLORER_REFRESH, (item?: ExplorerItem) => this.refresh(item));
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
    // Clicking a symlink in the tree: explain it and offer to open the real target (a symlink can't be
    // "downloaded" like a file — recreating an absolute link is refused with a cryptic error).
    registerCommand(context, COMMAND_REMOTEEXPLORER_OPEN_SYMLINK, (item: ExplorerItem) =>
      this.openSymlink(item)
    );
    // Toolbar sort toggle (two state-reflecting buttons swap via the `config.` when-clause).
    registerCommand(context, COMMAND_REMOTEEXPLORER_SORT_BY_SIZE, () => this._setSortBySize(true));
    registerCommand(context, COMMAND_REMOTEEXPLORER_SORT_BY_NAME, () => this._setSortBySize(false));
    // Toolbar show/hide-sizes toggle (independent of sort; two buttons swap via the `config.` when-clause).
    registerCommand(context, COMMAND_REMOTEEXPLORER_SHOW_SIZES, () => this._setShowSize(true));
    registerCommand(context, COMMAND_REMOTEEXPLORER_HIDE_SIZES, () => this._setShowSize(false));
    // The spinning "measuring…" toolbar button is a pure indicator while a background `du` runs — no-op.
    registerCommand(context, COMMAND_REMOTEEXPLORER_MEASURING_SIZES, () => undefined);
    // Server root context menu: open WireFerry's own extension page locally (details / features).
    registerCommand(context, COMMAND_OPEN_EXTENSION_PAGE, () =>
      executeCommand('extension.open', 'EvgeniiShapovalov.wireferry')
    );
    // Right-click a no-access (yellow) node → re-list a directory or read a file as its owner / root via su.
    registerCommand(context, COMMAND_REMOTEEXPLORER_VIEW_AS_ROOT, (item: ExplorerItem) =>
      this.viewAsRoot(item)
    );
    // Right-click a folder → force a recursive re-listing of the whole subtree (even folded parts the
    // toolbar refresh leaves cached) so the M badges are rebuilt from the current bytes on both sides.
    registerCommand(context, COMMAND_REMOTEEXPLORER_RECHECK_MODIFIED, (item: ExplorerItem) =>
      this.recheckModified(item)
    );
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
      // baseDir, not config.context: context is the raw user value (possibly undefined/relative).
      const remotePath = toRemotePath(localPath, fileService.baseDir, config.remotePath);
      // With profiles shown as roots, target the active profile's root so findRoot resolves it
      // (getConfig() above already used the active profile, so the host/path match it).
      const profile = fileService.getAvailableProfiles().length > 0 ? app.state.profile || undefined : undefined;
      item.resource = UResource.makeResource({
        remote: {
          host: config.host,
          port: config.port,
        },
        fsPath: remotePath,
        remoteId: fileService.id,
        profile,
      });
    }

    return this._treeDataProvider.refresh(item);
  }

  refreshItem(item: ExplorerItem): void {
    this._treeDataProvider.refreshItem(item);
  }

  // Re-list ONLY the folders that actually changed, given the remote paths an operation touched (deleted,
  // moved, uploaded). A full refresh() drops every cached listing and hands the view a rebuilt root level,
  // so every expanded branch is re-read from the server and the user loses their place — after deleting one
  // file three folders deep they have to find their way back down. Here each path invalidates just its own
  // folder, and each affected folder is re-listed once no matter how many entries in it changed.
  // Falls back to a full refresh if a path can't be mapped into the tree, so a deleted entry is never left
  // on screen; never throws — the operation itself already succeeded.
  async refreshParentsOf(uris: vscode.Uri[]): Promise<void> {
    const seen = new Set<string>();
    const items: ExplorerItem[] = [];
    let unmapped = false;
    for (const uri of uris) {
      let remoteUri: vscode.Uri | undefined;
      try {
        remoteUri = this._asRemoteUri(uri);
      } catch (e) {
        // getConfig() throws on an unknown profile or a config that fails validation. This method is
        // called from `finally` blocks and from VS Code's own rename handler, so it must never throw —
        // treat the path as unmappable and let the full refresh below (which tolerates a broken config)
        // sort the tree out.
        remoteUri = undefined;
      }
      if (!remoteUri) {
        // No config covers this path any more — we can't tell which folder to re-list, so re-read
        // everything rather than leave a stale entry on screen.
        unmapped = true;
        break;
      }
      const resource = UResource.makeResource(remoteUri);
      const key = resource.uri.query;
      if (seen.has(key)) {
        continue; // the same path listed twice (e.g. a move that only changed the local side)
      }
      seen.add(key);
      // isDirectory:false deliberately: the invalidation drops the whole subtree either way, and `false` is
      // what routes the change event to the PARENT — the folder that must be re-listed when an entry
      // appears or disappears. fileHandlers/remove passes the same fixed flag for the same reason.
      items.push({ resource, isDirectory: false });
    }
    // An unmappable path means the tree is re-read wholesale anyway, so don't pay for the targeted pass
    // first: it would re-list the mapped folders only for the full refresh to invalidate them again.
    let done = false;
    if (!unmapped) {
      try {
        done = await this._treeDataProvider.refreshParents(items);
      } catch (e) {
        done = false;
      }
    }
    if (!done) {
      await this._treeDataProvider.refresh().catch(() => undefined);
    }
  }

  // The remote uri the tree knows a path by. A remote uri passes straight through; a LOCAL one is mapped
  // through its config (host/port + mapped remote path + the active profile) exactly the way refresh()
  // maps one, so a caller can hand over whichever uri it happens to hold. Undefined when no config covers
  // the path — nothing in the tree corresponds to it.
  private _asRemoteUri(uri: vscode.Uri): vscode.Uri | undefined {
    if (UResource.isRemote(uri)) {
      return uri;
    }
    const fileService = getFileService(uri);
    if (!fileService) {
      return undefined;
    }
    const config = fileService.getConfig();
    // baseDir, not config.context: context is the raw user value (possibly undefined/relative).
    const remotePath = toRemotePath(uri.fsPath, fileService.baseDir, config.remotePath);
    // With profiles shown as roots, target the active profile's root so findRoot resolves it.
    const profile =
      fileService.getAvailableProfiles().length > 0 ? app.state.profile || undefined : undefined;
    return UResource.makeResource({
      remote: {
        host: config.host,
        port: config.port,
      },
      fsPath: remotePath,
      remoteId: fileService.id,
      profile,
    }).uri;
  }

  // Recompute + repaint the write-permission hint for one item after our own chmod/chown changed it.
  recomputeWriteHint(item: ExplorerItem): void {
    this._treeDataProvider.recomputeWriteHint(item).catch(() => undefined);
  }

  // After a RECURSIVE chmod: drop the cached write/read hints under this node, so a folded branch can't
  // keep drawing a read-only badge from permissions we have just replaced. Each folder's next merge
  // re-derives the real hint from the fresh mode/uid/gid.
  clearWriteHintsUnder(item: ExplorerItem): void {
    this._treeDataProvider.clearWriteHintsUnder(item);
  }

  // Right-click a folder → "Recheck Modified Files": force a recursive re-listing of the whole subtree,
  // even folded parts the toolbar refresh leaves cached, so the M badges reflect the current bytes on both
  // sides. Shows progress (folders walked) and is cancellable; content (MD5) checks for ambiguous files
  // then finish in the background, repainting each badge as its verdict lands.
  async recheckModified(item: ExplorerItem): Promise<void> {
    if (!item || !item.isDirectory) {
      return;
    }
    const name = upath.basename(item.resource.fsPath) || item.resource.fsPath;
    try {
      const result = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: L({
            en: `WireFerry: rechecking "${name}"…`,
            ru: `WireFerry: перечитываю «${name}»…`,
          }),
          cancellable: true,
        },
        async (progress, token) => {
          let lastReport = 0;
          const walked = await this._treeDataProvider.recheckSubtree(item, token, folders => {
            const now = Date.now();
            if (now - lastReport < 150) {
              return;
            }
            lastReport = now;
            progress.report({
              message: L({ en: `${folders} folders…`, ru: `папок: ${folders}…` }),
            });
          });
          return { ...walked, cancelled: token.isCancellationRequested };
        }
      );
      if (result.cancelled) {
        vscode.window.showInformationMessage(
          L({
            en: `Recheck of "${name}" cancelled after ${result.folders} folders.`,
            ru: `Перечитывание «${name}» отменено после ${result.folders} папок.`,
          })
        );
      } else {
        vscode.window.showInformationMessage(
          result.truncated
            ? L({
                en: `Rechecked ${result.folders} folders (stopped at the limit). Changed files show M; content checks may still be finishing in the background.`,
                ru: `Перечитано ${result.folders} папок (остановлено на лимите). Изменённые файлы помечены M; проверка содержимого может ещё идти в фоне.`,
              })
            : L({
                en: `Rechecked ${result.folders} folders. Changed files show M; content checks may still be finishing in the background.`,
                ru: `Перечитано ${result.folders} папок. Изменённые файлы помечены M; проверка содержимого может ещё идти в фоне.`,
              })
        );
      }
    } catch (e) {
      showErrorMessage((e && (e as Error).message) || String(e));
    }
  }

  // Toolbar toggle: persist the sort preference, then re-list so getChildren re-sorts (and, for size,
  // measures folders with one server-side `du`). getChildren reads the setting fresh, so a refresh is
  // all that's needed; the two view/title buttons swap automatically via their `config.` when-clause.
  private async _setSortBySize(value: boolean): Promise<void> {
    await vscode.workspace
      .getConfiguration('wireferry')
      .update('remoteExplorer.sortBySize', value, vscode.ConfigurationTarget.Global);
    // Light re-render: reuse cached folder sizes (only Refresh re-measures).
    this._treeDataProvider.rerender();
  }

  // Toolbar toggle: persist the "show sizes" preference, then re-list. The refresh both re-renders the
  // descriptions and (for folders) measures sizes with one server-side `du`. Independent of the sort
  // toggle; the two view/title buttons swap via their `config.` when-clause.
  private async _setShowSize(value: boolean): Promise<void> {
    await vscode.workspace
      .getConfiguration('wireferry')
      .update('remoteExplorer.showSize', value, vscode.ConfigurationTarget.Global);
    // Light re-render: reuse cached folder sizes (only Refresh re-measures).
    this._treeDataProvider.rerender();
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
        L({
          en: 'WireFerry: no remote is configured. Open a workspace with .vscode/wireferry.json first.',
          ru: 'WireFerry: не настроен ни один сервер. Сначала откройте проект с .vscode/wireferry.json.',
        })
      );
      return;
    }

    const input = await vscode.window.showInputBox({
      ignoreFocusOut: true,
      prompt: L({ en: 'Open a remote file by its full path', ru: 'Открыть файл на сервере по полному пути' }),
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
    // Set when an absolute path sits above every configured root: reading is allowed anywhere, so we
    // open it directly instead of refusing (it just can't be revealed in the tree).
    let outsideRoot = false;
    if (raw.startsWith('/')) {
      // Absolute server path — prefer the remote(s) whose root contains it.
      const abs = upath.normalize(raw);
      remotePath = abs;
      const matching = roots.filter(r => isUnderRoot(r.resource.fsPath, abs));
      if (matching.length > 0) {
        root = matching.length === 1 ? matching[0] : await this._pickRoot(matching);
      } else {
        // Above every configured root. Don't refuse — pick a remote for the connection and open the
        // path directly (Edit in Local warns where the local copy lands on disk).
        outsideRoot = true;
        root = roots.length === 1 ? roots[0] : await this._pickRoot(roots);
      }
    } else {
      // Relative path — resolve it against the chosen remote's root.
      root = roots.length === 1 ? roots[0] : await this._pickRoot(roots);
      if (root) {
        remotePath = upath.normalize(upath.join(root.resource.fsPath, raw));
        // Same containment rule as the absolute branch: '../..' must not escape the root.
        if (!isUnderRoot(root.resource.fsPath, remotePath)) {
          showWarningMessage(
            L({
              en: `WireFerry: "${raw}" resolves outside the remote root (${root.resource.fsPath}).`,
              ru: `WireFerry: «${raw}» выходит за пределы корня сервера (${root.resource.fsPath}).`,
            })
          );
          return;
        }
      }
    }
    if (!root || remotePath === undefined) {
      return; // profile pick cancelled
    }

    // Above the root: open directly — the tree can't reveal a node outside the root it's anchored to.
    if (outsideRoot) {
      await this._openOutsideRoot(root, remotePath);
      return;
    }

    let item: ExplorerItem | undefined;
    try {
      item = await this._resolveByPath(root, remotePath);
    } catch (error) {
      const detail = error && (error as Error).message ? (error as Error).message : String(error);
      showErrorMessage(
        L({
          en: `WireFerry: failed to reach "${remotePath}". ${detail}`,
          ru: `WireFerry: не удалось получить доступ к «${remotePath}». ${detail}`,
        })
      );
      return;
    }
    if (!item) {
      showWarningMessage(
        L({
          en: `WireFerry: "${remotePath}" was not found on the server.`,
          ru: `WireFerry: «${remotePath}» не найден на сервере.`,
        })
      );
      return;
    }

    await this.reveal(item, { select: true, focus: true, expand: true });

    // Directories are only revealed/expanded; a symlink gets the explain-and-open-target flow (Edit in
    // Local would refuse to recreate it); a plain file is downloaded and opened for editing.
    if ((item as ExplorerItem).isSymbolicLink) {
      await this.openSymlink(item);
    } else if (!item.isDirectory) {
      await executeCommand(COMMAND_REMOTEEXPLORER_EDITINLOCAL, item);
    }
  }

  // Open a file that sits ABOVE the configured remote root. The tree can't show it (it only lists paths
  // under the root), so skip reveal: stat the path through the picked remote's connection and, if it is
  // a regular file, hand a remote: URI to Edit in Local — which downloads it and warns where the local
  // copy lands. A directory can't be browsed here (nothing to reveal it into), so report that instead.
  private async _openOutsideRoot(root: ExplorerRoot, remotePath: string): Promise<void> {
    const { fileService, config, id, profile } = root.explorerContext;
    let stat;
    try {
      const remotefs = await fileService.getRemoteFileSystem(config);
      stat = await remotefs.lstat(remotePath);
    } catch (error) {
      const detail = error && (error as Error).message ? (error as Error).message : String(error);
      showErrorMessage(
        L({
          en: `WireFerry: failed to reach "${remotePath}". ${detail}`,
          ru: `WireFerry: не удалось получить доступ к «${remotePath}». ${detail}`,
        })
      );
      return;
    }
    if (stat.type === FileType.Directory) {
      showWarningMessage(
        L({
          en: `WireFerry: "${remotePath}" is a directory outside the configured root, so it can't be shown in the tree. Enter a file path to open it.`,
          ru: `WireFerry: «${remotePath}» — это папка вне настроенного корня, её нельзя показать в дереве. Укажите путь к файлу, чтобы открыть его.`,
        })
      );
      return;
    }
    const uri = UResource.makeResource({
      remote: { host: config.host, port: config.port },
      fsPath: remotePath,
      remoteId: id,
      profile,
    }).uri;
    await executeCommand(COMMAND_REMOTEEXPLORER_EDITINLOCAL, uri);
  }

  // Clicking a symlink in the tree used to run Edit in Local, which tries to RECREATE the link on disk
  // and refuses an absolute target ("unsafe target") — two cryptic red errors that never even hinted the
  // entry was a link. Instead: read the link, show where it points on the server, and let the user open
  // the REAL file's content or copy the target path to navigate there themselves.
  async openSymlink(item: ExplorerItem): Promise<void> {
    const root = this._treeDataProvider.findRoot(item.resource.uri);
    if (!root) {
      showErrorMessage(
        L({
          en: `WireFerry: can't find the remote for ${item.resource.uri.toString(true)}.`,
          ru: `WireFerry: не найден сервер для ${item.resource.uri.toString(true)}.`,
        })
      );
      return;
    }
    const { fileService, config } = root.explorerContext;
    const linkPath = item.resource.fsPath;
    const name = upath.basename(linkPath);

    let target: string;
    try {
      const remotefs = await fileService.getRemoteFileSystem(config);
      target = await this._readlinkResolved(remotefs, linkPath);
    } catch (error) {
      const detail = error && (error as Error).message ? (error as Error).message : String(error);
      showErrorMessage(
        L({
          en: `WireFerry: couldn't read the symlink "${name}". ${detail}`,
          ru: `WireFerry: не удалось прочитать символическую ссылку «${name}». ${detail}`,
        })
      );
      return;
    }

    const OPEN = L({ en: 'Open Target', ru: 'Открыть цель' });
    const COPY = L({ en: 'Copy Path', ru: 'Скопировать путь' });
    const choice = await vscode.window.showInformationMessage(
      L({ en: `"${name}" is a symbolic link`, ru: `«${name}» — символическая ссылка` }),
      {
        modal: true,
        detail: L({
          en: `On the server it points to:\n${target}\n\n“Open Target” downloads and opens the real file. “Copy Path” copies the target path so you can navigate to it.`,
          ru: `На сервере она указывает на:\n${target}\n\n«Открыть цель» скачает и откроет реальный файл. «Скопировать путь» скопирует путь цели, чтобы перейти к нему.`,
        }),
      },
      OPEN,
      COPY
    );

    if (choice === COPY) {
      await vscode.env.clipboard.writeText(target);
      return;
    }
    if (choice === OPEN) {
      await this._openSymlinkTarget(root, linkPath);
    }
  }

  // Read a symlink and return its target as an absolute server path: an absolute link target stands on
  // its own; a relative one is resolved against the link's own directory.
  private async _readlinkResolved(remotefs: FileSystem, linkPath: string): Promise<string> {
    const raw = await remotefs.readlink(linkPath);
    return raw.startsWith('/')
      ? upath.normalize(raw)
      : upath.normalize(upath.join(upath.dirname(linkPath), raw));
  }

  // Follow a symlink chain to the real file/dir it ultimately resolves to and open it: reveal + Edit in
  // Local for a file under the root, reveal/expand for a directory, or open-by-URI when it sits above the
  // root. Bounded so a cyclic link can't loop forever; reports a broken link or a too-deep chain.
  private async _openSymlinkTarget(root: ExplorerRoot, linkPath: string): Promise<void> {
    const { fileService, config } = root.explorerContext;
    const remotefs = await fileService.getRemoteFileSystem(config);

    let current = linkPath;
    let finalPath: string | undefined;
    let finalType: FileType | undefined;
    for (let hop = 0; hop < 10; hop++) {
      let resolved: string;
      try {
        resolved = await this._readlinkResolved(remotefs, current);
      } catch (error) {
        // Couldn't read the link (vanished, or no longer a link). Surface the real reason instead of
        // pretending the chain was too deep.
        const detail = error && (error as Error).message ? (error as Error).message : String(error);
        showWarningMessage(
          L({
            en: `WireFerry: couldn't read the symlink "${current}". ${detail}`,
            ru: `WireFerry: не удалось прочитать символическую ссылку «${current}». ${detail}`,
          })
        );
        return;
      }
      let stat;
      try {
        stat = await remotefs.lstat(resolved);
      } catch (error) {
        // A genuine "not found" means a broken link; anything else (permission, timeout) is reported
        // with its real cause rather than mislabelled as broken.
        const code = error && (error as any).code;
        const message = error && (error as Error).message;
        if (code === 2 || code === 'ENOENT' || message === 'file not exist') {
          showWarningMessage(
            L({
              en: `WireFerry: the symlink points to "${resolved}", which doesn't exist on the server (broken link).`,
              ru: `WireFerry: ссылка указывает на «${resolved}», которого нет на сервере (битая ссылка).`,
            })
          );
        } else {
          showWarningMessage(
            L({
              en: `WireFerry: couldn't reach the symlink target "${resolved}". ${message || error}`,
              ru: `WireFerry: не удалось получить доступ к цели ссылки «${resolved}». ${message || error}`,
            })
          );
        }
        return;
      }
      if (stat.type === FileType.SymbolicLink) {
        current = resolved;
        continue;
      }
      finalPath = resolved;
      finalType = stat.type;
      break;
    }

    if (finalPath === undefined || finalType === undefined) {
      // Fell out of the loop without a non-link target: the chain is longer than the hop budget or loops.
      showWarningMessage(
        L({
          en: `WireFerry: this symlink chain is too deep or cyclic — can't resolve a real file.`,
          ru: `WireFerry: цепочка ссылок слишком длинная или зациклена — не удалось найти реальный файл.`,
        })
      );
      return;
    }

    // Under the root: reveal the real entry in the tree (so the user lands on the actual path), then open
    // a file for editing. Above the root: open by URI directly — reading is allowed anywhere, the tree
    // just can't show a node outside its root. _openOutsideRoot handles both the file and directory case.
    if (isUnderRoot(root.resource.fsPath, finalPath)) {
      const node = await this._resolveByPath(root, finalPath).catch(() => undefined);
      if (node) {
        await this.reveal(node, { select: true, focus: true, expand: true });
        if (!node.isDirectory) {
          await executeCommand(COMMAND_REMOTEEXPLORER_EDITINLOCAL, node);
        }
        return;
      }
    }
    await this._openOutsideRoot(root, finalPath);
  }

  private async _pickRoot(roots: ExplorerRoot[]): Promise<ExplorerRoot | undefined> {
    const picks = roots.map(r => ({
      label: r.explorerContext.fileService.name || r.resource.fsPath,
      description: `${r.explorerContext.config.host} — ${r.resource.fsPath}`,
      root: r,
    }));
    const picked = await vscode.window.showQuickPick(picks, {
      placeHolder: L({ en: 'Select the remote this path belongs to', ru: 'Выберите сервер, которому принадлежит путь' }),
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
      const children = await this._treeDataProvider.getChildrenComplete(current);
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
    const resource = UResource.makeResource(remoteUri);

    let parent: ExplorerItem | undefined;
    try {
      parent = await this._treeDataProvider.getParent({ resource, isDirectory });
    } catch (e) {
      // Tree isn't initialized yet (no roots) — nothing to reveal into.
      return;
    }
    if (!parent) {
      return;
    }

    // Pin the type we just created BEFORE re-listing the parent. A re-list right after mkdir/create
    // can momentarily report the new entry with the wrong type (some servers return stale attrs on the
    // next readdir), which would paint a new folder as a file until a manual refresh. We created it, so
    // its type is authoritative — pinning makes the re-list reuse our typed node instead of the listing.
    const created = this._treeDataProvider.pinKnownType(resource, isDirectory);

    // Re-list the parent: lands the new entry in the tree and fires onDidChangeTreeData(parent).
    try {
      await this._treeDataProvider.refresh(parent);
    } catch (e) {
      // Couldn't re-list the parent; leave the tree as-is.
    }

    // Reveal + select the new entry so it is visible without any manual action. reveal() expands the
    // ancestors implicitly; we don't expand the new node itself (a brand-new folder is empty).
    if (created) {
      try {
        await this.reveal(created, { select: true, focus: false });
      } catch (e) {
        // reveal() can throw if VS Code hasn't registered the node yet; the refresh already showed it.
      }
    }
  }

  findRoot(remoteUri: vscode.Uri) {
    return this._treeDataProvider.findRoot(remoteUri);
  }

  // Snapshot the tree's cached Modified (M) leaf files for the "Upload Modified" toolbar button.
  collectModifiedUploadCandidates() {
    return this._treeDataProvider.collectModifiedUploadCandidates();
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

  // Right-click "View as root": re-list a no-access directory, or read a no-access file, via `su` as the
  // owner or root. Uses the elevation engine (privilegedExec) that already prompts for + caches the password.
  async viewAsRoot(item: ExplorerItem): Promise<void> {
    // Invoked only from the tree context menu; guard against a Command Palette call with no item.
    if (!item || !item.resource) {
      return;
    }
    const remotePath = item.resource.fsPath;
    // Root commands run under `su -`, whose CWD is root's home — a RELATIVE remote path (from a
    // `remotePath: "./"` config) would resolve against /root, not the login user's home, and a leading-dash
    // name could even be read by `find` as an action. Require an absolute path.
    if (!remotePath || remotePath[0] !== '/') {
      showWarningMessage(
        L({
          en: 'WireFerry: "View as root" needs an absolute server path. Set an absolute "remotePath" in the config.',
          ru: 'WireFerry: «Показать от root» требует абсолютного пути на сервере. Задайте абсолютный "remotePath" в конфиге.',
        })
      );
      return;
    }
    const owner = (item as { owner?: string }).owner;
    const root = this._treeDataProvider.findRoot(item.resource.uri);
    if (!root) {
      showErrorMessage(
        L({ en: `WireFerry: can't find the remote for this item.`, ru: `WireFerry: не найден сервер для этого элемента.` })
      );
      return;
    }
    const { fileService, config } = root.explorerContext;
    const host = config.host || '';
    let remotefs: FileSystem;
    try {
      remotefs = await fileService.getRemoteFileSystem(config);
    } catch (e) {
      const detail = e && (e as Error).message ? (e as Error).message : String(e);
      showErrorMessage(L({ en: `WireFerry: can't connect — ${detail}`, ru: `WireFerry: не удалось подключиться — ${detail}` }));
      return;
    }
    if (!canElevate(remotefs)) {
      showWarningMessage(
        L({
          en: 'Running as root needs an SSH connection with a shell (not available on FTP).',
          ru: 'Выполнение от root требует SSH-подключения с оболочкой (недоступно на FTP).',
        })
      );
      return;
    }
    const asUser = await this._pickElevationUser(owner);
    if (asUser === undefined) {
      return; // cancelled
    }
    try {
      if (item.isDirectory) {
        await this._listDirAsRoot(item, remotefs, host, asUser);
      } else {
        await this._openFileAsRoot(item.resource.fsPath, remotefs, host, asUser);
      }
    } catch (e) {
      if (e instanceof ElevationCancelled) {
        return; // user backed out of the password prompt
      }
      const detail = e && (e as Error).message ? (e as Error).message : String(e);
      showErrorMessage(
        L({ en: `WireFerry: couldn't run as ${asUser} — ${detail}`, ru: `WireFerry: не удалось выполнить от ${asUser} — ${detail}` })
      );
    }
  }

  // Choose which user to su to: the item's owner (least privilege) or root. Straight to root when the owner
  // is unknown or is root itself.
  private async _pickElevationUser(owner?: string): Promise<string | undefined> {
    if (!owner || owner === 'root' || !SAFE_USER.test(owner)) {
      return 'root';
    }
    const asOwner = L({ en: `As the owner (${owner})`, ru: `От владельца (${owner})` });
    const asRoot = L({ en: 'As root', ru: 'От root' });
    const pick = await vscode.window.showQuickPick([asOwner, asRoot], {
      placeHolder: L({ en: 'Run as which user?', ru: 'От какого пользователя выполнить?' }),
    });
    if (pick === undefined) {
      return undefined; // cancelled
    }
    return pick === asOwner ? owner : 'root';
  }

  // List a directory the login user can't read (via `su … find -printf`) and hand the parsed children to the
  // tree so they render in place of the yellow "no access" row.
  private async _listDirAsRoot(
    item: ExplorerItem,
    remotefs: FileSystem,
    host: string,
    asUser: string
  ): Promise<void> {
    const dir = item.resource.fsPath;
    // NO pipe — so `$?` is find's OWN exit, not a `| base64`'s (a piped base64 would mask a find failure
    // as a false "empty folder"). rawOutput=true — so the su sanitizer can't strip the password out of a
    // name/field. The NUL-delimited output is parsed as-is.
    const cmd = `find ${shQuote(dir)} -mindepth 1 -maxdepth 1 -printf ${shQuote(FIND_PRINTF)}`;
    // Capture the generation BEFORE the (slow) su fetch: if the user hits Refresh while it runs, the tree
    // bumps its generation and setElevatedListing drops this now-stale snapshot instead of resurrecting it.
    const gen = this._treeDataProvider.listGenerationFor(item);
    const { code, output } = await execAsRoot(remotefs, host, cmd, asUser, true);
    if (code !== 0) {
      showErrorMessage(
        L({
          en: `WireFerry: listing "${dir}" as ${asUser} failed (exit ${code}).`,
          ru: `WireFerry: листинг «${dir}» от ${asUser} не удался (код ${code}).`,
        })
      );
      return;
    }
    const entries = parseFindListing(output, dir, (d, n) => upath.join(d, n));
    this._treeDataProvider.setElevatedListing(item, entries, gen);
    await this.reveal(item, { expand: true });
  }

  // Read a file the login user can't read (via `su … head -c <cap>`) into a throwaway temp file opened for
  // viewing. Capped like the preview (10 MB) so a huge file can't blow up memory; the temp copy is removed
  // when its editor closes.
  private async _openFileAsRoot(
    remotePath: string,
    remotefs: FileSystem,
    host: string,
    asUser: string
  ): Promise<void> {
    const CAP = 10 * 1024 * 1024;
    // NO pipe — so `$?` is head's OWN exit (a `| base64` would hide a read failure as a false empty file).
    // rawOutput=true — so the sanitizer can't strip the password out of the content. Text is the case, like
    // the in-editor preview; a binary file may look garbled (documented, same as preview).
    const cmd = `head -c ${CAP} -- ${shQuote(remotePath)}`;
    const { code, output } = await execAsRoot(remotefs, host, cmd, asUser, true);
    if (code !== 0) {
      showErrorMessage(
        L({
          en: `WireFerry: reading "${remotePath}" as ${asUser} failed (exit ${code}).`,
          ru: `WireFerry: чтение «${remotePath}» от ${asUser} не удалось (код ${code}).`,
        })
      );
      return;
    }
    let tmpPath: string;
    try {
      tmpPath = await makeTmpFile({ prefix: `${EXTENSION_NAME}-root-`, postfix: upath.extname(remotePath) });
      await fse.writeFile(tmpPath, output);
      // Read-only copy: make it non-writable so an accidental edit + save can't be silently lost (this
      // throwaway is NOT written back to the server). Best-effort; VS Code then shows the file read-only.
      await fse.chmod(tmpPath, 0o444).catch(() => undefined);
    } catch (e) {
      showErrorMessage(
        L({
          en: `WireFerry: couldn't open "${remotePath}" — ${(e && (e as Error).message) || e}`,
          ru: `WireFerry: не удалось открыть «${remotePath}» — ${(e && (e as Error).message) || e}`,
        })
      );
      return;
    }
    // Restore write before removing: the copy is 0444, and while fs-extra clears the Windows read-only bit
    // itself, chmod-first makes the delete robust across platforms and avoids leaving a root-owned temp behind.
    const cleanup = () =>
      fse
        .chmod(tmpPath, 0o600)
        .catch(() => undefined)
        .then(() => fse.remove(tmpPath).catch(() => undefined));
    const sub = vscode.workspace.onDidCloseTextDocument(doc => {
      if (doc.uri.scheme === 'file' && doc.uri.fsPath === tmpPath) {
        sub.dispose();
        cleanup();
      }
    });
    try {
      await vscode.window.showTextDocument(vscode.Uri.file(tmpPath), { preview: true });
    } catch (e) {
      // The editor never opened → the close listener would never fire: dispose it and delete the temp now,
      // so neither the listener nor the root-owned copy leaks.
      sub.dispose();
      await cleanup();
      showErrorMessage(
        L({
          en: `WireFerry: couldn't open "${remotePath}" — ${(e && (e as Error).message) || e}`,
          ru: `WireFerry: не удалось открыть «${remotePath}» — ${(e && (e as Error).message) || e}`,
        })
      );
    }
  }
}
