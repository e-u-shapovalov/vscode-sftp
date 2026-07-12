import * as fse from 'fs-extra';
import * as crypto from 'crypto';
import logger from '../logger';
import { L } from '../i18n';

// Shared "file facts" helpers — size/permission formatting and single-file MD5 on both sides. Kept in
// one place so the Size & MD5 report and the drag&drop conflict dialog show identical numbers.

// 9525 -> "9.3 KB", 500 -> "500 B". Whole bytes show no decimals; larger units show one decimal
// under 10 (9.3 MB) and none at/above (24 MB).
export function humanSize(bytes: number): string {
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
export function groupDigits(n: number): string {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

// "12 000 000 000 байт (12 GB)" — exact bytes + human form.
export function sizeDetail(bytes: number): string {
  return L({
    en: `${groupDigits(bytes)} bytes (${humanSize(bytes)})`,
    ru: `${groupDigits(bytes)} байт (${humanSize(bytes)})`,
  });
}

// "755 (rwxr-xr-x)" from Unix mode bits.
export function formatPerm(mode: number): string {
  // tslint:disable-next-line:no-bitwise
  const bits = mode & 0o777;
  const octal = bits.toString(8).padStart(3, '0');
  const sym = [0o400, 0o200, 0o100, 0o040, 0o020, 0o010, 0o004, 0o002, 0o001]
    // tslint:disable-next-line:no-bitwise
    .map((b, i) => (bits & b ? 'rwx'[i % 3] : '-'))
    .join('');
  return `${octal} (${sym})`;
}

// Reject after `ms` so a stuck server command can't hang the caller forever.
export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
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

// The underlying protocol client, when the backend exposes one (SFTP). null on FTP / no shell.
export function execClient(remoteFs: any): any {
  return remoteFs && (remoteFs as any).getClient ? (remoteFs as any).getClient() : null;
}

// Server-side MD5 of one file. Tries the common tools in order; null when there's no exec channel or
// none of them work (FTP, minimal servers).
export async function serverFileMd5(remoteFs: any, remotePath: string): Promise<string | null> {
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
export function localFileMd5(filePath: string): Promise<string | null> {
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
