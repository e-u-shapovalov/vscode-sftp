import * as vscode from 'vscode';
import * as querystring from 'querystring';
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
  Scheduler,
} from '../../core';
import {
  COMMAND_REMOTEEXPLORER_VIEW_CONTENT,
  COMMAND_REMOTEEXPLORER_EDITINLOCAL,
  COMMAND_REMOTEEXPLORER_OPEN_SYMLINK,
  COMMAND_REMOTEEXPLORER_VIEW_AS_ROOT,
  COMMAND_REMOTEEXPLORER_REFRESH,
} from '../../constants';
import { getAllFileService } from '../serviceManager';
import { getExtensionSetting } from '../ext';
import { L } from '../../i18n';
import logger from '../../logger';
import app from '../../app';
import { duSizes } from './folderSize';
import { toLocalPath } from '../../helper';
import { canUserWrite, canUserRead, relationTo, OwnershipRelation, UserIdentity } from '../../helper/identity';
import { localFileMd5, serverFileMd5 } from '../../helper/fileFacts';
import { suppressAutoUploadForMtime } from '../fileWatcherSuppression';
import {
  alignLocalMtimeIfUnchanged,
  ancestorPaths,
  contextValueFor,
  ContentVerification,
  decideStatus,
  NodeStatus,
  NodeStatusValue,
} from './treeStatus';

export { NodeStatus } from './treeStatus';

type Id = number;

// A directory listing failed because the path isn't there (a local-only directory has no server path, or the
// entry vanished) — as opposed to a permission/transient error. Mirrors the SFTP/FTP "absent" codes/text.
function isNotFoundListing(err: any): boolean {
  if (!err) {
    return false;
  }
  const code = (err as any).code;
  const msg = ((err as any).message || '').toString().toLowerCase();
  return (
    code === 2 ||
    code === 'ENOENT' ||
    msg.includes('no such file') ||
    msg.includes('file not exist') ||
    msg.includes('not found')
  );
}

// A directory listing (or read) was rejected for lack of permission — as opposed to "not found" or a
// transient error. This is actionable: the user can retry the listing/read as the owner or root via `su`.
function isPermissionDeniedListing(err: any): boolean {
  if (!err) {
    return false;
  }
  const code = (err as any).code;
  const msg = ((err as any).message || '').toString().toLowerCase();
  // SFTP codes only (3 = SSH_FX_PERMISSION_DENIED). FTP 550/553 are deliberately excluded: 550 is
  // ambiguous ("not taken" — could be not-found), and "View as root" needs an SSH shell anyway, so a
  // yellow "right-click View as root" hint on an FTP node would just mislead.
  return (
    code === 3 ||
    code === 'EACCES' ||
    code === 'EPERM' ||
    msg.includes('permission denied') ||
    msg.includes('no access')
  );
}

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
  // Owner/group of the entry. Names come free from the listing's `longname` (OpenSSH); the numeric
  // ids are the fallback for servers that don't send names. Shown in the hover tooltip.
  owner?: string;
  group?: string;
  uid?: number;
  gid?: number;
  // Advisory write access for the CURRENT user: false = they almost certainly can't edit this file
  // (drives the dimmed decoration in the tree). undefined = unknown (FTP, or identity not fetched).
  // Computed for files only — a directory's writability (create/delete inside) needs w+x semantics
  // we don't model here. `accessNote` is the human-readable reason shown in the tooltip.
  writable?: boolean;
  // Advisory READ access for the current user: false = they can't read the content (drives the 🔒 badge
  // and the "View as root" hint), even though the name is visible in the parent listing. undefined =
  // unknown (FTP / identity not fetched / root). Computed for files only, alongside `writable`.
  readable?: boolean;
  accessNote?: string;
  // Real folder size from a server-side `du`, populated only while sort-by-size is active (files use
  // `size` from the listing; a directory's listing size is the inode size, not its contents).
  folderBytes?: number;
  // Combined local↔remote status (see NodeStatus), computed during getChildren's merge. Undefined on roots.
  status?: NodeStatusValue;
  // True when a loaded descendant has a confirmed M. Kept separate from `status`: a folder can retain its
  // own stronger state (!, ?, L, denied) while still propagating ordinary M up the rest of the path.
  hasModifiedDescendant?: boolean;
  // The on-disk path of the local twin when one exists (a mapped local counterpart). Drives "click opens
  // the local file" and marks the node as present locally. Undefined = no local twin.
  localPath?: string;
  // The local twin's byte size (files only) — used for the "remote ↔ local" size hint and the local-only
  // size. Undefined when there is no local file twin.
  localSize?: number;
  // Local mtime captured by the same directory listing as localSize. It invalidates a cached MD5 result
  // when the file changes and is also the precondition for safely aligning a matching file's timestamp.
  localMtime?: number;
  // Cached verdict for the exact local/server metadata snapshot encoded in `key`. `unavailable` retains
  // the legacy mtime fallback without retrying three server hash commands on every repaint.
  contentVerification?: ContentVerification;
  // The snapshot currently waiting for MD5 (or represented by contentVerification). Kept explicitly so
  // a slow queued task can prove that it still belongs to this incarnation of the cached node.
  contentVerificationKey?: string;
  // True for exactly one listing after pinKnownType seeded/corrected the type of a just-created node, so
  // the next merge trusts the pin over a possibly-stale server listing, then reverts to listing authority.
  typePinned?: boolean;
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

// A synthetic, non-file row shown INSIDE a directory whose server listing failed, so the locally-known
// entries can't masquerade as the whole directory. Carries the parent folder it belongs to and whether the
// remedy is elevation (SFTP permission denied → View as root) or a plain retry (FTP / network error).
export interface NoticeItem {
  readonly kind: 'notice';
  readonly remedy: 'root' | 'retry';
  readonly parent: ExplorerItem;
}

// What getChildren/getTreeItem/getParent hand to VS Code: a real tree node or a synthetic notice row.
export type TreeNode = ExplorerItem | NoticeItem;

export function isNoticeItem(n: TreeNode): n is NoticeItem {
  return (n as NoticeItem).kind === 'notice';
}

// A cached Modified (M) leaf file, snapshotted as an upload target for the "Upload Modified" toolbar
// button. Host/profile come from the tree root the node belongs to (a child never carries them itself).
export interface ModifiedUploadCandidate {
  /** Absolute local path to upload FROM (always present — an M file requires a local twin). */
  localPath: string;
  /** Absolute remote POSIX path (the upload target). */
  remotePath: string;
  /** Remote tree URI — carries remoteId + profile so uploadFile resolves the right root/config. */
  remoteUri: vscode.Uri;
  /** false ⇒ RO ⇒ needs root; undefined ⇒ unknown (FTP / no identity) ⇒ normal upload. */
  writable?: boolean;
  mode?: number;
  owner?: string;
  group?: string;
  host?: string;
  profile?: string;
}

interface ContentCheckCandidate {
  item: ExplorerItem;
  key: string;
  remotePath: string;
  remoteSize: number;
  remoteMtime: number;
  localPath: string;
  localSize: number;
  localMtime: number;
}

// Identity of a tree root from a remote URI: a config's services share one numeric remoteId, so when
// a config is split into one root per profile we disambiguate by (remoteId, profile).
function rootKey(remoteId: Id, profile?: string): string {
  return `${remoteId}|${profile || ''}`;
}

// One collator for the module. `localeCompare()` with no arguments is specified as equivalent to
// `new Intl.Collator().compare()`, so the visible order does not shift by a single entry — we just
// stop paying for the wrapper on every comparison. Plain `<`/`>` would be faster still, but it sorts
// by code point: every Cyrillic name would drop below every Latin one.
const nameCollator = new Intl.Collator();

// Children of one directory share their whole path up to the last slash, so comparing the basename
// yields the same order for a fraction of the work. The key is computed once per entry rather than
// on every comparison — a sort does O(n log n) comparisons but has only n entries.
function sortSiblings(items: ExplorerItem[]): ExplorerItem[] {
  const decorated = items.map(item => {
    const p = item.resource.fsPath;
    return { item, name: p.slice(p.lastIndexOf('/') + 1) };
  });
  decorated.sort((a, b) => {
    if (a.item.isDirectory === b.item.isDirectory) {
      return nameCollator.compare(a.name, b.name);
    }
    return a.item.isDirectory ? -1 : 1;
  });
  return decorated.map(d => d.item);
}

// Constant tables, hoisted out of the formatters below: both run for every visible row on every
// repaint, and there is no reason to rebuild the same arrays each time.
const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
const MODE_BITS = [0o400, 0o200, 0o100, 0o040, 0o020, 0o010, 0o004, 0o002, 0o001];

// Human-readable byte size, e.g. 9525 -> "9.3 KB", 500 -> "500 B". Whole bytes show no decimals;
// larger units show one decimal under 10 (9.3 MB) and none at/above (24 MB).
function formatBytes(bytes: number): string {
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < BYTE_UNITS.length - 1) {
    value /= 1024;
    i += 1;
  }
  const text = i === 0 ? String(value) : value.toFixed(value < 10 ? 1 : 0);
  return `${text} ${BYTE_UNITS[i]}`;
}

function formatMode(mode: number): string {
  // tslint:disable-next-line:no-bitwise
  const simpleMode = mode & 0o777;
  const octal = simpleMode.toString(8).padStart(3, '0');
  let symbols = '';
  for (let index = 0; index < MODE_BITS.length; index += 1) {
    // tslint:disable-next-line:no-bitwise
    symbols += simpleMode & MODE_BITS[index] ? 'rwx'[index % 3] : '-';
  }
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

// A localized "Your access: …" line explaining why the current user can or can't edit the file, given
// their relation to its owner/group and whether the relevant write bit is set. `group` is the file's
// group NAME (for the message); may be undefined.
function buildAccessNote(
  rel: OwnershipRelation,
  writable: boolean,
  readable: boolean | undefined,
  group: string | undefined
): string {
  const g = group ? (L({ en: `group '${group}'`, ru: `группе «${group}»` })) : L({ en: 'the group', ru: 'группе' });
  if (writable) {
    const reason =
      rel === 'owner'
        ? L({ en: 'you are the owner', ru: 'вы владелец' })
        : rel === 'group'
        ? L({ en: `via ${g}`, ru: `через ${g}` })
        : L({ en: 'world-writable', ru: 'доступно всем' });
    return L({ en: `Your access: read-write (${reason})`, ru: `Ваш доступ: запись (${reason})` });
  }
  // Can't even read (drives the 🔒 badge): a "read-only" note here would contradict the lock — e.g. mode
  // 000, or 600 root:root for another user. Report "no access" so the tooltip and the badge agree.
  if (readable === false) {
    const why =
      rel === 'owner'
        ? L({ en: 'you own it, but no read/write bits', ru: 'вы владелец, но нет битов чтения/записи' })
        : rel === 'group'
        ? L({ en: `in ${g}, but no read/write bits`, ru: `в ${g}, но нет битов чтения/записи` })
        : L({ en: `not the owner and not in ${g}`, ru: `не владелец и не в ${g}` });
    return L({ en: `Your access: none — can't read — ${why}`, ru: `Ваш доступ: нет — нельзя читать — ${why}` });
  }
  const reason =
    rel === 'owner'
      ? L({ en: 'you own it, but no owner-write bit', ru: 'вы владелец, но нет бита записи владельца' })
      : rel === 'group'
      ? L({ en: `in ${g}, but no group-write bit`, ru: `в ${g}, но нет бита записи группы` })
      : L({ en: `not the owner and not in ${g}`, ru: `не владелец и не в ${g}` });
  return L({ en: `Your access: read-only — ${reason}`, ru: `Ваш доступ: только чтение — ${reason}` });
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
  // Owner / group: prefer the names from the listing, fall back to the numeric ids. Skipped entirely
  // when neither is known (e.g. FTP), so the tooltip stays clean.
  if (!isRoot) {
    const owner = item.owner || (typeof item.uid === 'number' ? String(item.uid) : undefined);
    const group = item.group || (typeof item.gid === 'number' ? String(item.gid) : undefined);
    if (owner !== undefined) {
      lines.push(`${L({ en: 'Owner', ru: 'Владелец' })}: ${owner}`);
    }
    if (group !== undefined) {
      lines.push(`${L({ en: 'Group', ru: 'Группа' })}: ${group}`);
    }
    // Why the file is (or isn't) editable by the current user — computed at list time when the user's
    // identity is known. Absent on FTP / before identity is fetched.
    if (item.accessNote) {
      lines.push(item.accessNote);
    }
  }
  if (typeof item.mtime === 'number' && item.mtime > 0) {
    lines.push(`${L({ en: 'Modified', ru: 'Изменён' })}: ${formatTime(item.mtime)}`);
  }
  return lines.join('\n');
}

export default class RemoteTreeData
  implements vscode.TreeDataProvider<TreeNode>, vscode.TextDocumentContentProvider {
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
  // Parent uri.query keys whose write-permission hints a background `id`+compute pass is handling.
  private _hintingWrite = new Set<string>();
  // Content verification is deliberately bounded across the whole tree: each item uses one server-side
  // MD5 command and one streamed local hash, and opening many folders must not flood the SSH connection.
  private _contentScheduler = new Scheduler({ concurrency: 4 });
  // Item key → generation + verification key for queued/running MD5 work. This de-dupes repaints and
  // prevents a pre-refresh task from deleting the marker of newer work for the same path.
  private _checkingContent = new Map<string, string>();
  // Last complete child set per loaded directory and the subset currently confirmed Modified. Together
  // they let a re-list remove a deleted/now-synced source before recomputing recursive parent M badges.
  private _listedChildren = new Map<string, Set<string>>();
  private _modifiedSources = new Set<string>();
  // Ancestor keys (uri.query) per Modified source. The list depends only on the source's own path and
  // its root's remotePath — both pinned in the cache entry — so rebuilding it on every verdict is pure
  // waste: each ancestor costs a full resource round-trip (querystring encode + Uri.parse + a second
  // query parse in the constructor), and that dominates the recompute. The `_map.has` filter stays
  // OUTSIDE the memo on purpose: `_map` only grows, and a parent cached later must still light up.
  private _ancestorKeyMemo = new Map<string, { rootPath: string; keys: string[] }>();
  // Cached server listing per parent uri.query, so the instant local-first snapshot can be replaced by the
  // full server-merged listing once the server responds. Cleared by refresh(). No entry = not fetched yet.
  private _remoteListing: Map<string, FileEntry[]> = new Map();
  // In-flight server listings keyed by parent uri.query — a SHARED promise so the instant (background) and
  // complete (navigation) paths never issue two readdirs for the same directory.
  private _remoteInflight: Map<string, Promise<FileEntry[]>> = new Map();
  // Listing generations. A listing that started before its directory was invalidated must not publish
  // its (now stale) result, and that has to be decidable PER DIRECTORY: a targeted refresh may not
  // void listings of branches it didn't touch, or they'd finish, find themselves "stale", skip the
  // cache and leave their folder stuck in the local-only provisional view until poked by hand.
  // _genCounter hands out a fresh number for every invalidation; _baseGen is raised only by a full
  // refresh and devalues every directory at once; _keyGen holds the per-directory bumps.
  private _genCounter = 0;
  private _baseGen = 0;
  private _keyGen: Map<string, number> = new Map();
  // Parent uri.query keys whose listing FAILED (permission/other). We do NOT auto-re-fetch these on every
  // re-render — otherwise a no-access folder loops: fail → fire → getChildren → fail … Cleared by refresh()
  // and by a successful "View as root" (setElevatedListing).
  private _listingFailed = new Set<string>();
  // Keys whose listing came from an elevated (su) "View as root". A slow ORIGINAL login-user listing that
  // was already in flight must not overwrite it in the cache; cleared by refresh().
  private _elevatedKeys = new Set<string>();

  private _onDidChangeFolder: vscode.EventEmitter<ExplorerItem | undefined> = new vscode.EventEmitter<
    ExplorerItem | undefined
  >();
  private _onDidChangeFile: vscode.EventEmitter<vscode.Uri> = new vscode.EventEmitter<vscode.Uri>();
  // Fired with the uris whose write-permission decoration just changed, so the FileDecorationProvider
  // can repaint only those rows (the dimmed "read-only for you" cue).
  private _onDidChangeDecorations: vscode.EventEmitter<vscode.Uri[]> = new vscode.EventEmitter<
    vscode.Uri[]
  >();
  readonly onDidChangeTreeData: vscode.Event<ExplorerItem | undefined> = this._onDidChangeFolder.event;
  readonly onDidChange: vscode.Event<vscode.Uri> = this._onDidChangeFile.event;
  readonly onDidChangeDecorations: vscode.Event<vscode.Uri[]> = this._onDidChangeDecorations.event;

  // Look up the cached tree node for a remote uri (used by the write-permission decoration provider).
  getItemByUri(uri: vscode.Uri): ExplorerItem | undefined {
    return this._map.get(uri.query);
  }

  // Snapshot the CURRENTLY CACHED Modified (M) leaf files as upload candidates. Only nodes in
  // already-expanded folders are present, and a file still pending background MD5 is Synced (not yet M),
  // so this is deliberately a view of what the user can SEE — never a disk walk. `pendingMd5` lets the
  // caller warn when the M-set may still grow.
  collectModifiedUploadCandidates(): { candidates: ModifiedUploadCandidate[]; pendingMd5: number } {
    const candidates: ModifiedUploadCandidate[] = [];
    this._modifiedSources.forEach(key => {
      const item = this._map.get(key);
      if (!item || item.isDirectory) {
        return;
      }
      const c = item as ExplorerChild;
      // Safety: only real M leaves with a local twin (a folder is a propagation marker, never a target).
      if (c.status !== NodeStatus.Modified || !c.localPath) {
        return;
      }
      const root = this.findRoot(item.resource.uri);
      candidates.push({
        localPath: c.localPath,
        remotePath: item.resource.fsPath,
        remoteUri: item.resource.uri,
        writable: c.writable,
        mode: c.mode,
        owner: c.owner,
        group: c.group,
        host: root ? root.explorerContext.config.host : undefined,
        profile: root ? root.explorerContext.profile : undefined,
      });
    });
    return { candidates, pendingMd5: this._checkingContent.size };
  }

  // The generation in force for one directory: the higher of the global base and its own bump. It never
  // decreases, so "captured === current" strictly means "this directory hasn't been invalidated since".
  private _genOf(key: string): number {
    const own = this._keyGen.get(key) || 0;
    return own > this._baseGen ? own : this._baseGen;
  }

  // The listing generation of ONE directory — an elevated (su) fetch captures this BEFORE it starts, so a
  // refresh landing mid-fetch can void the now-stale result at publish time (see setElevatedListing).
  listGenerationFor(item: ExplorerItem): number {
    return this._genOf(item.resource.uri.query);
  }

  // Publish a directory's children obtained via an elevated (su) listing: seed the cache for this dir so
  // getChildren merges them in, clear its Denied/Unknown status, and re-render. Superseded by the next
  // refresh(), which drops the cache and re-checks access as the login user.
  setElevatedListing(item: ExplorerItem, entries: FileEntry[], gen: number): void {
    // The caller captures the generation before its (slow) su fetch; if a refresh has since bumped it, this
    // elevated snapshot is stale — drop it rather than publish it over the freshly re-checked state. `gen` is
    // REQUIRED (not optional) so a future caller can't silently bypass this guard by omitting it.
    const key = item.resource.uri.query;
    if (gen !== this._genOf(key)) {
      return;
    }
    this._remoteListing.set(key, entries);
    this._listingFailed.delete(key); // access obtained (via su) — no longer a failed listing
    this._elevatedKeys.add(key); // don't let a slow in-flight login-user listing overwrite this
    (item as ExplorerChild).status = undefined;
    this._onDidChangeDecorations.fire([item.resource.uri]);
    this._onDidChangeFolder.fire(item);
  }

  // Directories whose server listings a TARGETED refresh must drop: the node itself, whatever directory
  // lists it, and everything cached underneath. The subtree always goes, not just when isDirectory says
  // so — callers get that flag wrong in both directions, and there is no cache under a file's path
  // anyway, so nothing extra is lost. Keys are parsed with querystring rather than looked up in _map:
  // the directory node may not be in _map at all (getChildrenComplete is also called on a synthetic
  // item built in fileHandlers/shared).
  private _invalidationKeys(item: ExplorerItem): Set<string> {
    const keys = new Set<string>([item.resource.uri.query]);
    const root = this.findRoot(item.resource.uri);
    if (!root || item.resource.fsPath !== root.resource.fsPath) {
      keys.add(
        UResource.updateResource(item.resource, {
          remotePath: upath.dirname(item.resource.fsPath),
        }).uri.query
      );
    }
    const base = item.resource.fsPath;
    const remoteId = String(item.resource.remoteId);
    const profile = item.resource.profile || '';
    const candidates = new Set<string>();
    this._remoteListing.forEach((_v, k) => candidates.add(k));
    this._remoteInflight.forEach((_v, k) => candidates.add(k));
    this._listingFailed.forEach(k => candidates.add(k));
    this._elevatedKeys.forEach(k => candidates.add(k));
    this._keyGen.forEach((_v, k) => candidates.add(k));
    candidates.forEach(k => {
      const q = querystring.parse(k);
      if (String(q.remoteId) !== remoteId || ((q.profile as string) || '') !== profile) {
        return; // another host or another profile — someone else's tree
      }
      const p = (q.fsPath as string) || '';
      // Same containment test _isInsideCachedSubtree uses: it normalises a trailing slash and the
      // relative "./" root, so /var/www2 is not mistaken for a child of /var/www.
      if (p === base || ancestorPaths(p, base).length > 0) {
        keys.add(k);
      }
    });
    return keys;
  }

  async refresh(item?: ExplorerItem): Promise<any> {
    // A full refresh (the view's button) invalidates the whole tree; a targeted one touches only the
    // affected directories, so upload-on-save stops wiping other branches' listings, their elevated
    // snapshots and their queued content checks.
    const scope = item ? this._invalidationKeys(item) : undefined;
    // A refresh re-measures folder sizes AND re-reads symlink targets (an admin can repoint a link):
    // drop both cached results so they recompute on demand. For a targeted refresh that means the
    // invalidated subtree PLUS every ancestor up to the root — those really did change size when
    // something below them changed. Sibling branches keep theirs: with sort-by-size on, wiping the
    // whole map meant one saved file re-ran a server-side `du` over every folder in the root.
    const sizeScope = scope && item ? new Set(scope) : undefined;
    if (sizeScope && item) {
      const root = this.findRoot(item.resource.uri);
      if (root) {
        ancestorPaths(item.resource.fsPath, root.resource.fsPath).forEach(p => {
          sizeScope.add(UResource.updateResource(item.resource, { remotePath: p }).uri.query);
        });
      }
    }
    const statusCleared: vscode.Uri[] = [];
    this._map.forEach(node => {
      if (!sizeScope || sizeScope.has(node.resource.uri.query)) {
        node.folderBytes = undefined;
        node.linkTarget = undefined;
      }
      // KEEP contentVerification / contentVerificationKey / hasModifiedDescendant AND writable / accessNote
      // across a refresh: the confirmed-M state (and the "read-only for you" hint that "Upload Modified"
      // uses to route RO files to the root path) is retained optimistically so a folded branch doesn't
      // lose it. Each self-invalidates on the next merge — decideStatus re-keys on both sides' size+mtime,
      // and _children drops the write hint when mode/uid/gid changed — so a stale value can't survive a
      // real change.
      // Re-check access on refresh: drop a stuck "no access"/"unknown" so a fresh listing can clear it.
      // ONLY where the listing is actually being dropped, though: clear it elsewhere and the badge
      // disappears while the failed-listing marker stays, so the folder is never re-fetched and its
      // "list not complete" row silently loses both the warning and the "View as root" hint.
      if (
        (node.status === NodeStatus.Denied || node.status === NodeStatus.Unknown) &&
        (!scope || scope.has(node.resource.uri.query))
      ) {
        node.status = undefined;
        // Repaint: clearing the flag alone doesn't re-run provideFileDecoration, so a stale "no access"
        // yellow would otherwise linger on a folded node until it is next expanded.
        statusCleared.push(node.resource.uri);
      }
    });
    // Drop cached server listings so a refresh re-reads BOTH sides — the local disk and the server. Bump the
    // generation and drop in-flight fetches + failed-listing markers too, so a slow pre-refresh listing can't
    // publish its stale result into the freshly-cleared cache, a fresh expand actually re-fetches instead of
    // being de-duped against the old in-flight entry, and a previously no-access folder is retried.
    // KEEP _listedChildren and _modifiedSources: the retained child sets let the next merge diff against
    // what was there before (removing a deleted/now-synced source), and the retained M sources keep folded
    // ancestors yellow until that merge re-derives them. Clearing them here was the root cause of M badges
    // vanishing tree-wide on any refresh.
    if (scope) {
      // Per-key bump: a hanging pre-refresh listing of THESE directories won't publish its stale result,
      // while background work on every other branch — listings, queued MD5 checks, "View as root"
      // snapshots — lives to finish. The content scheduler is deliberately left alone: tasks inside the
      // scope are already voided by the new generation, and tasks outside it must be allowed to complete.
      // Emptying it on every save was dropping MD5 work tree-wide, which left files sitting at "Synced"
      // with nothing queued to correct them — so "Upload Modified" quietly under-counted.
      const gen = (this._genCounter += 1);
      scope.forEach(key => {
        this._remoteListing.delete(key);
        this._remoteInflight.delete(key);
        this._listingFailed.delete(key);
        this._elevatedKeys.delete(key);
        this._keyGen.set(key, gen);
      });
    } else {
      this._remoteListing.clear();
      this._remoteInflight.clear();
      this._listingFailed.clear();
      this._elevatedKeys.clear();
      this._contentScheduler.empty();
      this._checkingContent.clear();
      // _baseGen must be raised, not just reset: two full refreshes in a row would both land on 0 if the
      // per-key map were merely cleared, and a listing captured between them would look current.
      this._baseGen = this._genCounter += 1;
      this._keyGen.clear();
    }
    // Repaint any node whose stuck Denied/Unknown we just cleared (covers both full and targeted refresh).
    if (statusCleared.length > 0) {
      this._onDidChangeDecorations.fire(statusCleared);
    }
    // refresh root
    if (!item) {
      // Rebuild the root level (the config/profile set may have changed) but DO NOT wipe _map — keeping
      // node identity and the retained M state means a folded branch survives a full refresh. _getRoots()
      // replaces the root NODES with fresh ones, so re-derive ancestor badges from the retained
      // _modifiedSources to restore each still-cached (incl. folded) parent's yellow immediately; an
      // expanded branch's background merge then re-confirms or clears it against the fresh listing.
      this._roots = null;
      this._rootsMap = null;
      this._getRoots();
      const ancestorChanges = this._recomputeModifiedAncestors();

      // fire(undefined) tells VS Code to refresh the whole tree (EventEmitter.fire
      // requires an argument since @types/vscode bumped past 1.40).
      this._onDidChangeFolder.fire(undefined);
      if (ancestorChanges.length > 0) {
        this._onDidChangeDecorations.fire(ancestorChanges);
      }
      return;
    }

    if (item.isDirectory) {
      this._onDidChangeFolder.fire(item);

      // refresh top level files as well
      const children = await this.getChildrenComplete(item);
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

  // Explicit "Recheck Modified Files" on a folder: force a fresh, RECURSIVE re-listing of the whole
  // subtree — even folded parts a normal refresh leaves cached — so the M model is rebuilt from the
  // current bytes on both sides. Each folder's cached server listing is dropped so getChildrenComplete
  // re-fetches it; the confirmed-M verdicts are NOT dropped (decideStatus re-validates each against the
  // fresh size/mtime, re-hashing only what actually changed). The extra server I/O is intentional — a
  // deliberate user action — and bounded by a folder cap plus the cancellation token.
  async recheckSubtree(
    item: ExplorerItem,
    token: vscode.CancellationToken,
    onProgress: (folders: number) => void
  ): Promise<{ folders: number; truncated: boolean }> {
    const MAX_FOLDERS = 5000;
    let folders = 0;
    let truncated = false;

    const walk = async (folder: ExplorerItem): Promise<void> => {
      if (token.isCancellationRequested) {
        return;
      }
      if (folders >= MAX_FOLDERS) {
        truncated = true;
        return;
      }
      folders += 1;
      onProgress(folders);

      // Force a real server re-read of this folder: drop its cached listing, any in-flight/failed marker
      // and the elevated flag so getChildrenComplete re-fetches from the server. _listedChildren is kept
      // so the merge still diffs against the previous child set (retiring a deleted/now-synced source);
      // the confirmed-M verdicts are kept too and re-validated by decideStatus against the fresh metadata.
      const key = folder.resource.uri.query;
      this._remoteListing.delete(key);
      this._remoteInflight.delete(key);
      this._listingFailed.delete(key);
      this._elevatedKeys.delete(key);
      // Bump too, or a listing of this folder that is already in flight finishes, still believes it is
      // current, and writes its pre-recheck result over the one we are about to fetch.
      this._keyGen.set(key, (this._genCounter += 1));

      let children: ExplorerItem[];
      try {
        children = await this.getChildrenComplete(folder);
      } catch (e) {
        // An unreadable/vanished folder is skipped, never aborting the whole walk.
        logger.info(
          `recheckSubtree: list failed for ${folder.resource.fsPath}: ${(e && (e as Error).message) || e}`
        );
        return;
      }

      for (const child of children) {
        if (token.isCancellationRequested) {
          return;
        }
        const c = child as ExplorerChild;
        // Descend only into real server-backed subfolders: a local-only folder has no server side to
        // re-list, and following a symlinked directory could walk a loop off the subtree.
        if (child.isDirectory && !c.isSymbolicLink && c.status !== NodeStatus.LocalOnly) {
          await walk(child);
        }
      }
    };

    await walk(item);
    return { folders, truncated };
  }

  // Render the synthetic "list not complete" row. A real TreeItem.command (not just a context menu) so it
  // is keyboard-accessible: Enter/click re-lists as root (SFTP permission) or retries (FTP / network).
  private _noticeTreeItem(item: NoticeItem): vscode.TreeItem {
    if (item.remedy === 'root') {
      const ti = new vscode.TreeItem(
        L({ en: 'List not complete — Show all as root…', ru: 'Список неполный — Показать всё от root…' }),
        vscode.TreeItemCollapsibleState.None
      );
      ti.iconPath = new vscode.ThemeIcon('shield');
      ti.tooltip = L({
        en: 'Your login can’t list this folder fully — only locally-known entries are shown. Re-list it as the owner or root.',
        ru: 'Ваш логин не может прочитать эту папку полностью — показаны только локально известные элементы. Перечитайте от владельца или root.',
      });
      ti.command = {
        command: COMMAND_REMOTEEXPLORER_VIEW_AS_ROOT,
        title: 'View as root',
        arguments: [item.parent],
      };
      return ti;
    }
    const ti = new vscode.TreeItem(
      L({ en: 'List not complete — Retry', ru: 'Список неполный — Повторить' }),
      vscode.TreeItemCollapsibleState.None
    );
    ti.iconPath = new vscode.ThemeIcon('refresh');
    ti.tooltip = L({
      en: 'The server listing failed — only locally-known entries are shown. Retry.',
      ru: 'Не удалось получить список с сервера — показаны только локально известные элементы. Повторить.',
    });
    // Re-list just THIS folder, not the whole tree (the label says "Retry", not "Refresh everything").
    ti.command = { command: COMMAND_REMOTEEXPLORER_REFRESH, title: 'Refresh', arguments: [item.parent] };
    return ti;
  }

  getTreeItem(item: TreeNode): vscode.TreeItem {
    if (isNoticeItem(item)) {
      return this._noticeTreeItem(item);
    }
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
      if ((item as ExplorerChild).status === NodeStatus.Denied) {
        // No permission to list/read — point the user at the elevation action.
        description = L({
          en: 'no access — right-click “View as root”',
          ru: 'нет доступа — ПКМ «Показать от root»',
        });
      } else if (item.isSymbolicLink) {
        // A symlink shows where it points (resolved in the background), not its own byte size. The
        // dimmed "→ target" is the at-a-glance cue that this entry is a link, not a plain file.
        description = item.linkTarget
          ? `→ ${item.linkTarget}`
          : L({ en: 'symbolic link', ru: 'символическая ссылка' });
      } else if (setting.showSizeInTree) {
        // Dim size in the description, controlled SOLELY by the "show sizes" toggle (independent of
        // sort): files use the size from the listing; folders use the `du` size measured for this
        // listing. No per-item requests here.
        const c = item as ExplorerChild;
        if (!item.isDirectory) {
          if (c.status === NodeStatus.Modified && typeof c.size === 'number' && typeof c.localSize === 'number') {
            // A differing file shows both sides so the direction of the change is visible at a glance.
            description = `${formatBytes(c.size)} ↔ ${formatBytes(c.localSize)}`;
          } else if (typeof item.size === 'number') {
            description = formatBytes(item.size);
          } else if (typeof c.localSize === 'number') {
            description = formatBytes(c.localSize); // local-only file (nothing on the server)
          }
        } else if (typeof item.folderBytes === 'number' && item.folderBytes >= 0) {
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
      // Encode the protocol into a root's contextValue (root.sftp / root.ftp / root.local) so menus can
      // offer SSH-only actions (e.g. Generate SSH Key) on SFTP roots only. A LOCAL-ONLY node (on disk, not
      // on the server) gets 'fileLocalOnly' / 'folderLocalOnly' so the menus can hide server-only actions
      // (Download, chmod/chown, Rename, View as root) that would just fail with "No such file" on it, while
      // keeping its real actions (Upload, Delete, Reveal, Copy Path). A symlink keeps its server 'file' /
      // 'folder' value; its special handling is the click command below, not the menu.
      contextValue: isRoot
        ? `root.${(item as ExplorerRoot).explorerContext.config.protocol || 'sftp'}`
        : contextValueFor((item as ExplorerChild).status, item.isDirectory),
      command: item.isDirectory
        ? undefined
        : (item as ExplorerChild).localPath && (item as ExplorerChild).status !== NodeStatus.Conflict
        ? {
            // The file exists on disk — open the LOCAL copy directly (instant, no download, nothing
            // overwritten). Covers local-only, modified and in-sync files. Checked BEFORE the symlink
            // branch so a LOCAL-ONLY symlink opens its on-disk file instead of trying to readlink a server
            // path that doesn't exist. Use Diff / Download from the menu to compare or pull the server copy.
            command: 'vscode.open',
            arguments: [
              vscode.Uri.file((item as ExplorerChild).localPath as string),
              { preview: true },
            ],
            title: 'Open Local File',
          }
        : isSymlink
        ? {
            // A remote-only symlink can't be opened/downloaded like a file (recreating an absolute link is
            // refused); explain it and offer to open the real target instead.
            command: COMMAND_REMOTEEXPLORER_OPEN_SYMLINK,
            arguments: [item],
            title: 'Open Symlink Target',
          }
        : {
            // Already read at the top of getTreeItem — no need to walk the whole configuration twice.
            command: setting.downloadWhenOpenInRemoteExplorer
              ? COMMAND_REMOTEEXPLORER_EDITINLOCAL
              : COMMAND_REMOTEEXPLORER_VIEW_CONTENT,
            arguments: [item],
            title: 'View Remote Resource',
          },
    };
  }

  async getChildren(item?: TreeNode): Promise<TreeNode[]> {
    if (!item) {
      return this._getRoots();
    }
    if (isNoticeItem(item)) {
      return []; // a notice row is a leaf
    }
    // VS Code-facing: local-first — paint the local side instantly and pull the server listing in the
    // background. Navigation/reveal use getChildrenComplete so they always get the full server-merged list.
    const children = await this._children(item, false);
    // If this directory's server listing FAILED, the rows above are only the locally-known entries — a lone
    // shared file must not read as "the whole directory". Prepend an explicit "list not complete" row whose
    // action re-lists as root (SFTP permission) or retries (FTP / network).
    if (this._listingFailed.has(item.resource.uri.query)) {
      const remedy: 'root' | 'retry' =
        (item as ExplorerChild).status === NodeStatus.Denied ? 'root' : 'retry';
      return [{ kind: 'notice', remedy, parent: item } as NoticeItem, ...children];
    }
    return children;
  }

  // The complete, server-merged children of a node — always waits for the server listing. Used by
  // navigation/reveal (_resolveByPath, getParent, refresh), which must see server-only entries too, not the
  // instant local-only snapshot getChildren returns before the server responds.
  async getChildrenComplete(item?: ExplorerItem): Promise<ExplorerItem[]> {
    if (!item) {
      return this._getRoots();
    }
    return this._children(item, true);
  }

  private async _children(item: ExplorerItem, waitRemote: boolean): Promise<ExplorerItem[]> {
    const root = this.findRoot(item.resource.uri);
    if (!root) {
      throw new Error(`Can't find config for remote resource ${item.resource.uri}.`);
    }
    const config = root.explorerContext.config;
    const fileService = root.explorerContext.fileService;
    const localFs = fileService.getLocalFileSystem();
    const parentRemotePath = item.resource.fsPath;
    // The local directory mirroring this remote folder — a pure string map, no I/O. Its listing may be
    // absent (a remote-only path has no local twin); treat ENOENT as "no local twin" rather than an error.
    const localDir = toLocalPath(parentRemotePath, config.remotePath, fileService.baseDir);
    const localEntries = await localFs.list(localDir).catch(e => {
      // ENOENT = no local twin directory (normal for a remote-only path). Log anything else (EACCES /
      // EMFILE / I/O) so a real local-FS problem is visible instead of being silently read as "no local
      // files" — which would drop the localPath and let a click download over an existing local copy.
      if (e && e.code !== 'ENOENT') {
        logger.warn(`remoteExplorer: local listing failed for ${localDir}: ${(e && e.message) || e}`);
      }
      return [] as FileEntry[];
    });

    const key = item.resource.uri.query;
    let fileEntries = this._remoteListing.get(key);
    if (fileEntries === undefined) {
      if (!waitRemote) {
        // Instant path: show the local side now, fetch the server listing in the background; when it lands
        // the cache is filled and the parent re-rendered, so getChildren runs again and merges.
        this._kickRemoteListing(fileService, config, parentRemotePath, key, item);
        return this._buildProvisional(item, localEntries);
      }
      // Complete path (navigation/reveal): wait for the server listing (shared with any in-flight kick).
      try {
        fileEntries = await this._fetchRemoteListing(fileService, config, parentRemotePath, key);
      } catch (e) {
        // If a "View as root" published an elevated listing for this key while this (shared) login fetch was
        // in flight and it then REJECTED, don't stamp Denied or throw over the valid elevated cache — adopt it.
        // (The success path is handled by the guard just below; this is the rejection path.)
        const elevated = this._elevatedKeys.has(key) ? this._remoteListing.get(key) : undefined;
        if (elevated !== undefined) {
          fileEntries = elevated;
        } else {
          // Surface the failure the same way the background kick does, so the "list not complete" notice (and
          // the Denied/Unknown badge) shows on the COMPLETE path too — refresh / recheck / navigation / reveal
          // — not only after a UI expand. A genuine "not found" (a local-only dir with no server path) is left
          // alone; any other error marks the folder: SFTP permission → Denied (View as root), else Unknown
          // (Retry). Fire the folder too so getChildren re-runs and prepends the notice row.
          if (!isNotFoundListing(e)) {
            const denied = isPermissionDeniedListing(e) && config.protocol === 'sftp';
            (item as ExplorerChild).status = denied ? NodeStatus.Denied : NodeStatus.Unknown;
            this._listingFailed.add(key);
            this._onDidChangeDecorations.fire([item.resource.uri]);
            this._onDidChangeFolder.fire(item);
          }
          throw e;
        }
      }
      // A "View as root" may have published an elevated listing for this key WHILE we awaited the (shared,
      // possibly pre-elevation) login fetch above — that fetch resolves with LOGIN-user entries and would
      // render OVER the elevated view. Prefer the elevated cache when it now owns the key.
      if (this._elevatedKeys.has(key)) {
        fileEntries = this._remoteListing.get(key) ?? fileEntries;
      }
    }
    // The connection is up (the listing came from it), so this resolves the memoized client cheaply; it is
    // reused by the background passes (symlink targets, write hints, folder sizes) below.
    const remotefs = await fileService.getRemoteFileSystem(config);

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

    // Index the local listing by name so each remote entry finds its on-disk twin in O(1). Twins that get
    // consumed are deleted from the map, so whatever remains is "local-only" (on disk, not on the server).
    // On a case-insensitive local FS (Windows / macOS) match names case-insensitively, so a server
    // `README.md` and an on-disk `readme.md` are ONE file — not a duplicated remote-only + local-only pair
    // (which would also make a click download/upload the wrong twin).
    const caseInsensitive = process.platform === 'win32' || process.platform === 'darwin';
    const nameKey = (n: string) => (caseInsensitive ? n.toLowerCase() : n);
    const localByName = new Map<string, FileEntry>();
    for (const localEntry of localEntries) {
      localByName.set(nameKey(localEntry.name), localEntry);
    }

    // Build one node per remote entry. Size/type/mtime decide the cheap path; equal-size regular files
    // whose mtimes differ are queued below for content verification instead of being labelled M blindly.
    const contentCandidates: ContentCheckCandidate[] = [];
    const items: ExplorerItem[] = filtered.map(file => {
      const isDirectory = file.type === FileType.Directory;
      const isSymbolicLink = file.type === FileType.SymbolicLink;
      const localTwin = localByName.get(nameKey(file.name));
      localByName.delete(nameKey(file.name));
      const localPath = localTwin ? localTwin.fspath : undefined;
      const localSize =
        localTwin && localTwin.type === FileType.File ? localTwin.size : undefined;
      const localMtime = localTwin ? localTwin.mtime : undefined;
      const newResource = UResource.updateResource(item.resource, {
        remotePath: file.fspath,
      });
      const mapItem = this._map.get(newResource.uri.query);
      const decision = decideStatus(file, localTwin, mapItem && mapItem.contentVerification);
      const cachedVerification =
        decision.verificationKey &&
        mapItem &&
        mapItem.contentVerification &&
        mapItem.contentVerification.key === decision.verificationKey
          ? mapItem.contentVerification
          : undefined;
      let resultItem: ExplorerItem;
      if (mapItem) {
        // Keep the cached node's identity, pinned type, any cached folderBytes and resolved linkTarget;
        // refresh the rest.
        // If ownership/permissions changed on the server since we last listed, drop the cached write
        // hint so it recomputes against the new mode/uid/gid instead of showing a stale RO badge.
        if (mapItem.mode !== file.mode || mapItem.uid !== file.uid || mapItem.gid !== file.gid) {
          mapItem.writable = undefined;
          mapItem.readable = undefined;
          mapItem.accessNote = undefined;
        }
        mapItem.size = file.size;
        mapItem.mode = file.mode;
        mapItem.mtime = file.mtime;
        mapItem.owner = file.owner;
        mapItem.group = file.group;
        mapItem.uid = file.uid;
        mapItem.gid = file.gid;
        // The listing is authoritative for the type — correct a node whose type was provisional
        // (local-derived) or flipped server-side, EXCEPT right after we created it (pinKnownType), when a
        // racy server may still report the old type; honour the pin for exactly one listing.
        if (mapItem.typePinned) {
          mapItem.typePinned = false;
        } else {
          mapItem.isDirectory = isDirectory;
        }
        mapItem.isSymbolicLink = isSymbolicLink;
        mapItem.status = decision.status;
        mapItem.localPath = localPath;
        mapItem.localSize = localSize;
        mapItem.localMtime = localMtime;
        mapItem.contentVerification = cachedVerification;
        mapItem.contentVerificationKey = decision.verificationKey;
        resultItem = mapItem;
      } else {
        const newItem: ExplorerChild = {
          resource: newResource,
          isDirectory,
          isSymbolicLink,
          size: file.size,
          mode: file.mode,
          mtime: file.mtime,
          owner: file.owner,
          group: file.group,
          uid: file.uid,
          gid: file.gid,
          status: decision.status,
          localPath,
          localSize,
          localMtime,
          contentVerificationKey: decision.verificationKey,
        };
        this._map.set(newItem.resource.uri.query, newItem);
        resultItem = newItem;
      }
      if (
        decision.verificationKey &&
        !cachedVerification &&
        localPath !== undefined &&
        localSize !== undefined &&
        localMtime !== undefined
      ) {
        contentCandidates.push({
          item: resultItem,
          key: decision.verificationKey,
          remotePath: file.fspath,
          remoteSize: file.size,
          remoteMtime: file.mtime,
          localPath,
          localSize,
          localMtime,
        });
      }
      return resultItem;
    });

    // Whatever local entries are left have no server counterpart: add them as local-only nodes (badge L)
    // so the tree shows what exists on disk but isn't on the server yet. Their resource is a synthetic
    // remote URI at the same relative path, so decoration/mapping/routing all work uniformly; the click
    // handler opens the local file (there is nothing to download).
    localByName.forEach(localEntry => {
      const remoteTwinPath = upath.join(parentRemotePath, localEntry.name);
      // Apply the SAME ignore filter to local-only entries — otherwise local .git / node_modules /
      // .DS_Store (never on the server) leak into the SERVER tree as local-only clutter.
      if (ignore.ignores(upath.relative(config.remotePath, remoteTwinPath))) {
        return;
      }
      const isDirectory = localEntry.type === FileType.Directory;
      const isSymbolicLink = localEntry.type === FileType.SymbolicLink;
      const newResource = UResource.updateResource(item.resource, {
        remotePath: remoteTwinPath,
      });
      const localSize = localEntry.type === FileType.File ? localEntry.size : undefined;
      const existing = this._map.get(newResource.uri.query);
      if (existing) {
        existing.isDirectory = isDirectory;
        existing.isSymbolicLink = isSymbolicLink;
        existing.status = NodeStatus.LocalOnly;
        existing.localPath = localEntry.fspath;
        existing.localSize = localSize;
        existing.localMtime = localEntry.mtime;
        existing.contentVerification = undefined;
        existing.contentVerificationKey = undefined;
        // Nothing on the server anymore — clear server-derived metadata so the tooltip/decoration don't
        // show the stale mode/owner/mtime of a file that was deleted server-side.
        existing.size = undefined;
        existing.mode = undefined;
        existing.mtime = undefined;
        existing.owner = undefined;
        existing.group = undefined;
        existing.uid = undefined;
        existing.gid = undefined;
        existing.writable = undefined;
        existing.readable = undefined;
        existing.accessNote = undefined;
        existing.linkTarget = undefined;
        existing.folderBytes = undefined;
        items.push(existing);
        return;
      }
      const localNode: ExplorerChild = {
        resource: newResource,
        isDirectory,
        isSymbolicLink,
        status: NodeStatus.LocalOnly,
        localPath: localEntry.fspath,
        localSize,
        localMtime: localEntry.mtime,
      };
      this._map.set(localNode.resource.uri.query, localNode);
      items.push(localNode);
    });

    // Repaint direct states and recursively update every cached ancestor of confirmed M sources. Missing
    // children from the previous complete listing are removed from the source set here as well.
    const ancestorChanges = this._recordCompleteListing(item, items);
    this._onDidChangeDecorations.fire(
      this._uniqueUris(items.map(i => i.resource.uri).concat(ancestorChanges))
    );

    // MD5 checks are background work: the merged listing paints immediately, while the bounded queue
    // confirms ambiguous equal-size/mtime-different files and re-renders only the affected path.
    this._queueContentChecks(remotefs, localFs, contentCandidates, item);

    // Resolve each symlink's target in the background with ONE readlink apiece (cheap, unlike `du`), so
    // the tree paints immediately and the dimmed "→ target" fills in a moment later. Only links without
    // a cached target are read; refresh() clears the cache. De-duped per parent so concurrent expands
    // of the same folder don't pile up readlinks.
    const unresolvedLinks = items.filter(
      i =>
        (i as ExplorerChild).isSymbolicLink &&
        (i as ExplorerChild).linkTarget === undefined &&
        // A local-only symlink has no server path to readlink — skip it (else a doomed readlink runs).
        (i as ExplorerChild).status !== NodeStatus.LocalOnly
    );
    if (unresolvedLinks.length > 0) {
      this._resolveSymlinkTargets(remotefs, unresolvedLinks, item).catch(() => undefined);
    }

    // Advisory write-permission hints: dim the files the current user can't edit. Non-blocking — needs
    // the user's identity (one `id` per connection), then repaints the affected rows and re-renders the
    // parent so tooltips pick up the "Your access: …" note.
    this._applyWriteHints(remotefs, items, item).catch(() => undefined);

    // Folder sizes (for display and/or sort) are measured with ONE server-side `du`, but NOT awaited
    // here: the tree shows folder names and file sizes immediately, while a background measurement fills
    // in folder sizes (and re-sorts) when it returns — so a slow `du` on a deep tree never blocks the
    // expand. Only folders without a cached size are (re)measured; refresh() clears the cache.
    const setting = getExtensionSetting();
    const sortBySize = setting.sortBySizeInTree;
    if (sortBySize || setting.showSizeInTree) {
      // Skip LOCAL-ONLY folders: they have no server path, so a server-side `du` on them ALWAYS fails — and
      // because a local-only node's folderBytes is reset every rebuild (it may transition to/from server-
      // backed), that failure would re-measure forever, hammering the SSH connection (endless failing `du`
      // channels) and flickering the tree. They simply have no server size to show.
      const unmeasured = items.filter(
        i =>
          i.isDirectory &&
          (i as ExplorerChild).status !== NodeStatus.LocalOnly &&
          typeof i.folderBytes !== 'number'
      );
      if (unmeasured.length > 0) {
        this._measureFolderSizes(remotefs, unmeasured, item).catch(() => undefined);
      }
    }

    if (!sortBySize) {
      return sortSiblings(items);
    }
    // Files and folders sort as SEPARATE groups (folders first, then files), each by size descending —
    // so the biggest folder tops the folders and the biggest file tops the files, never intermixed.
    const dirs = items.filter(i => i.isDirectory);
    const files = items.filter(i => !i.isDirectory);
    const folderBytesOf = (i: ExplorerItem) => (typeof i.folderBytes === 'number' ? i.folderBytes : -1);
    dirs.sort(
      (a, b) => folderBytesOf(b) - folderBytesOf(a) || nameCollator.compare(a.resource.fsPath, b.resource.fsPath)
    );
    // Sort files by their effective size — the server size when present, else the local-only file's size
    // (which is what the row actually shows), so a large local-only file isn't parked at the bottom.
    const fileBytesOf = (i: ExplorerItem) => {
      const c = i as ExplorerChild;
      return typeof c.size === 'number' ? c.size : typeof c.localSize === 'number' ? c.localSize : 0;
    };
    files.sort(
      (a, b) => fileBytesOf(b) - fileBytesOf(a) || nameCollator.compare(a.resource.fsPath, b.resource.fsPath)
    );
    return dirs.concat(files);
  }

  // Instant local-only snapshot: the on-disk children painted with NO status badge (the server side isn't
  // known yet, so nothing is mislabelled) and each file already opens locally on click. Reuses cached nodes
  // so identity stays stable when the full server-merged listing replaces this a moment later.
  private _buildProvisional(item: ExplorerItem, localEntries: FileEntry[]): ExplorerItem[] {
    const items: ExplorerItem[] = [];
    // If the PARENT is a LOCAL-ONLY folder, its children can't exist on the server either — mark them
    // LocalOnly right away so the instant render already hides server-only actions (Download, chmod/chown,
    // …) instead of flashing them until the (empty) server listing lands. For a server-backed folder we
    // leave status undefined, since a local child there may well have a server twin.
    const provisionalStatus =
      (item as ExplorerChild).status === NodeStatus.LocalOnly ? NodeStatus.LocalOnly : undefined;
    localEntries.forEach(localEntry => {
      const isDirectory = localEntry.type === FileType.Directory;
      const isSymbolicLink = localEntry.type === FileType.SymbolicLink;
      const remoteTwinPath = upath.join(item.resource.fsPath, localEntry.name);
      const newResource = UResource.updateResource(item.resource, { remotePath: remoteTwinPath });
      const localSize = localEntry.type === FileType.File ? localEntry.size : undefined;
      const existing = this._map.get(newResource.uri.query);
      if (existing) {
        existing.isDirectory = isDirectory;
        existing.isSymbolicLink = isSymbolicLink;
        existing.localPath = localEntry.fspath;
        existing.localSize = localSize;
        existing.localMtime = localEntry.mtime;
        if (provisionalStatus !== undefined) {
          // Under a LocalOnly parent the child can't be on the server — force LocalOnly and drop any stale
          // verdict, as before.
          existing.status = provisionalStatus;
          existing.contentVerification = undefined;
          existing.contentVerificationKey = undefined;
        }
        // Otherwise KEEP the last known status/verdict during this instant local-first paint: blanking it
        // here is what made a badge flicker off on every expand/refresh. The background server merge (a
        // moment later) re-confirms it via decideStatus, whose key pins both sides so a stale verdict can't
        // mispaint a file that actually changed.
        items.push(existing);
        return;
      }
      const node: ExplorerChild = {
        resource: newResource,
        isDirectory,
        isSymbolicLink,
        localPath: localEntry.fspath,
        localSize,
        localMtime: localEntry.mtime,
        status: provisionalStatus,
      };
      this._map.set(node.resource.uri.query, node);
      items.push(node);
    });
    // Repaint (clear) any stale badge while we wait for the fresh server listing.
    this._onDidChangeDecorations.fire(items.map(i => i.resource.uri));
    return sortSiblings(items);
  }

  private _uniqueUris(uris: vscode.Uri[]): vscode.Uri[] {
    const byKey = new Map<string, vscode.Uri>();
    uris.forEach(uri => byKey.set(uri.query, uri));
    return Array.from(byKey.values());
  }

  private _sameRemoteTree(a: ExplorerItem, b: ExplorerItem): boolean {
    return (
      a.resource.remoteId === b.resource.remoteId &&
      a.resource.profile === b.resource.profile
    );
  }

  private _isInsideCachedSubtree(
    candidate: ExplorerItem,
    subtree: ExplorerItem,
    includeSubtree: boolean
  ): boolean {
    if (!this._sameRemoteTree(candidate, subtree)) {
      return false;
    }
    if (candidate.resource.fsPath === subtree.resource.fsPath) {
      return includeSubtree;
    }
    return ancestorPaths(candidate.resource.fsPath, subtree.resource.fsPath).length > 0;
  }

  // `_map` deliberately retains node identities, so removing/retyping a loaded folder must explicitly
  // retire Modified sources below it. It also invalidates child-list membership so an in-flight hash from
  // the vanished subtree fails `_contentCandidateIsCurrent` and cannot resurrect a parent badge.
  private _dropCachedSubtree(subtree: ExplorerItem, includeSubtreeSource: boolean): void {
    Array.from(this._modifiedSources).forEach(sourceKey => {
      const source = this._map.get(sourceKey);
      if (
        !source ||
        this._isInsideCachedSubtree(source, subtree, includeSubtreeSource)
      ) {
        this._modifiedSources.delete(sourceKey);
      }
    });
    Array.from(this._listedChildren.keys()).forEach(parentKey => {
      const listedParent = this._map.get(parentKey);
      if (
        !listedParent ||
        this._isInsideCachedSubtree(listedParent, subtree, true)
      ) {
        this._listedChildren.delete(parentKey);
      }
    });
  }

  // Replace one directory's known children, update the direct-M source set, then derive every recursive
  // ancestor badge from scratch. Rebuilding the small set is less error-prone than reference counts when
  // a child vanishes, changes type, or is re-created under the same URI.
  private _recordCompleteListing(parent: ExplorerItem, items: ExplorerItem[]): vscode.Uri[] {
    const parentKey = parent.resource.uri.query;
    const current = new Set(items.map(i => i.resource.uri.query));
    const previous = this._listedChildren.get(parentKey);
    if (previous) {
      previous.forEach(key => {
        if (!current.has(key)) {
          const missing = this._map.get(key);
          if (missing) {
            this._dropCachedSubtree(missing, true);
          } else {
            this._modifiedSources.delete(key);
          }
        }
      });
    }
    items.forEach(child => {
      const key = child.resource.uri.query;
      const status = (child as ExplorerChild).status;
      // A file can never retain loaded children. Nor can a folder that now exists on only one side or has
      // a type conflict retain old cross-side Modified descendants from an earlier incarnation.
      if (
        !child.isDirectory ||
        status === NodeStatus.LocalOnly ||
        status === NodeStatus.RemoteOnly ||
        status === NodeStatus.Conflict
      ) {
        this._dropCachedSubtree(child, false);
      }
      if (status === NodeStatus.Modified) {
        this._modifiedSources.add(key);
      } else {
        this._modifiedSources.delete(key);
      }
    });
    this._listedChildren.set(parentKey, current);
    return this._recomputeModifiedAncestors();
  }

  private _setModifiedSource(item: ExplorerItem, modified: boolean): vscode.Uri[] {
    const key = item.resource.uri.query;
    if (modified) {
      this._modifiedSources.add(key);
    } else {
      this._modifiedSources.delete(key);
    }
    return this._recomputeModifiedAncestors();
  }

  private _recomputeModifiedAncestors(): vscode.Uri[] {
    const ancestorKeys = new Set<string>();
    this._modifiedSources.forEach(sourceKey => {
      const source = this._map.get(sourceKey);
      if (!source) {
        return;
      }
      const root = this.findRoot(source.resource.uri);
      if (!root) {
        return;
      }
      const rootPath = root.resource.fsPath;
      let memo = this._ancestorKeyMemo.get(sourceKey);
      if (!memo || memo.rootPath !== rootPath) {
        // Rebuilt only when the source is new to us or its root's remotePath changed.
        memo = {
          rootPath,
          keys: ancestorPaths(source.resource.fsPath, rootPath).map(
            path => UResource.updateResource(source.resource, { remotePath: path }).uri.query
          ),
        };
        this._ancestorKeyMemo.set(sourceKey, memo);
      }
      memo.keys.forEach(key => {
        if (this._map.has(key)) {
          ancestorKeys.add(key);
        }
      });
    });

    const changed: vscode.Uri[] = [];
    this._map.forEach((node, key) => {
      const next = ancestorKeys.has(key);
      if (!!node.hasModifiedDescendant !== next) {
        node.hasModifiedDescendant = next || undefined;
        changed.push(node.resource.uri);
      }
    });
    return changed;
  }

  private _queueContentChecks(
    remoteFs: FileSystem,
    localFs: FileSystem,
    candidates: ContentCheckCandidate[],
    parent: ExplorerItem
  ): void {
    const generation = this._genOf(parent.resource.uri.query);
    candidates.forEach(candidate => {
      const itemKey = candidate.item.resource.uri.query;
      const marker = `${generation}\0${candidate.key}`;
      if (this._checkingContent.get(itemKey) === marker) {
        return;
      }
      this._checkingContent.set(itemKey, marker);
      this._contentScheduler.add(async () => {
        try {
          await this._verifyContentCandidate(
            remoteFs,
            localFs,
            candidate,
            parent,
            generation,
            marker
          );
        } catch (e) {
          logger.warn(
            `remoteExplorer: content check failed for ${candidate.remotePath}: ${
              (e && (e as Error).message) || e
            }`
          );
        } finally {
          if (this._checkingContent.get(itemKey) === marker) {
            this._checkingContent.delete(itemKey);
          }
        }
      });
    });
  }

  private _contentCandidateIsCurrent(
    candidate: ContentCheckCandidate,
    parentKey: string,
    generation: number,
    marker: string
  ): boolean {
    const itemKey = candidate.item.resource.uri.query;
    const children = this._listedChildren.get(parentKey);
    return (
      generation === this._genOf(parentKey) &&
      this._checkingContent.get(itemKey) === marker &&
      this._map.get(itemKey) === candidate.item &&
      (candidate.item as ExplorerChild).contentVerificationKey === candidate.key &&
      !!children &&
      children.has(itemKey)
    );
  }

  private async _verifyContentCandidate(
    remoteFs: FileSystem,
    localFs: FileSystem,
    candidate: ContentCheckCandidate,
    parent: ExplorerItem,
    generation: number,
    marker: string
  ): Promise<void> {
    const parentKey = parent.resource.uri.query;
    if (!this._contentCandidateIsCurrent(candidate, parentKey, generation, marker)) {
      return;
    }

    // Ask the server first. On FTP/minimal servers this returns null immediately, avoiding a pointless
    // full local read when no server digest exists to compare it with.
    const remoteMd5 = await serverFileMd5(remoteFs, candidate.remotePath);
    if (!this._contentCandidateIsCurrent(candidate, parentKey, generation, marker)) {
      return;
    }
    let verdict: ContentVerification['verdict'] = 'unavailable';
    if (remoteMd5) {
      const localMd5 = await localFileMd5(candidate.localPath);
      if (!this._contentCandidateIsCurrent(candidate, parentKey, generation, marker)) {
        return;
      }
      if (localMd5) {
        verdict = remoteMd5 === localMd5 ? 'equal' : 'different';
      }
    }

    if (verdict === 'equal') {
      // Confirm the remote listing snapshot before copying its mtime. If the server file changed during
      // hashing, discard both the verdict and cached listing and let the ordinary background list retry.
      try {
        const currentRemote = await remoteFs.lstat(candidate.remotePath);
        if (!this._contentCandidateIsCurrent(candidate, parentKey, generation, marker)) {
          return;
        }
        if (
          currentRemote.type !== FileType.File ||
          currentRemote.size !== candidate.remoteSize ||
          currentRemote.mtime !== candidate.remoteMtime
        ) {
          this._remoteListing.delete(parentKey);
          this._listingFailed.delete(parentKey);
          this._onDidChangeFolder.fire(parent);
          return;
        }
      } catch (e) {
        // The hashes still prove equality for the bytes just read, so keep the correct status; only skip
        // timestamp alignment when the server snapshot can no longer be validated. Caching the verdict also
        // avoids an endless hash/re-list loop on a server that permits reading but rejects SFTP lstat.
        logger.debug(
          `remoteExplorer: skip local mtime alignment for ${candidate.remotePath}: ${
            (e && (e as Error).message) || e
          }`
        );
        if (this._contentCandidateIsCurrent(candidate, parentKey, generation, marker)) {
          this._publishContentVerdict(candidate, parent, verdict);
        }
        return;
      }

      let autoUploadGuard: { applied(): void; cancel(): void } | undefined;
      try {
        const aligned = await alignLocalMtimeIfUnchanged(
          localFs,
          candidate.localPath,
          candidate.localSize,
          candidate.localMtime,
          candidate.remoteMtime,
          () => {
            // Arm the watcher guard only after fstat proved the file unchanged and immediately before the
            // metadata write. This leaves no broad window in which a genuine edit could be suppressed.
            autoUploadGuard = suppressAutoUploadForMtime(
              candidate.localPath,
              candidate.remoteMtime
            );
          }
        );
        if (!aligned) {
          // The local file changed after hashing. Do not publish the stale equality verdict; a parent
          // re-render re-lists local metadata and queues a fresh check when it is still needed.
          this._onDidChangeFolder.fire(parent);
          return;
        }
        if (autoUploadGuard) {
          autoUploadGuard.applied();
        }
        (candidate.item as ExplorerChild).localMtime = candidate.remoteMtime;
      } catch (e) {
        if (autoUploadGuard) {
          autoUploadGuard.cancel();
        }
        // Read-only filesystems may refuse futimes. Equality remains valid and is cached for this exact
        // snapshot; a later explicit refresh may retry the alignment.
        logger.debug(
          `remoteExplorer: couldn't align local mtime for ${candidate.localPath}: ${
            (e && (e as Error).message) || e
          }`
        );
      }
    }

    if (!this._contentCandidateIsCurrent(candidate, parentKey, generation, marker)) {
      return;
    }
    this._publishContentVerdict(candidate, parent, verdict);
  }

  private _publishContentVerdict(
    candidate: ContentCheckCandidate,
    parent: ExplorerItem,
    verdict: ContentVerification['verdict']
  ): void {
    const child = candidate.item as ExplorerChild;
    child.contentVerification = { key: candidate.key, verdict };
    child.status = verdict === 'equal' ? NodeStatus.Synced : NodeStatus.Modified;
    const ancestorChanges = this._setModifiedSource(
      candidate.item,
      child.status === NodeStatus.Modified
    );
    this._onDidChangeDecorations.fire(
      this._uniqueUris([candidate.item.resource.uri].concat(ancestorChanges))
    );
    // Re-read the local listing after a successful timestamp alignment and rebuild the file description
    // (equal-size M rows show both sides). Cached server entries make this a local-only operation.
    this._onDidChangeFolder.fire(parent);
  }

  // Fetch a directory's server listing exactly once, SHARING the in-flight promise across the instant
  // (background) and complete (navigation) paths so the same directory is never listed twice concurrently.
  // A "not found" becomes an EMPTY server side (a local-only directory has no server path) so navigation into
  // it doesn't crash; other errors propagate to the caller. A generation guard prevents a slow pre-refresh
  // listing from publishing its stale result into a cache refresh() has since cleared.
  private _fetchRemoteListing(
    fileService: FileService,
    config: ServiceConfig,
    remotePath: string,
    key: string
  ): Promise<FileEntry[]> {
    const cached = this._remoteListing.get(key);
    if (cached !== undefined) {
      return Promise.resolve(cached);
    }
    const inflight = this._remoteInflight.get(key);
    if (inflight) {
      return inflight;
    }
    const gen = this._genOf(key);
    const p = (async () => {
      const remotefs = await fileService.getRemoteFileSystem(config);
      let entries: FileEntry[];
      try {
        entries = await remotefs.list(remotePath);
      } catch (e) {
        if (isNotFoundListing(e)) {
          entries = []; // local-only directory (or vanished) — show its local children, don't crash
        } else {
          throw e; // permission denied / I/O — the caller decides how to surface it
        }
      }
      if (gen === this._genOf(key) && !this._elevatedKeys.has(key)) {
        this._remoteListing.set(key, entries);
      }
      return entries;
    })();
    this._remoteInflight.set(key, p);
    const clear = () => {
      if (this._remoteInflight.get(key) === p) {
        this._remoteInflight.delete(key);
      }
    };
    p.then(clear, clear);
    return p;
  }

  // Kick a background fetch for the instant (local-first) path: show a status-bar spinner and, when the
  // listing lands, re-render the parent so getChildren merges the server side in. On failure don't leave the
  // folder silently empty — mark it Unknown ("?") and re-render so the user sees the server side isn't shown.
  private _kickRemoteListing(
    fileService: FileService,
    config: ServiceConfig,
    remotePath: string,
    key: string,
    item: ExplorerItem
  ): void {
    if (this._remoteListing.has(key) || this._listingFailed.has(key)) {
      return; // already resolved, or a prior fetch failed — don't loop re-fetching a no-access folder
    }
    const alreadyInFlight = this._remoteInflight.has(key);
    const p = this._fetchRemoteListing(fileService, config, remotePath, key);
    if (alreadyInFlight) {
      return; // another expand already owns the spinner + the re-render
    }
    // Capture the generation so a listing that finishes AFTER a refresh can't clobber the fresh state.
    const gen = this._genOf(key);
    vscode.window
      .withProgress(
        {
          location: vscode.ProgressLocation.Window,
          title: L({
            en: 'WireFerry: loading the server listing…',
            ru: 'WireFerry: загружаю список с сервера…',
          }),
        },
        () => p
      )
      .then(
        () => {
          if (gen !== this._genOf(key)) {
            return; // a refresh superseded this listing — ignore its completion
          }
          if (this._elevatedKeys.has(key)) {
            return; // an elevated "View as root" listing already owns this key — leave its state alone
          }
          // Success — clear the failed marker and any prior "no access"/"unknown" badge (the folder became
          // listable again, e.g. after permissions changed or a transient error cleared).
          this._listingFailed.delete(key);
          const c = item as ExplorerChild;
          if (c.status === NodeStatus.Denied || c.status === NodeStatus.Unknown) {
            c.status = undefined;
            this._onDidChangeDecorations.fire([item.resource.uri]);
          }
          this._onDidChangeFolder.fire(item);
        },
        e => {
          if (gen !== this._genOf(key)) {
            return; // stale failure — don't stamp Denied over a newer, successful state
          }
          if (this._elevatedKeys.has(key)) {
            return; // an elevated "View as root" listing already succeeded here — don't stamp Denied over it
          }
          // Record the failure so re-renders don't loop re-fetching, and surface it instead of a silent
          // empty folder. Mark Denied (yellow, "right-click View as root") ONLY when elevation is possible
          // (SFTP with a shell); on FTP a permission error can't be escalated, so use Unknown ("?") to
          // avoid a dead-end hint.
          this._listingFailed.add(key);
          const denied = isPermissionDeniedListing(e) && config.protocol === 'sftp';
          (item as ExplorerChild).status = denied ? NodeStatus.Denied : NodeStatus.Unknown;
          this._onDidChangeDecorations.fire([item.resource.uri]);
          this._onDidChangeFolder.fire(item);
          logger.warn(
            `remoteExplorer: server listing failed for ${remotePath}: ${(e && (e as Error).message) || e}`
          );
        }
      );
  }

  // Compute the current user's write access for each file in the listing and store it on the node (for
  // the dimmed decoration + the tooltip "Your access: …" line). Needs one `id` per connection (memoized
  // on the client). De-duped per parent; only files whose flag is still unknown are (re)computed, so the
  // re-render this triggers finds them all set and does nothing — no loop. Folders/symlinks are skipped
  // (a folder's writability is a different, w+x question). Silent on FTP / when identity can't be read.
  private async _applyWriteHints(
    remotefs: FileSystem,
    items: ExplorerItem[],
    parent: ExplorerItem
  ): Promise<void> {
    const parentKey = parent.resource.uri.query;
    if (this._hintingWrite.has(parentKey)) {
      return;
    }
    const client: any = (remotefs as any).getClient ? (remotefs as any).getClient() : null;
    if (!client || typeof client.getIdentity !== 'function') {
      return; // FTP / no shell — no identity to compare against
    }
    const need = items.filter(i => {
      const c = i as ExplorerChild;
      return (
        !i.isDirectory &&
        !c.isSymbolicLink &&
        (c.writable === undefined || c.readable === undefined) &&
        typeof c.mode === 'number'
      );
    });
    if (need.length === 0) {
      return;
    }
    this._hintingWrite.add(parentKey);
    try {
      const id: UserIdentity = await client.getIdentity();
      // root can write everything — no RO badges, and the "via group/world" note would misdescribe the
      // real reason (it's the root override). Skip hints entirely.
      if (id.uid === 0) {
        return;
      }
      const changed: vscode.Uri[] = [];
      for (const it of need) {
        const c = it as ExplorerChild;
        const writable = canUserWrite(c.mode as number, c.uid, c.gid, id);
        const readable = canUserRead(c.mode as number, c.uid, c.gid, id);
        if (writable === undefined && readable === undefined) {
          continue; // owner/group unknown for this entry — make no claim
        }
        const rel = relationTo(c.uid, c.gid, id) as OwnershipRelation;
        c.writable = writable;
        c.readable = readable;
        if (writable !== undefined) {
          c.accessNote = buildAccessNote(rel, writable, readable, c.group);
        }
        changed.push(c.resource.uri);
      }
      if (changed.length > 0) {
        this._onDidChangeDecorations.fire(changed);
        // Re-render the parent so getTreeItem rebuilds tooltips with the new access note.
        this._onDidChangeFolder.fire(parent);
      }
    } catch (e) {
      logger.debug(`write-permission hints skipped: ${(e && (e as Error).message) || e}`);
    } finally {
      this._hintingWrite.delete(parentKey);
    }
  }

  // Recompute one file's write hint after its mode/ownership changed via our own chmod/chown, so the RO
  // decoration + tooltip update at once instead of waiting for the next folder expand. Clears the hint
  // (neutral, no badge) when it can't be determined — unknown identity/uid/gid, root, FTP, or a folder.
  async recomputeWriteHint(item: ExplorerItem): Promise<void> {
    const c = item as ExplorerChild;
    const uri = item.resource.uri;
    const clear = () => {
      c.writable = undefined;
      c.readable = undefined;
      c.accessNote = undefined;
      this._onDidChangeDecorations.fire([uri]);
    };
    if (item.isDirectory || c.isSymbolicLink || typeof c.mode !== 'number') {
      clear();
      return;
    }
    const root = this.findRoot(uri);
    if (!root) {
      clear();
      return;
    }
    try {
      const config = root.explorerContext.config;
      const remotefs = await root.explorerContext.fileService.getRemoteFileSystem(config);
      const client: any = (remotefs as any).getClient ? (remotefs as any).getClient() : null;
      if (!client || typeof client.getIdentity !== 'function') {
        clear();
        return;
      }
      const id: UserIdentity = await client.getIdentity();
      const writable = id.uid === 0 ? undefined : canUserWrite(c.mode as number, c.uid, c.gid, id);
      const readable = id.uid === 0 ? undefined : canUserRead(c.mode as number, c.uid, c.gid, id);
      if (writable === undefined && readable === undefined) {
        clear();
        return;
      }
      const rel = relationTo(c.uid, c.gid, id) as OwnershipRelation;
      c.writable = writable;
      c.readable = readable;
      if (writable !== undefined) {
        c.accessNote = buildAccessNote(rel, writable, readable, c.group);
      }
      this._onDidChangeDecorations.fire([uri]);
      this._onDidChangeFolder.fire(item);
    } catch (e) {
      clear();
    }
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
      existing.typePinned = true; // trust this type over the next (possibly stale) server listing
      return existing;
    }
    const node: ExplorerChild = { resource, isDirectory, typePinned: true };
    this._map.set(resource.uri.query, node);
    return node;
  }

  async getParent(item: TreeNode): Promise<ExplorerItem | undefined> {
    if (isNoticeItem(item)) {
      return item.parent;
    }
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
      // Populate the new parent's children. Tolerate a listing failure (e.g. a local-only or no-access
      // directory) — getParent must still return the node so reveal/refresh don't throw.
      await this.getChildrenComplete(newMapItem).catch(() => undefined);
      return newMapItem;
    }
  }

  getRoots(): ExplorerRoot[] {
    return this._getRoots();
  }

  findRoot(uri: vscode.Uri): ExplorerRoot | null | undefined {
    // refresh() nulls _rootsMap; if a DEEP node is queried (e.g. VS Code restoring an expanded `/root` after
    // a delete-triggered refresh) before the root level rebuilds it, we must (re)build it lazily here — else
    // findRoot would spuriously fail with "Can't find config for remote resource". _getRoots() is the same
    // builder getChildren uses and is a no-op once built.
    if (!this._rootsMap) {
      this._getRoots();
    }
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
    // Roots are being rebuilt, so a root's remotePath may differ from what the memo was keyed on.
    this._ancestorKeyMemo.clear();
    // Deliberately NOT clearing _map here: refresh() relies on the retained nodes (identity + confirmed-M
    // state) so a full refresh doesn't blank every badge. _addRoot re-seeds the root nodes by key below;
    // child nodes are re-used by the next merge. (Nodes under a removed config are harmless orphans that
    // are never rendered — no path leads to them from the rebuilt roots.)
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
        // Plain config (or profiles-as-roots disabled): a single root for the active/only config. Carry the
        // ACTIVE profile name (when the config defines profiles) into the root identity — otherwise the two
        // profiles of one service share the same URI key (remoteId + fsPath), and after Set Profile the
        // retained _map nodes of the PREVIOUS profile would be adopted by the new root: cross-profile M / RO
        // / 🔒 and, via Upload Modified, a write to the wrong host. A distinct key makes the old nodes
        // orphan (findRoot returns null for them), so they neither render nor upload.
        const activeProfile = profiles.length > 0 ? app.state.profile || undefined : undefined;
        try {
          this._addRoot(fileService, fileService.getConfig(), activeProfile);
        } catch (e) {
          logger.warn(`remoteExplorer: skip root: ${(e && (e as Error).message) || e}`);
        }
      }
    });
    this._roots.sort(
      (a, b) =>
        a.explorerContext.config.remoteExplorer.order - b.explorerContext.config.remoteExplorer.order ||
        nameCollator.compare(a.explorerContext.fileService.name || '', b.explorerContext.fileService.name || '') ||
        nameCollator.compare(a.explorerContext.profile || '', b.explorerContext.profile || '')
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
