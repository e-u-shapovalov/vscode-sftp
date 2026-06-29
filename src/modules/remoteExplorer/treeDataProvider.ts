import * as vscode from 'vscode';
import { showTextDocument, setContextValue } from '../../host';
import {
  upath,
  UResource,
  Resource,
  FileService,
  FileType,
  FileEntry,
  Ignore,
  ServiceConfig,
  FileSystem,
} from '../../core';
import {
  COMMAND_REMOTEEXPLORER_VIEW_CONTENT,
  COMMAND_REMOTEEXPLORER_EDITINLOCAL,
  COMMAND_REMOTEEXPLORER_OPEN_SYMLINK,
} from '../../constants';
import { getAllFileService } from '../serviceManager';
import { getExtensionSetting } from '../ext';
import { L } from '../../i18n';
import logger from '../../logger';
import { duSizes } from './folderSize';

type Id = number;

const previewDocumentPathPrefix = '/~ ';

const DEFAULT_FILES_EXCLUDE = ['.git', '.svn', '.hg', 'CVS', '.DS_Store'];
/**
 * covert the url path for a customed docuemnt title
 *
 *  There is no api to custom title.
 *  So we change url path for custom title.
 *  This is not break anything because we get fspth from uri.query.'
 */
function makePreivewUrl(uri: vscode.Uri) {
  // const query = querystring.parse(uri.query);
  // query.originPath = uri.path;
  // query.originQuery = uri.query;

  return uri.with({
    path: previewDocumentPathPrefix + upath.basename(uri.path),
    // query: querystring.stringify(query),
  });
}

interface ExplorerChild {
  resource: Resource;
  isDirectory: boolean;
  // A symbolic link (from the listing's lstat type). Rendered with a link icon and routed, on click,
  // to a handler that explains the link and offers to open its real target — instead of failing the
  // way "download the link" does on an absolute target.
  isSymbolicLink?: boolean;
  // Where the link points, resolved in the background with one readlink (like folder sizes). `undefined`
  // = not measured yet, a string = the resolved absolute target, `null` = readlink failed (broken /
  // no permission) so we stop retrying. Only meaningful when isSymbolicLink.
  linkTarget?: string | null;
  // Captured from the directory listing (the same readdir we already do — no extra request). Used to
  // build the hover tooltip. A snapshot from list time, like everything else in the tree.
  size?: number;
  mode?: number;
  mtime?: number;
  // Real folder size from a server-side `du`, populated only while sort-by-size is active (files use
  // `size` from the listing; a directory's listing size is the inode size, not its contents).
  folderBytes?: number;
}

export interface ExplorerRoot extends ExplorerChild {
  explorerContext: {
    fileService: FileService;
    config: ServiceConfig;
    id: Id;
    // The profile this root represents, when the config defines `profiles` and each is shown as its
    // own root. Undefined for a plain single-host config (one root, as before).
    profile?: string;
  };
}

export type ExplorerItem = ExplorerRoot | ExplorerChild;

// Identity of a tree root from a remote URI: a config's services share one numeric remoteId, so when
// a config is split into one root per profile we disambiguate by (remoteId, profile).
function rootKey(remoteId: Id, profile?: string): string {
  return `${remoteId}|${profile || ''}`;
}

function dirFirstSort(fileA: ExplorerItem, fileB: ExplorerItem) {
  if (fileA.isDirectory === fileB.isDirectory) {
    return fileA.resource.fsPath.localeCompare(fileB.resource.fsPath);
  }

  return fileA.isDirectory ? -1 : 1;
}

// Human-readable byte size, e.g. 9525 -> "9.3 KB", 500 -> "500 B". Whole bytes show no decimals;
// larger units show one decimal under 10 (9.3 MB) and none at/above (24 MB).
function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  const text = i === 0 ? String(value) : value.toFixed(value < 10 ? 1 : 0);
  return `${text} ${units[i]}`;
}

function formatMode(mode: number): string {
  // tslint:disable-next-line:no-bitwise
  const simpleMode = mode & 0o777;
  const octal = simpleMode.toString(8).padStart(3, '0');
  const symbols = [0o400, 0o200, 0o100, 0o040, 0o020, 0o010, 0o004, 0o002, 0o001]
    // tslint:disable-next-line:no-bitwise
    .map((bit, index) => (simpleMode & bit ? 'rwx'[index % 3] : '-'))
    .join('');
  return `${octal} (${symbols})`;
}

// Local "YYYY-MM-DD HH:mm" from a millisecond timestamp (FS already adjusts for any time offset).
function formatTime(ms: number): string {
  const d = new Date(ms);
  if (isNaN(d.getTime())) {
    return '';
  }
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(
    d.getMinutes()
  )}`;
}

// Hover tooltip: full server path, plus size (files only), permissions, and modified time when the
// listing carried them. All data comes from the listing already in memory — building this does no I/O.
function buildTooltip(item: ExplorerItem, isRoot: boolean): string {
  const lines = [item.resource.fsPath];
  // A symlink: name what it is and where it points (the link's own byte size is meaningless, so skip it).
  if (!isRoot && item.isSymbolicLink) {
    const label = L({ en: 'Symbolic link', ru: 'Символическая ссылка' });
    lines.push(item.linkTarget ? `${label} → ${item.linkTarget}` : label);
  } else if (!isRoot && !item.isDirectory && typeof item.size === 'number') {
    lines.push(`${L({ en: 'Size', ru: 'Размер' })}: ${formatBytes(item.size)}`);
  }
  if (!isRoot && typeof item.mode === 'number') {
    lines.push(`${L({ en: 'Permissions', ru: 'Права' })}: ${formatMode(item.mode)}`);
  }
  if (typeof item.mtime === 'number' && item.mtime > 0) {
    lines.push(`${L({ en: 'Modified', ru: 'Изменён' })}: ${formatTime(item.mtime)}`);
  }
  return lines.join('\n');
}

export default class RemoteTreeData
  implements vscode.TreeDataProvider<ExplorerItem>, vscode.TextDocumentContentProvider {
  private _roots: ExplorerRoot[] | null;
  private _rootsMap: Map<string, ExplorerRoot> | null;
  // Initialise eagerly: refresh() (after config save / profile switch) and getParent() (tree-selection
  // restore on window reload) run before the lazy _getRoots() first builds it, and both touch _map —
  // a bare declaration left it undefined and threw "Cannot read properties of undefined".
  private _map: Map<vscode.Uri['query'], ExplorerItem> = new Map();
  // Parent uri.query keys whose folder sizes a background `du` is currently measuring, to de-dupe.
  private _measuring = new Set<string>();
  // Parent uri.query keys whose symlink targets a background readlink pass is currently resolving.
  private _resolvingLinks = new Set<string>();

  private _onDidChangeFolder: vscode.EventEmitter<ExplorerItem | undefined> = new vscode.EventEmitter<
    ExplorerItem | undefined
  >();
  private _onDidChangeFile: vscode.EventEmitter<vscode.Uri> = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChangeTreeData: vscode.Event<ExplorerItem | undefined> = this._onDidChangeFolder.event;
  readonly onDidChange: vscode.Event<vscode.Uri> = this._onDidChangeFile.event;

  async refresh(item?: ExplorerItem): Promise<any> {
    // A refresh re-measures folder sizes AND re-reads symlink targets (an admin can repoint a link):
    // drop both cached results so they recompute on demand.
    this._map.forEach(node => {
      node.folderBytes = undefined;
      node.linkTarget = undefined;
    });
    // refresh root
    if (!item) {
      // clear cache
      this._roots = null;
      this._rootsMap = null;

      // fire(undefined) tells VS Code to refresh the whole tree (EventEmitter.fire
      // requires an argument since @types/vscode bumped past 1.40).
      this._onDidChangeFolder.fire(undefined);
      return;
    }

    if (item.isDirectory) {
      this._onDidChangeFolder.fire(item);

      // refresh top level files as well
      const children = await this.getChildren(item);
      children
        .filter(i => !i.isDirectory)
        .forEach(i => this._onDidChangeFile.fire(makePreivewUrl(i.resource.uri)));
      return children;
    } else {
      const parent = await this.getParent(item);
      if (parent) {
        this._onDidChangeFolder.fire(parent);
      }
      this._onDidChangeFile.fire(makePreivewUrl(item.resource.uri));
    }
  }

  refreshItem(item: ExplorerItem): void {
    this._onDidChangeFolder.fire(item);
  }

  // Light re-render of the whole tree that KEEPS cached folder sizes — only refresh() re-measures. Used
  // by the sort / show-size toggles so flipping them reuses known sizes instead of hitting the server;
  // getChildren still `du`s only the folders it doesn't have a size for yet.
  rerender(): void {
    this._onDidChangeFolder.fire(undefined);
  }

  getTreeItem(item: ExplorerItem): vscode.TreeItem {
    const isRoot = (item as ExplorerRoot).explorerContext !== undefined;
    const setting = getExtensionSetting();
    let customLabel: string | undefined;
    let description: string | undefined;
    if (isRoot) {
      const ctx = (item as ExplorerRoot).explorerContext;
      const host = ctx.config.host;
      // Label priority: profile name (when profiles are shown as roots) → the config `name` → the
      // host. Never the bare remote-path basename, which is rarely meaningful for a root.
      customLabel = ctx.profile || ctx.fileService.name || host;
      // Show the host dimmed on the right so you can tell which server each root points at — unless
      // the label already IS the host (no name, no profile), which would just duplicate it.
      if (host && host !== customLabel) {
        description = host;
      }
    } else {
      customLabel = upath.basename(item.resource.fsPath);
      if (item.isSymbolicLink) {
        // A symlink shows where it points (resolved in the background), not its own byte size. The
        // dimmed "→ target" is the at-a-glance cue that this entry is a link, not a plain file.
        description = item.linkTarget
          ? `→ ${item.linkTarget}`
          : L({ en: 'symbolic link', ru: 'символическая ссылка' });
      } else if (setting.showSizeInTree) {
        // Dim size in the description, controlled SOLELY by the "show sizes" toggle (independent of
        // sort): files use the size from the listing; folders use the `du` size measured for this
        // listing. No per-item requests here.
        if (!item.isDirectory && typeof item.size === 'number') {
          description = formatBytes(item.size);
        } else if (item.isDirectory && typeof item.folderBytes === 'number' && item.folderBytes >= 0) {
          description = formatBytes(item.folderBytes);
        }
      }
    }
    const isSymlink = !isRoot && !!(item as ExplorerChild).isSymbolicLink;
    return {
      label: customLabel,
      description,
      resourceUri: item.resource.uri,
      tooltip: buildTooltip(item, isRoot),
      // Override the file-icon-theme icon for a symlink with VS Code's built-in link glyph, so a link
      // is recognizable at a glance and never mistaken for a plain file.
      iconPath: isSymlink ? new vscode.ThemeIcon('file-symlink-file') : undefined,
      collapsibleState: item.isDirectory ? vscode.TreeItemCollapsibleState.Collapsed : undefined,
      // Encode the protocol into a root's contextValue (root.sftp / root.ftp / root.local) so menus
      // can offer SSH-only actions (e.g. Generate SSH Key) on SFTP roots only. Non-root items stay
      // exactly 'file' / 'folder' — a symlink keeps 'file' so the regular file menus (Copy Path,
      // Delete, …) still apply; its special handling is the click command below, not the menu.
      contextValue: isRoot
        ? `root.${(item as ExplorerRoot).explorerContext.config.protocol || 'sftp'}`
        : item.isDirectory
        ? 'folder'
        : 'file',
      command: item.isDirectory
        ? undefined
        : isSymlink
        ? {
            // A symlink can't be opened/downloaded like a file (recreating an absolute link is refused);
            // explain it and offer to open the real target instead — regardless of the open/preview mode.
            command: COMMAND_REMOTEEXPLORER_OPEN_SYMLINK,
            arguments: [item],
            title: 'Open Symlink Target',
          }
        : {
            command: getExtensionSetting().downloadWhenOpenInRemoteExplorer
              ? COMMAND_REMOTEEXPLORER_EDITINLOCAL
              : COMMAND_REMOTEEXPLORER_VIEW_CONTENT,
            arguments: [item],
            title: 'View Remote Resource',
          },
    };
  }

  async getChildren(item?: ExplorerItem): Promise<ExplorerItem[]> {
    if (!item) {
      return this._getRoots();
    }

    const root = this.findRoot(item.resource.uri);
    if (!root) {
      throw new Error(`Can't find config for remote resource ${item.resource.uri}.`);
    }
    const config = root.explorerContext.config;
    const remotefs = await root.explorerContext.fileService.getRemoteFileSystem(config);
    const fileEntries = await remotefs.list(item.resource.fsPath);

    const filesExcludeList: string[] =
      config.remoteExplorer && config.remoteExplorer.filesExclude
        ? config.remoteExplorer.filesExclude.concat(DEFAULT_FILES_EXCLUDE)
        : DEFAULT_FILES_EXCLUDE;

    const ignore = new Ignore(filesExcludeList);
    function filterFile(file: FileEntry) {
      const relativePath = upath.relative(config.remotePath, file.fspath);
      return !ignore.ignores(relativePath);
    }

    const filtered = fileEntries.filter(filterFile);

    // Folder sizes (ONE server-side `du` for the whole listing, no client recursion) are needed to SORT
    // folders by size and/or to DISPLAY their size — compute them when either toggle is on. Files never
    // need `du` (their byte size is already in the listing). SFTP+exec only; on FTP / minimal servers
    // duSizes returns an empty map (folders keep name order and show no size).
    const items: ExplorerItem[] = filtered.map(file => {
      const isDirectory = file.type === FileType.Directory;
      const isSymbolicLink = file.type === FileType.SymbolicLink;
      const newResource = UResource.updateResource(item.resource, {
        remotePath: file.fspath,
      });
      const mapItem = this._map.get(newResource.uri.query);
      if (mapItem) {
        // Keep the cached node's identity, pinned type, any cached folderBytes and resolved linkTarget;
        // refresh the rest.
        mapItem.size = file.size;
        mapItem.mode = file.mode;
        mapItem.mtime = file.mtime;
        mapItem.isSymbolicLink = isSymbolicLink;
        return mapItem;
      }
      const newItem = {
        resource: UResource.updateResource(item.resource, {
          remotePath: file.fspath,
        }),
        isDirectory,
        isSymbolicLink,
        size: file.size,
        mode: file.mode,
        mtime: file.mtime,
      };
      this._map.set(newItem.resource.uri.query, newItem);
      return newItem;
    });

    // Resolve each symlink's target in the background with ONE readlink apiece (cheap, unlike `du`), so
    // the tree paints immediately and the dimmed "→ target" fills in a moment later. Only links without
    // a cached target are read; refresh() clears the cache. De-duped per parent so concurrent expands
    // of the same folder don't pile up readlinks.
    const unresolvedLinks = items.filter(
      i => (i as ExplorerChild).isSymbolicLink && (i as ExplorerChild).linkTarget === undefined
    );
    if (unresolvedLinks.length > 0) {
      this._resolveSymlinkTargets(remotefs, unresolvedLinks, item).catch(() => undefined);
    }

    // Folder sizes (for display and/or sort) are measured with ONE server-side `du`, but NOT awaited
    // here: the tree shows folder names and file sizes immediately, while a background measurement fills
    // in folder sizes (and re-sorts) when it returns — so a slow `du` on a deep tree never blocks the
    // expand. Only folders without a cached size are (re)measured; refresh() clears the cache.
    const setting = getExtensionSetting();
    const sortBySize = setting.sortBySizeInTree;
    if (sortBySize || setting.showSizeInTree) {
      const unmeasured = items.filter(i => i.isDirectory && typeof i.folderBytes !== 'number');
      if (unmeasured.length > 0) {
        this._measureFolderSizes(remotefs, unmeasured, item).catch(() => undefined);
      }
    }

    if (!sortBySize) {
      return items.sort(dirFirstSort);
    }
    // Files and folders sort as SEPARATE groups (folders first, then files), each by size descending —
    // so the biggest folder tops the folders and the biggest file tops the files, never intermixed.
    const dirs = items.filter(i => i.isDirectory);
    const files = items.filter(i => !i.isDirectory);
    const folderBytesOf = (i: ExplorerItem) => (typeof i.folderBytes === 'number' ? i.folderBytes : -1);
    dirs.sort(
      (a, b) => folderBytesOf(b) - folderBytesOf(a) || a.resource.fsPath.localeCompare(b.resource.fsPath)
    );
    files.sort(
      (a, b) => (b.size || 0) - (a.size || 0) || a.resource.fsPath.localeCompare(b.resource.fsPath)
    );
    return dirs.concat(files);
  }

  // Measure the given folders with one background `du` (status-bar spinner), store each size (or -1 when
  // du can't size it, so it isn't retried forever), then re-render the parent so the tree updates without
  // blocking the expand. De-duped per parent. getChildren only passes folders without a cached size, and
  // the re-render finds them measured — so this never loops.
  private async _measureFolderSizes(
    remotefs: FileSystem,
    folders: ExplorerItem[],
    parent: ExplorerItem
  ): Promise<void> {
    const key = parent.resource.uri.query;
    if (this._measuring.has(key)) {
      return;
    }
    this._measuring.add(key);
    // Show progress two ways while the server-side `du` runs: spin the toolbar size button (the
    // `measuringSizes` context key swaps the eye for a spinner — right where the action is) AND a
    // status-bar line with the descriptive text of what's happening.
    setContextValue('measuringSizes', true);
    try {
      const sizes = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Window,
          title: L({
            en: 'WireFerry: requesting folder sizes from your server — this takes a moment, please wait…',
            ru: 'WireFerry: запрашиваю размеры папок на вашем сервере — это занимает время, подождите…',
          }),
        },
        () => duSizes(remotefs, folders.map(f => f.resource.fsPath))
      );
      let changed = false;
      for (const folder of folders) {
        const bytes = sizes.has(folder.resource.fsPath)
          ? (sizes.get(folder.resource.fsPath) as number)
          : -1;
        if (folder.folderBytes !== bytes) {
          folder.folderBytes = bytes;
          changed = true;
        }
      }
      if (changed) {
        this._onDidChangeFolder.fire(parent);
      }
    } finally {
      this._measuring.delete(key);
      if (this._measuring.size === 0) {
        setContextValue('measuringSizes', false);
      }
    }
  }

  // Resolve the given symlinks' targets with one readlink each (run in parallel — readlink is a single
  // cheap round-trip, nothing like the recursive `du`), store the absolute target on each node, then
  // re-render the parent once so the dimmed "→ target" appears. A readlink failure records `null` so the
  // link isn't re-read forever. De-duped per parent; never blocks the expand (called fire-and-forget).
  private async _resolveSymlinkTargets(
    remotefs: FileSystem,
    links: ExplorerItem[],
    parent: ExplorerItem
  ): Promise<void> {
    const key = parent.resource.uri.query;
    if (this._resolvingLinks.has(key)) {
      return;
    }
    this._resolvingLinks.add(key);
    try {
      let changed = false;
      await Promise.all(
        links.map(async link => {
          let resolved: string | null;
          try {
            const raw = await remotefs.readlink(link.resource.fsPath);
            // An absolute link target stands on its own; a relative one resolves against the link's dir.
            resolved = raw.startsWith('/')
              ? upath.normalize(raw)
              : upath.normalize(upath.join(upath.dirname(link.resource.fsPath), raw));
          } catch {
            resolved = null;
          }
          if (link.linkTarget !== resolved) {
            link.linkTarget = resolved;
            changed = true;
          }
        })
      );
      if (changed) {
        this._onDidChangeFolder.fire(parent);
      }
    } finally {
      this._resolvingLinks.delete(key);
    }
  }

  // Pin the type of a just-created node. Some servers (notably minimal embedded SFTP, e.g. on IoT /
  // GSM gateways) return a freshly created entry with stale attrs on the very next readdir, so a
  // re-list right after mkdir/create momentarily reports a new folder as a file — it only self-heals
  // on a later refresh. The caller created the entry, so its type is authoritative: seed (or correct)
  // the cached node here. getChildren reuses cached nodes (`if (mapItem) return mapItem`), so the racy
  // listing can no longer flip the type back. Returns the cached node so it can be revealed.
  pinKnownType(resource: Resource, isDirectory: boolean): ExplorerItem | undefined {
    if (!this._map) {
      return undefined;
    }
    const existing = this._map.get(resource.uri.query);
    if (existing) {
      existing.isDirectory = isDirectory;
      return existing;
    }
    const node: ExplorerChild = { resource, isDirectory };
    this._map.set(resource.uri.query, node);
    return node;
  }

  async getParent(item: ExplorerChild): Promise<ExplorerItem> {
    const resourceUri = item.resource.uri;
    const root = this.findRoot(resourceUri);
    if (!root) {
      throw new Error(`Can't find config for remote resource ${resourceUri}.`);
    }

    if (item.resource.fsPath === root.resource.fsPath) {
      return root;
    }

    const fspath = upath.dirname(item.resource.fsPath);
    const newResource = UResource.updateResource(item.resource, {
      remotePath: fspath,
    });
    const mapItem = this._map.get(newResource.uri.query);
    if (mapItem) {
      return mapItem;
    } else {
      const newMapItem = {
        resource: newResource,
        isDirectory: true,
      };
      this._map.set(newResource.uri.query, newMapItem);
      await this.getChildren(newMapItem);
      return newMapItem;
    }
  }

  getRoots(): ExplorerRoot[] {
    return this._getRoots();
  }

  findRoot(uri: vscode.Uri): ExplorerRoot | null | undefined {
    if (!this._rootsMap) {
      return null;
    }

    const resource = UResource.makeResource(uri);
    return this._rootsMap.get(rootKey(resource.remoteId, resource.profile));
  }

  async provideTextDocumentContent(
    uri: vscode.Uri,
    token: vscode.CancellationToken
  ): Promise<string> {
    const root = this.findRoot(uri);
    if (!root) {
      throw new Error(`Can't find remote for resource ${uri}.`);
    }

    const config = root.explorerContext.config;
    const remotePath = UResource.makeResource(uri).fsPath;
    // Reading is deliberately allowed anywhere on the server: a preview only streams the file into an
    // in-memory document (no local write), and over an authenticated SSH/SFTP session the user can
    // already read anything their account can — so confining preview to remotePath added friction
    // without real protection. The write side (Edit in Local / download) keeps its guard and warns
    // when a file lands outside the scope.
    const remotefs = await root.explorerContext.fileService.getRemoteFileSystem(config);

    // Previewing reads the whole file into memory and renders it as text — a big or binary blob
    // (e.g. a 200 MB log) freezes the editor, the same hazard smartOpen guards on download. Cap it
    // and point the user at "Edit in Local" (which downloads and asks before opening).
    const PREVIEW_LIMIT = 10 * 1024 * 1024;
    let stat;
    try {
      stat = await remotefs.lstat(remotePath);
    } catch (e) {
      // Can't determine the size — refuse rather than stream an unknown amount into memory. A broken
      // or hostile server could otherwise fail lstat and then return an unbounded body, OOM-ing the
      // extension host on a single click. (readFile below also enforces a hard byte cap as a backstop.)
      throw new Error(
        L({
          en: 'Cannot determine the file size to preview safely. Use "Edit in Local" to download it instead.',
          ru: 'Не удалось определить размер файла для безопасного предпросмотра. Используйте «Edit in Local», чтобы скачать его.',
        })
      );
    }
    // Only a regular file previews as text. A directory (or other non-file) reaching here — e.g. via a
    // crafted preview URI — would otherwise be read and rendered as garbage; refuse with a clear message.
    if (stat.type !== FileType.File) {
      throw new Error(
        L({
          en: 'This is not a regular file, so it cannot be previewed as text.',
          ru: 'Это не обычный файл — его нельзя показать как текст.',
        })
      );
    }
    const size = stat.size;
    if (size > PREVIEW_LIMIT) {
      const mb = (size / (1024 * 1024)).toFixed(1);
      throw new Error(
        L({
          en: `File is too large to preview (${mb} MB). Use "Edit in Local" to download it instead.`,
          ru: `Файл слишком большой для предпросмотра (${mb} МБ). Используйте «Edit in Local», чтобы скачать его.`,
        })
      );
    }

    // Hard cap on bytes actually read: lstat's size can lie (or the file can grow), so bound readFile
    // too — it aborts the stream once maxBytes is exceeded instead of buffering without limit.
    const buffer = await remotefs.readFile(remotePath, { maxBytes: PREVIEW_LIMIT });
    return buffer.toString();
  }

  showItem(item: ExplorerItem): void {
    if (item.isDirectory) {
      return;
    }

    showTextDocument(makePreivewUrl(item.resource.uri));
  }

  private _getRoots(): ExplorerRoot[] {
    if (this._roots) {
      return this._roots;
    }

    this._roots = [];
    this._rootsMap = new Map();
    this._map = new Map();
    const profilesAsRoots = getExtensionSetting().profilesAsRoots;
    getAllFileService().forEach(fileService => {
      const profiles = fileService.getAvailableProfiles();
      if (profilesAsRoots && profiles.length > 0) {
        // One root per profile: each browsable on its own host without Set Profile. getConfig(name)
        // is explicit, so this works even when no profile is globally active. A single bad profile
        // (e.g. failed validation) is skipped rather than allowed to break the whole tree.
        profiles.forEach(profile => {
          try {
            this._addRoot(fileService, fileService.getConfig(profile), profile);
          } catch (e) {
            logger.warn(`remoteExplorer: skip profile root "${profile}": ${(e && (e as Error).message) || e}`);
          }
        });
      } else {
        // Plain config (or profiles-as-roots disabled): a single root for the active/only config.
        try {
          this._addRoot(fileService, fileService.getConfig(), undefined);
        } catch (e) {
          logger.warn(`remoteExplorer: skip root: ${(e && (e as Error).message) || e}`);
        }
      }
    });
    this._roots.sort(
      (a, b) =>
        a.explorerContext.config.remoteExplorer.order - b.explorerContext.config.remoteExplorer.order ||
        (a.explorerContext.fileService.name || '').localeCompare(b.explorerContext.fileService.name || '') ||
        (a.explorerContext.profile || '').localeCompare(b.explorerContext.profile || '')
    );
    return this._roots;
  }

  // Build one tree root for a (fileService, resolved config, optional profile) and register it in the
  // lookup maps. Each root carries its own config so getChildren/operations target the right host.
  private _addRoot(fileService: FileService, config: ServiceConfig, profile?: string): void {
    const id = fileService.id;
    const item: ExplorerRoot = {
      resource: UResource.makeResource({
        remote: {
          host: config.host,
          port: config.port,
        },
        fsPath: config.remotePath,
        remoteId: id,
        profile,
      }),
      isDirectory: true,
      explorerContext: {
        fileService,
        config,
        id,
        profile,
      },
    };
    this._roots!.push(item);
    this._rootsMap!.set(rootKey(id, profile), item);
    this._map.set(item.resource.uri.query, item);
  }
}
