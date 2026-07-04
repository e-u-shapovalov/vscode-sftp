import { Uri, window, ProgressLocation, CancellationToken } from 'vscode';
import * as fse from 'fs-extra';
import * as nodePath from 'path';
import { COMMAND_TREE } from '../constants';
import { upath, FileType, FileSystem } from '../core';
import { handleCtxFromUri } from '../fileHandlers';
import { reportError } from '../helper';
import logger from '../logger';
import { ExplorerItem } from '../modules/remoteExplorer';
import { checkCommand } from './abstract/createCommand';
import { openTextReport } from '../ui/operationReport';
import { L } from '../i18n';

// How much of a tree we're willing to build before calling it quits — a runaway server folder (or a
// deep node_modules) must never hang the notification or blow up the report tab. Hit this and we stop
// walking and mark the output truncated.
const MAX_ENTRIES = 20000;

// What to include in the drawing. Files-only vs files+sizes vs folders-only maps 1:1 to the three
// buttons in the first prompt.
type TreeMode = 'folders' | 'files' | 'filesSizes';

interface TreeNode {
  name: string;
  isDir: boolean;
  // Own size for files; recursively accumulated size for folders (only what we actually walked).
  size: number;
  children?: TreeNode[];
  // True on a folder whose contents we didn't descend into because the depth limit was reached.
  depthCut?: boolean;
}

// Shared counter/flag threaded through the whole walk so the entry cap and cancellation are honoured
// across the entire tree, not per-directory.
interface WalkState {
  count: number;
  truncated: boolean;
  token: CancellationToken;
  onTick: (count: number) => void;
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value >= 10 || i === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[i]}`;
}

// Folders first, then files, each group sorted case-insensitively — a stable, predictable order that
// doesn't depend on the protocol's listing order or the tree's sort-by-size toggle.
function sortNodes(nodes: TreeNode[]): TreeNode[] {
  return nodes.sort((a, b) => {
    if (a.isDir !== b.isDir) {
      return a.isDir ? -1 : 1;
    }
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });
}

// depthLeft: how many more levels we may descend. 0 means "list this dir's own children but don't go
// deeper" — we still show the children, just mark any sub-folders as depthCut. Infinity = no limit.
async function buildRemote(
  remoteFs: FileSystem,
  dir: string,
  depthLeft: number,
  mode: TreeMode,
  state: WalkState
): Promise<TreeNode[]> {
  if (state.token.isCancellationRequested || state.count >= MAX_ENTRIES) {
    if (state.count >= MAX_ENTRIES) state.truncated = true;
    return [];
  }

  let entries;
  try {
    entries = await remoteFs.list(dir);
  } catch (e) {
    // An unreadable directory (permissions, vanished) just renders empty — never abort the whole tree.
    logger.info(`tree: list failed for ${dir}: ${(e && (e as Error).message) || String(e)}`);
    return [];
  }

  const nodes: TreeNode[] = [];
  for (const entry of entries) {
    if (state.token.isCancellationRequested) break;
    if (state.count >= MAX_ENTRIES) {
      state.truncated = true;
      break;
    }
    const isDir = entry.type === FileType.Directory;
    if (!isDir && mode === 'folders') {
      continue;
    }
    state.count += 1;
    state.onTick(state.count);

    if (isDir) {
      const node: TreeNode = { name: entry.name, isDir: true, size: 0 };
      if (depthLeft > 0) {
        node.children = await buildRemote(remoteFs, entry.fspath, depthLeft - 1, mode, state);
        node.size = node.children.reduce((sum, c) => sum + c.size, 0);
      } else {
        node.depthCut = true;
      }
      nodes.push(node);
    } else {
      nodes.push({ name: entry.name, isDir: false, size: entry.size || 0 });
    }
  }
  return sortNodes(nodes);
}

// Local twin of buildRemote, walking with Node's fs so a local-Explorer click needs no SFTP config.
async function buildLocal(
  dir: string,
  depthLeft: number,
  mode: TreeMode,
  state: WalkState
): Promise<TreeNode[]> {
  if (state.token.isCancellationRequested || state.count >= MAX_ENTRIES) {
    if (state.count >= MAX_ENTRIES) state.truncated = true;
    return [];
  }

  let entries: any[];
  try {
    entries = await (fse.readdir as any)(dir, { withFileTypes: true });
  } catch (e) {
    logger.info(`tree: readdir failed for ${dir}: ${(e && (e as Error).message) || String(e)}`);
    return [];
  }

  const nodes: TreeNode[] = [];
  for (const entry of entries) {
    if (state.token.isCancellationRequested) break;
    if (state.count >= MAX_ENTRIES) {
      state.truncated = true;
      break;
    }
    const isDir = entry.isDirectory();
    // Symlinks and special files count as leaves; don't follow them (no loops / double counting).
    if (!isDir && !entry.isFile()) {
      continue;
    }
    if (!isDir && mode === 'folders') {
      continue;
    }
    state.count += 1;
    state.onTick(state.count);

    const full = nodePath.join(dir, entry.name);
    if (isDir) {
      const node: TreeNode = { name: entry.name, isDir: true, size: 0 };
      if (depthLeft > 0) {
        node.children = await buildLocal(full, depthLeft - 1, mode, state);
        node.size = node.children.reduce((sum, c) => sum + c.size, 0);
      } else {
        node.depthCut = true;
      }
      nodes.push(node);
    } else {
      let size = 0;
      if (mode === 'filesSizes') {
        try {
          size = (await fse.stat(full)).size;
        } catch (e) {
          // unreadable file — count it, but with no size
        }
      }
      nodes.push({ name: entry.name, isDir: false, size });
    }
  }
  return sortNodes(nodes);
}

// Render the collected nodes into the classic ├─ / └─ / │ ASCII tree. Sizes (when asked) go right of
// the name; no attempt at column alignment across differing prefixes — a couple of spaces reads fine.
function renderNodes(nodes: TreeNode[], prefix: string, mode: TreeMode, lines: string[]): void {
  nodes.forEach((node, i) => {
    const last = i === nodes.length - 1;
    const branch = last ? '└─ ' : '├─ ';
    let label = node.isDir ? `${node.name}/` : node.name;
    if (mode === 'filesSizes' && (node.isDir ? node.size > 0 : true)) {
      label += `  ${humanSize(node.size)}`;
    }
    lines.push(prefix + branch + label);

    const childPrefix = prefix + (last ? '   ' : '│  ');
    if (node.isDir && node.children && node.children.length > 0) {
      renderNodes(node.children, childPrefix, mode, lines);
    } else if (node.isDir && node.depthCut) {
      lines.push(`${childPrefix}└─ …`);
    }
  });
}

// First prompt: how to draw. Returns the chosen mode, or undefined when cancelled.
async function askMode(name: string): Promise<TreeMode | undefined> {
  const withFiles = L({ en: 'With files', ru: 'С файлами' });
  const withSizes = L({ en: 'With files and sizes', ru: 'С файлами и размерами' });
  const foldersOnly = L({ en: 'Folders only', ru: 'Только папки' });
  const pick = await window.showInformationMessage(
    L({ en: `Draw the tree of "${name}" — how?`, ru: `Нарисовать дерево «${name}» — как?` }),
    { modal: true },
    withFiles,
    withSizes,
    foldersOnly
  );
  if (pick === withFiles) return 'files';
  if (pick === withSizes) return 'filesSizes';
  if (pick === foldersOnly) return 'folders';
  return undefined;
}

// Second prompt: max depth. Empty or 0 means "no limit" (still bounded by MAX_ENTRIES). Returns the
// depth as a number (Infinity for unlimited), or undefined when cancelled.
async function askDepth(): Promise<number | undefined> {
  const answer = await window.showInputBox({
    prompt: L({
      en: 'Max tree depth (empty or 0 = no limit)',
      ru: 'Максимальная глубина дерева (пусто или 0 = без ограничения)',
    }),
    value: '100',
    validateInput: value => {
      const v = value.trim();
      if (v === '') return undefined;
      return /^\d+$/.test(v)
        ? undefined
        : L({ en: 'Enter a non-negative whole number', ru: 'Введите целое неотрицательное число' });
    },
  });
  if (answer === undefined) return undefined; // cancelled
  const v = answer.trim();
  if (v === '' || v === '0') return Infinity;
  return parseInt(v, 10);
}

function modeLabel(mode: TreeMode): string {
  if (mode === 'files') return L({ en: 'with files', ru: 'с файлами' });
  if (mode === 'filesSizes') return L({ en: 'with files + sizes', ru: 'с файлами и размерами' });
  return L({ en: 'folders only', ru: 'только папки' });
}

function depthLabel(depth: number): string {
  return depth === Infinity
    ? L({ en: 'no depth limit', ru: 'без ограничения глубины' })
    : L({ en: `depth ${depth}`, ru: `глубина ${depth}` });
}

export default checkCommand({
  id: COMMAND_TREE,
  async handleCommand(item) {
    // createCommand swallows the returned promise, so route our own failures to reportError.
    try {
      // Two entry points: a local-Explorer folder arrives as a `file:` Uri (walk it with Node fs, no
      // config needed); a Remote Explorer item (or a `remote:` Uri) is walked over the connection.
      let uri: Uri | undefined;
      if (item instanceof Uri) {
        uri = item;
      } else if (item && (item as ExplorerItem).resource) {
        uri = (item as ExplorerItem).resource.uri;
      }
      if (!uri) {
        return;
      }
      const isRemote = uri.scheme !== 'file';

      // Resolve the display name + the path/fs we'll walk before prompting, so a bad target fails fast.
      let name: string;
      let rootPath: string;
      let remoteFs: FileSystem | undefined;
      if (isRemote) {
        const ctx = handleCtxFromUri(uri);
        remoteFs = await ctx.fileService.getRemoteFileSystem(ctx.config);
        rootPath = ctx.target.remoteFsPath;
        name = upath.basename(rootPath) || rootPath;
      } else {
        rootPath = uri.fsPath;
        name = nodePath.basename(rootPath) || rootPath;
      }

      const mode = await askMode(name);
      if (mode === undefined) {
        return;
      }
      const depth = await askDepth();
      if (depth === undefined) {
        return;
      }

      await window.withProgress(
        {
          location: ProgressLocation.Notification,
          title: L({ en: `WireFerry: building tree of "${name}"…`, ru: `WireFerry: строю дерево «${name}»…` }),
          cancellable: true,
        },
        async (progress, token) => {
          let lastReport = 0;
          const state: WalkState = {
            count: 0,
            truncated: false,
            token,
            onTick: count => {
              const now = Date.now();
              if (now - lastReport < 150) return;
              lastReport = now;
              progress.report({ message: L({ en: `${count} entries…`, ru: `записей: ${count}…` }) });
            },
          };

          // depth is a level count from the root's children; buildRemote's depthLeft descends by 1 per
          // level, so pass depth-1 (Infinity-1 is still Infinity).
          const rootDepthLeft = depth === Infinity ? Infinity : depth - 1;
          const nodes =
            isRemote && remoteFs
              ? await buildRemote(remoteFs, rootPath, rootDepthLeft, mode, state)
              : await buildLocal(rootPath, rootDepthLeft, mode, state);

          if (token.isCancellationRequested) {
            return;
          }

          const header = L({
            en: `Tree — ${rootPath}   [${modeLabel(mode)}, ${depthLabel(depth)}]`,
            ru: `Дерево — ${rootPath}   [${modeLabel(mode)}, ${depthLabel(depth)}]`,
          });
          const lines: string[] = [header, '='.repeat(Math.max(20, header.length)), '', `${name}/`];
          renderNodes(nodes, '', mode, lines);
          if (state.truncated) {
            lines.push('');
            lines.push(
              L({
                en: `… stopped at ${MAX_ENTRIES} entries — folder too large to draw in full`,
                ru: `… остановлено на ${MAX_ENTRIES} записях — папка слишком большая для полной отрисовки`,
              })
            );
          }

          await openTextReport('tree.txt', lines.join('\n'));
        }
      );
    } catch (error) {
      reportError(error);
    }
  },
});
