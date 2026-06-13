import { Uri, window, ProgressLocation, CancellationToken } from 'vscode';
import * as fse from 'fs-extra';
import * as nodePath from 'path';
import { COMMAND_REMOTEEXPLORER_CALC_FOLDER_SIZE } from '../constants';
import { upath, FileType, FileSystem } from '../core';
import { handleCtxFromUri } from '../fileHandlers';
import { reportError } from '../helper';
import { ExplorerItem } from '../modules/remoteExplorer';
import { checkCommand } from './abstract/createCommand';
import { openTextReport } from '../ui/operationReport';
import { L } from '../i18n';

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

// "12000000000" -> "12 000 000 000" (space-grouped exact byte count, easy to read/verify).
function groupDigits(n: number): string {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

// "12 000 000 000 байт (12 GB)" — exact bytes + human form.
function sizeDetail(bytes: number): string {
  return L({
    en: `${groupDigits(bytes)} bytes (${humanSize(bytes)})`,
    ru: `${groupDigits(bytes)} байт (${humanSize(bytes)})`,
  });
}

// "755 (rwxr-xr-x)" from Unix mode bits.
function formatPerm(mode: number): string {
  // tslint:disable-next-line:no-bitwise
  const bits = mode & 0o777;
  const octal = bits.toString(8).padStart(3, '0');
  const sym = [0o400, 0o200, 0o100, 0o040, 0o020, 0o010, 0o004, 0o002, 0o001]
    // tslint:disable-next-line:no-bitwise
    .map((b, i) => (bits & b ? 'rwx'[i % 3] : '-'))
    .join('');
  return `${octal} (${sym})`;
}

interface SizeAcc {
  files: number;
  folders: number;
  bytes: number;
}

// Fast path: total the directory server-side with one `du`. Prefer apparent bytes (`-sb`, GNU/Linux)
// so the count is byte-exact and matches summing file sizes; fall back to KB blocks (`-sk`, POSIX).
// Returns null when not possible (no exec channel, no `du`, non-zero exit) so the caller can walk.
async function serverDuBytes(remoteFs: FileSystem, remotePath: string): Promise<number | null> {
  const client = (remoteFs as any).getClient ? (remoteFs as any).getClient() : null;
  if (!client || typeof client.exec !== 'function') {
    return null;
  }
  // Never let the path break out of the single-quoted shell argument.
  if (/[\r\n\0]/.test(remotePath)) {
    return null;
  }
  const quoted = `'${remotePath.replace(/'/g, `'\\''`)}'`;
  const attempts: Array<{ cmd: string; toBytes: (n: number) => number }> = [
    { cmd: `du -sb ${quoted}`, toBytes: n => n },
    { cmd: `du -sk ${quoted}`, toBytes: n => n * 1024 },
  ];
  for (const attempt of attempts) {
    try {
      const out = await client.exec(attempt.cmd);
      const n = parseInt(String(out).trim().split(/\s+/)[0], 10);
      if (Number.isFinite(n)) {
        return attempt.toBytes(n);
      }
    } catch (e) {
      // try the next form
    }
  }
  return null;
}

// Fallback: walk the remote tree over the active protocol (FTP, or SFTP without `du`).
async function walkRemoteSize(
  remoteFs: FileSystem,
  dir: string,
  token: CancellationToken,
  acc: SizeAcc,
  onTick: () => void
): Promise<void> {
  const entries = await remoteFs.list(dir);
  for (const entry of entries) {
    if (token.isCancellationRequested) {
      return;
    }
    if (entry.type === FileType.Directory) {
      acc.folders += 1;
      await walkRemoteSize(remoteFs, entry.fspath, token, acc, onTick);
    } else {
      acc.files += 1;
      acc.bytes += entry.size || 0;
    }
    onTick();
  }
}

// Sum the local copy with Node's fs — fs.stat().size is the byte-exact apparent size on Windows,
// Linux and macOS alike. Symlinks are counted as entries but not followed (no loops / double count).
async function localDirSize(dir: string, token: CancellationToken): Promise<SizeAcc | null> {
  const acc: SizeAcc = { files: 0, folders: 0, bytes: 0 };
  async function walk(d: string): Promise<void> {
    const entries: any[] = await (fse.readdir as any)(d, { withFileTypes: true });
    for (const entry of entries) {
      if (token.isCancellationRequested) {
        return;
      }
      const full = nodePath.join(d, entry.name);
      if (entry.isDirectory()) {
        acc.folders += 1;
        await walk(full);
      } else if (entry.isFile()) {
        acc.files += 1;
        try {
          acc.bytes += (await fse.stat(full)).size;
        } catch (e) {
          // unreadable file — skip its size
        }
      }
      // symlinks and special files: counted as neither file nor folder, never followed
    }
  }
  try {
    await walk(dir);
    return acc;
  } catch (e) {
    return null;
  }
}

export default checkCommand({
  id: COMMAND_REMOTEEXPLORER_CALC_FOLDER_SIZE,
  async handleCommand(item) {
    // createCommand swallows the returned promise, so route our own failures to reportError.
    try {
      let uri: Uri | undefined;
      if (item instanceof Uri) {
        uri = item;
      } else if (item && (item as ExplorerItem).resource) {
        uri = (item as ExplorerItem).resource.uri;
      }
      if (!uri) {
        return;
      }

      const ctx = handleCtxFromUri(uri);
      const remoteFs = await ctx.fileService.getRemoteFileSystem(ctx.config);
      const remotePath = ctx.target.remoteFsPath;
      const localPath = ctx.target.localFsPath;
      const name = upath.basename(remotePath) || remotePath;

      await window.withProgress(
        {
          location: ProgressLocation.Notification,
          title: L({ en: `WireFerry: sizing "${name}"…`, ru: `WireFerry: считаю размер «${name}»…` }),
          cancellable: true,
        },
        async (progress, token) => {
          // ── Server side: permissions + size ──────────────────────────────────────────────
          let serverMode: number | undefined;
          try {
            serverMode = (await remoteFs.lstat(remotePath)).mode;
          } catch (e) {
            // some minimal servers don't report a usable mode
          }

          let serverBytes: number | null = null;
          if (ctx.config.protocol === 'sftp') {
            serverBytes = await serverDuBytes(remoteFs, remotePath);
          }
          let serverCounts: SizeAcc | null = null;
          if (serverBytes === null) {
            const acc: SizeAcc = { files: 0, folders: 0, bytes: 0 };
            let lastTick = 0;
            await walkRemoteSize(remoteFs, remotePath, token, acc, () => {
              const now = Date.now();
              if (now - lastTick < 150) return;
              lastTick = now;
              progress.report({
                message: L({
                  en: `server: ${acc.files} files, ${humanSize(acc.bytes)}`,
                  ru: `сервер: ${acc.files} файлов, ${humanSize(acc.bytes)}`,
                }),
              });
            });
            if (token.isCancellationRequested) {
              return;
            }
            serverBytes = acc.bytes;
            serverCounts = acc;
          }

          // ── Local side: size of the downloaded copy, if any ──────────────────────────────
          progress.report({ message: L({ en: 'measuring local copy…', ru: 'считаю локальную копию…' }) });
          let local: SizeAcc | null = null;
          let hasLocal = false;
          try {
            hasLocal = !!localPath && (await fse.stat(localPath)).isDirectory();
          } catch (e) {
            hasLocal = false;
          }
          if (hasLocal) {
            local = await localDirSize(localPath, token);
          }

          // ── Build the report tab ─────────────────────────────────────────────────────────
          const lines: string[] = [];
          lines.push(L({ en: `Folder size — ${name}`, ru: `Размер папки — ${name}` }));
          lines.push('='.repeat(Math.max(20, name.length + 16)));
          lines.push('');
          lines.push(L({ en: 'Server', ru: 'Сервер' }));
          lines.push(`  ${L({ en: 'path  ', ru: 'путь  ' })}: ${remotePath}`);
          if (serverMode !== undefined) {
            lines.push(`  ${L({ en: 'perms ', ru: 'права ' })}: ${formatPerm(serverMode)}`);
          }
          lines.push(
            `  ${L({ en: 'size  ', ru: 'размер' })}: ${sizeDetail(serverBytes)}` +
              (serverCounts
                ? ` · ${serverCounts.files} ${L({ en: 'files', ru: 'файлов' })} · ${serverCounts.folders} ${L({ en: 'folders', ru: 'папок' })}`
                : ` · ${L({ en: 'via du', ru: 'через du' })}`)
          );
          lines.push('');
          lines.push(L({ en: 'Local', ru: 'Локально' }));
          if (local) {
            lines.push(`  ${L({ en: 'path  ', ru: 'путь  ' })}: ${localPath}`);
            lines.push(
              `  ${L({ en: 'size  ', ru: 'размер' })}: ${sizeDetail(local.bytes)} · ${local.files} ${L({ en: 'files', ru: 'файлов' })} · ${local.folders} ${L({ en: 'folders', ru: 'папок' })}`
            );
            const diff = (serverBytes || 0) - local.bytes;
            if (diff !== 0) {
              lines.push(
                `  ${L({ en: 'diff  ', ru: 'разн. ' })}: ${diff > 0 ? '+' : '−'}${sizeDetail(Math.abs(diff))} ${diff > 0 ? L({ en: '(more on server)', ru: '(больше на сервере)' }) : L({ en: '(more locally)', ru: '(больше локально)' })}`
              );
            }
          } else {
            lines.push(`  ${localPath ? L({ en: '(no local copy)', ru: '(нет локальной копии)' }) : L({ en: '(n/a)', ru: '(н/д)' })}`);
          }

          await openTextReport('folder-size.txt', lines.join('\n'));
        }
      );
    } catch (error) {
      reportError(error);
    }
  },
});
