import { Uri, window, ProgressLocation, CancellationToken } from 'vscode';
import * as fse from 'fs-extra';
import * as nodePath from 'path';
import * as crypto from 'crypto';
import { COMMAND_REMOTEEXPLORER_CALC_FOLDER_SIZE } from '../constants';
import { upath, FileType, FileSystem } from '../core';
import { handleCtxFromUri } from '../fileHandlers';
import { reportError } from '../helper';
import logger from '../logger';
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

// Reject after `ms` so a stuck server command can't hang the report forever.
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    p.then(
      v => {
        clearTimeout(timer);
        resolve(v);
      },
      e => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

function execClient(remoteFs: FileSystem): any {
  return (remoteFs as any).getClient ? (remoteFs as any).getClient() : null;
}

// Fast path: total the directory server-side with one `du`. Prefer apparent bytes (`-sb`, GNU/Linux)
// so the count is byte-exact and matches summing file sizes; fall back to KB blocks (`-sk`, POSIX).
// Returns null when not possible (no exec channel, no `du`, non-zero exit) so the caller can walk.
async function serverDuBytes(remoteFs: FileSystem, remotePath: string): Promise<number | null> {
  const client = execClient(remoteFs);
  if (!client || typeof client.exec !== 'function') {
    return null;
  }
  // Never let the path break out of the single-quoted shell argument.
  if (/[\r\n\0]/.test(remotePath)) {
    return null;
  }
  const quoted = `'${remotePath.replace(/'/g, `'\\''`)}'`;
  // `--` ends option parsing so a folder whose name starts with `-` is treated as a path, not a flag.
  const attempts: Array<{ cmd: string; toBytes: (n: number) => number }> = [
    { cmd: `du -sb -- ${quoted}`, toBytes: n => n },
    { cmd: `du -sk -- ${quoted}`, toBytes: n => n * 1024 },
  ];
  for (const attempt of attempts) {
    try {
      // Bound the exec like the MD5 path does — a stuck remote `du` would otherwise hang the
      // size report (and its progress notification) forever, with no way to abort the promise.
      const out = await withTimeout(client.exec(attempt.cmd), 120000);
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

// Server-side MD5 of one file. Tries the common tools in order; null when there's no exec channel or
// none of them work (FTP, minimal servers).
async function serverFileMd5(remoteFs: FileSystem, remotePath: string): Promise<string | null> {
  const client = execClient(remoteFs);
  if (!client || typeof client.exec !== 'function' || /[\r\n\0]/.test(remotePath)) {
    return null;
  }
  const q = `'${remotePath.replace(/'/g, `'\\''`)}'`;
  const cmds = [`md5sum ${q}`, `md5 -q ${q}`, `openssl md5 -r ${q}`];
  let lastErr = '';
  for (const cmd of cmds) {
    try {
      const out = String(await withTimeout(client.exec(cmd), 120000));
      const m = out.match(/\b[0-9a-fA-F]{32}\b/);
      if (m) {
        return m[0].toLowerCase();
      }
    } catch (e) {
      lastErr = (e && (e as Error).message) || String(e);
      logger.debug(`server md5: \`${cmd}\` failed: ${lastErr}`);
    }
  }
  logger.info(`server md5 unavailable for ${remotePath}${lastErr ? ` — ${lastErr}` : ''}`);
  return null;
}

// Local MD5 of one file, streamed (constant memory).
function localFileMd5(filePath: string): Promise<string | null> {
  return new Promise(resolve => {
    try {
      const hash = crypto.createHash('md5');
      const stream = (fse as any).createReadStream(filePath);
      stream.on('data', (d: Buffer) => hash.update(d));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', () => resolve(null));
    } catch (e) {
      resolve(null);
    }
  });
}

// Server-side content fingerprint of a folder: md5 of the LC_ALL=C-sorted per-file md5 digests. Matches
// the local fingerprint below when the multiset of file CONTENTS is identical (names/structure ignored).
// SFTP + exec only; null otherwise.
async function serverFolderFingerprint(remoteFs: FileSystem, remotePath: string): Promise<string | null> {
  const client = execClient(remoteFs);
  if (!client || typeof client.exec !== 'function' || /[\r\n\0]/.test(remotePath)) {
    return null;
  }
  const q = `'${remotePath.replace(/'/g, `'\\''`)}'`;
  const cmd = `find ${q} -type f -exec md5sum {} + 2>/dev/null | awk '{print $1}' | LC_ALL=C sort | md5sum`;
  logger.info(`server md5 (folder): hashing every file under ${remotePath} — can take a while on large folders…`);
  try {
    const out = String(await withTimeout(client.exec(cmd), 600000));
    const m = out.match(/\b[0-9a-fA-F]{32}\b/);
    return m ? m[0].toLowerCase() : null;
  } catch (e) {
    logger.info(`server md5 (folder) failed for ${remotePath}: ${(e && (e as Error).message) || String(e)}`);
    return null;
  }
}

// Local content fingerprint mirroring the server pipeline: md5 each file, sort the hex digests, then md5
// the "<hex>\n" stream — so an identical multiset of file contents yields the same fingerprint.
async function localFolderFingerprint(dir: string, token: CancellationToken): Promise<string | null> {
  const hexes: string[] = [];
  async function walk(d: string): Promise<void> {
    let entries: any[];
    try {
      entries = await (fse.readdir as any)(d, { withFileTypes: true });
    } catch (e) {
      return;
    }
    for (const entry of entries) {
      if (token.isCancellationRequested) {
        return;
      }
      const full = nodePath.join(d, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        const h = await localFileMd5(full);
        if (h) {
          hexes.push(h);
        }
      }
    }
  }
  try {
    await walk(dir);
    hexes.sort();
    const buf = Buffer.from(hexes.map(h => `${h}\n`).join(''), 'utf8');
    return crypto.createHash('md5').update(buf).digest('hex');
  } catch (e) {
    return null;
  }
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

      // Permissions + decide file vs folder: prefer the tree item's flag, else the server mode, else the
      // local copy. (A local-Explorer invocation comes in as a Uri with no isDirectory flag.)
      let serverMode: number | undefined;
      let serverStat: any;
      let serverLstatError = '';
      try {
        serverStat = await remoteFs.lstat(remotePath);
        serverMode = serverStat.mode;
      } catch (e) {
        serverLstatError = (e && (e as Error).message) || String(e);
        logger.info(`Size & MD5: server lstat failed for ${remotePath}: ${serverLstatError}`);
      }
      let isDir: boolean;
      if (!(item instanceof Uri) && typeof (item as ExplorerItem).isDirectory === 'boolean') {
        isDir = (item as ExplorerItem).isDirectory;
      } else if (typeof serverMode === 'number') {
        // tslint:disable-next-line:no-bitwise
        isDir = (serverMode & 0o170000) === 0o040000;
      } else {
        try {
          isDir = (await fse.stat(localPath)).isDirectory();
        } catch (e) {
          isDir = true;
        }
      }

      // MD5 on a folder hashes every file recursively — ask first (slow on many files). A single file
      // always includes its MD5 (cheap).
      let wantMd5 = true;
      if (isDir) {
        const sizeMd5 = L({ en: 'Size + MD5', ru: 'Размер + MD5' });
        const sizeOnly = L({ en: 'Size only', ru: 'Только размер' });
        const pick = await window.showWarningMessage(
          L({ en: `Compute MD5 for the folder "${name}"?`, ru: `Посчитать MD5 для папки «${name}»?` }),
          {
            modal: true,
            detail: L({
              en:
                'MD5 hashes every file in the folder recursively, which can be slow when there are many ' +
                'files. The size is computed either way.',
              ru:
                'MD5 хеширует каждый файл в папке рекурсивно — на папках с большим числом файлов это ' +
                'долго. Размер считается в любом случае.',
            }),
          },
          sizeMd5,
          sizeOnly
        );
        if (pick === undefined) {
          return; // cancelled
        }
        wantMd5 = pick === sizeMd5;
      }

      await window.withProgress(
        {
          location: ProgressLocation.Notification,
          title: L({ en: `WireFerry: inspecting "${name}"…`, ru: `WireFerry: считаю «${name}»…` }),
          cancellable: true,
        },
        async (progress, token) => {
          const lines: string[] = [];
          const naServerMd5 = L({ en: '(n/a — needs SFTP + md5sum)', ru: '(н/д — нужен SFTP + md5sum)' });

          if (!isDir) {
            // ── Single file: size + MD5 on both sides ──────────────────────────────────────────
            const serverSize: number | null = serverStat ? serverStat.size : null;
            let serverMd5: string | null = null;
            if (serverStat) {
              progress.report({ message: L({ en: 'hashing on server…', ru: 'хеширую на сервере…' }) });
              serverMd5 = await serverFileMd5(remoteFs, remotePath);
            }

            let localSize: number | null = null;
            let localMd5: string | null = null;
            let hasLocal = false;
            try {
              const st = await fse.stat(localPath);
              hasLocal = st.isFile();
              if (hasLocal) {
                localSize = st.size;
              }
            } catch (e) {
              hasLocal = false;
            }
            if (hasLocal && !token.isCancellationRequested) {
              progress.report({ message: L({ en: 'hashing local copy…', ru: 'хеширую локальную копию…' }) });
              localMd5 = await localFileMd5(localPath);
            }
            if (token.isCancellationRequested) {
              return;
            }

            lines.push(L({ en: `File — ${name}`, ru: `Файл — ${name}` }));
            lines.push('='.repeat(Math.max(20, name.length + 12)));
            lines.push('');
            lines.push(L({ en: 'Server', ru: 'Сервер' }));
            lines.push(`  ${L({ en: 'path  ', ru: 'путь  ' })}: ${remotePath}`);
            if (!serverStat) {
              lines.push(
                `  ${L({ en: '⚠ NOT FOUND on server', ru: '⚠ НА СЕРВЕРЕ НЕ НАЙДЕН' })}${
                  serverLstatError ? ` — ${serverLstatError}` : ''
                }`
              );
            } else {
              if (serverMode !== undefined) {
                lines.push(`  ${L({ en: 'perms ', ru: 'права ' })}: ${formatPerm(serverMode)}`);
              }
              lines.push(
                `  ${L({ en: 'size  ', ru: 'размер' })}: ${
                  serverSize === null ? L({ en: '(unknown)', ru: '(неизв.)' }) : sizeDetail(serverSize)
                }`
              );
              lines.push(`  ${L({ en: 'md5   ', ru: 'md5   ' })}: ${serverMd5 || naServerMd5}`);
            }
            lines.push('');
            lines.push(L({ en: 'Local', ru: 'Локально' }));
            if (hasLocal) {
              lines.push(`  ${L({ en: 'path  ', ru: 'путь  ' })}: ${localPath}`);
              lines.push(`  ${L({ en: 'size  ', ru: 'размер' })}: ${localSize === null ? '?' : sizeDetail(localSize)}`);
              lines.push(`  ${L({ en: 'md5   ', ru: 'md5   ' })}: ${localMd5 || '?'}`);
            } else {
              lines.push(
                `  ${localPath ? L({ en: '(no local copy)', ru: '(нет локальной копии)' }) : L({ en: '(n/a)', ru: '(н/д)' })}`
              );
            }
            if (serverMd5 && localMd5) {
              lines.push('');
              lines.push(
                serverMd5 === localMd5
                  ? L({ en: 'MD5: ✓ match — server and local are identical', ru: 'MD5: ✓ совпадает — сервер и локально идентичны' })
                  : L({ en: 'MD5: ✗ DIFFER — server and local are not the same', ru: 'MD5: ✗ РАЗЛИЧАЮТСЯ — сервер и локально не совпадают' })
              );
            }
          } else {
            // ── Folder: size (du / walk) + local fs + optional MD5 fingerprint ─────────────────
            let serverBytes: number | null = null;
            let serverCounts: SizeAcc | null = null;
            if (serverStat) {
              if (ctx.config.protocol === 'sftp') {
                serverBytes = await serverDuBytes(remoteFs, remotePath);
              }
              if (serverBytes === null) {
                const acc: SizeAcc = { files: 0, folders: 0, bytes: 0 };
                let lastTick = 0;
                try {
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
                } catch (e) {
                  logger.info(
                    `Size & MD5: server walk failed for ${remotePath}: ${(e && (e as Error).message) || String(e)}`
                  );
                }
                if (token.isCancellationRequested) {
                  return;
                }
                serverBytes = acc.bytes;
                serverCounts = acc;
              }
            }

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

            let serverFp: string | null = null;
            let localFp: string | null = null;
            if (wantMd5 && serverStat && !token.isCancellationRequested) {
              progress.report({ message: L({ en: 'hashing on server (md5)…', ru: 'хеширую на сервере (md5)…' }) });
              serverFp = await serverFolderFingerprint(remoteFs, remotePath);
            }
            if (wantMd5 && hasLocal && !token.isCancellationRequested) {
              progress.report({ message: L({ en: 'hashing local copy (md5)…', ru: 'хеширую локально (md5)…' }) });
              localFp = await localFolderFingerprint(localPath, token);
            }
            if (token.isCancellationRequested) {
              return;
            }

            lines.push(L({ en: `Folder size — ${name}`, ru: `Размер папки — ${name}` }));
            lines.push('='.repeat(Math.max(20, name.length + 16)));
            lines.push('');
            lines.push(L({ en: 'Server', ru: 'Сервер' }));
            lines.push(`  ${L({ en: 'path  ', ru: 'путь  ' })}: ${remotePath}`);
            if (!serverStat) {
              lines.push(
                `  ${L({ en: '⚠ NOT FOUND on server', ru: '⚠ НА СЕРВЕРЕ НЕ НАЙДЕН' })}${
                  serverLstatError ? ` — ${serverLstatError}` : ''
                }`
              );
            } else {
              if (serverMode !== undefined) {
                lines.push(`  ${L({ en: 'perms ', ru: 'права ' })}: ${formatPerm(serverMode)}`);
              }
              lines.push(
                `  ${L({ en: 'size  ', ru: 'размер' })}: ${sizeDetail(serverBytes || 0)}` +
                  (serverCounts
                    ? ` · ${serverCounts.files} ${L({ en: 'files', ru: 'файлов' })} · ${serverCounts.folders} ${L({ en: 'folders', ru: 'папок' })}`
                    : ` · ${L({ en: 'via du', ru: 'через du' })}`)
              );
              if (wantMd5) {
                lines.push(
                  `  ${L({ en: 'md5   ', ru: 'md5   ' })}: ${
                    serverFp || L({ en: '(n/a — needs SFTP + md5sum/find)', ru: '(н/д — нужен SFTP + md5sum/find)' })
                  }`
                );
              }
            }
            lines.push('');
            lines.push(L({ en: 'Local', ru: 'Локально' }));
            if (local) {
              lines.push(`  ${L({ en: 'path  ', ru: 'путь  ' })}: ${localPath}`);
              lines.push(
                `  ${L({ en: 'size  ', ru: 'размер' })}: ${sizeDetail(local.bytes)} · ${local.files} ${L({ en: 'files', ru: 'файлов' })} · ${local.folders} ${L({ en: 'folders', ru: 'папок' })}`
              );
              if (wantMd5) {
                lines.push(`  ${L({ en: 'md5   ', ru: 'md5   ' })}: ${localFp || '?'}`);
              }
              const diff = (serverBytes || 0) - local.bytes;
              if (diff !== 0) {
                lines.push(
                  `  ${L({ en: 'diff  ', ru: 'разн. ' })}: ${diff > 0 ? '+' : '−'}${sizeDetail(Math.abs(diff))} ${diff > 0 ? L({ en: '(more on server)', ru: '(больше на сервере)' }) : L({ en: '(more locally)', ru: '(больше локально)' })}`
                );
              }
            } else {
              lines.push(
                `  ${localPath ? L({ en: '(no local copy)', ru: '(нет локальной копии)' }) : L({ en: '(n/a)', ru: '(н/д)' })}`
              );
            }
            if (wantMd5 && serverFp && localFp) {
              lines.push('');
              lines.push(
                serverFp === localFp
                  ? L({ en: 'MD5: ✓ match — folder contents are identical', ru: 'MD5: ✓ совпадает — содержимое папок идентично' })
                  : L({ en: 'MD5: ✗ DIFFER — folder contents are not the same', ru: 'MD5: ✗ РАЗЛИЧАЮТСЯ — содержимое папок не совпадает' })
              );
            }
          }

          await openTextReport(isDir ? 'folder-size.txt' : 'file-info.txt', lines.join('\n'));
        }
      );
    } catch (error) {
      reportError(error);
    }
  },
});
