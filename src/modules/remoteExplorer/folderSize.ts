import { FileSystem } from '../../core';

// Reject after `ms` so one pathological `du` (a stuck network mount, a giant /proc) can't hang a tree
// expand forever — on timeout the caller falls back to no folder sizes.
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('du timeout')), ms);
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

// Byte size of one or more remote folders via a SINGLE server-side `du` over the SFTP exec channel —
// exactly how the "Get Folder Size" command measures one folder, batched here for a whole listing so
// the tree can sort folders by size without any client-side recursion. Prefer apparent bytes (`du -sb`,
// GNU) so it matches summing file sizes; fall back to KB blocks (`du -sk`, POSIX). Returns a Map keyed
// by the exact path passed in. Folders du couldn't size are simply absent; an empty Map means there's
// no exec channel or no `du` (FTP, minimal servers) and the caller should fall back to name order.
export async function duSizes(
  remoteFs: FileSystem,
  paths: string[],
  timeoutMs = 60000
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (paths.length === 0) {
    return result;
  }
  const client = (remoteFs as any).getClient ? (remoteFs as any).getClient() : null;
  if (!client || typeof client.exec !== 'function') {
    return result;
  }
  // Never let a path break out of its single-quoted shell argument.
  const safe = paths.filter(p => !/[\r\n\0]/.test(p));
  if (safe.length === 0) {
    return result;
  }
  const quoted = safe.map(p => `'${p.replace(/'/g, `'\\''`)}'`).join(' ');
  // `--` ends option parsing: without it a folder whose name starts with `-` (e.g. `-x`, `--help`)
  // is read by du as a flag instead of a path. Single-quoting doesn't help — the shell strips the
  // quotes and du still sees a leading dash. POSIX-portable (GNU and BSD du both honour `--`).
  const attempts: Array<{ cmd: string; toBytes: (n: number) => number }> = [
    { cmd: `du -sb -- ${quoted}`, toBytes: n => n },
    { cmd: `du -sk -- ${quoted}`, toBytes: n => n * 1024 },
  ];
  for (const attempt of attempts) {
    try {
      const out = String(await withTimeout(client.exec(attempt.cmd), timeoutMs));
      // `du -s` prints one "<size><whitespace><path>" line per argument; du echoes the path back, so
      // match by the exact path string (robust to skipped lines when a folder errored).
      const lines = out.split('\n');
      for (const raw of lines) {
        const line = raw.trim();
        const match = line.match(/^(\d+)\s+(.*)$/);
        if (!match) {
          continue;
        }
        const bytes = attempt.toBytes(parseInt(match[1], 10));
        const path = match[2];
        if (Number.isFinite(bytes) && safe.indexOf(path) !== -1 && !result.has(path)) {
          result.set(path, bytes);
        }
      }
      if (result.size > 0) {
        return result;
      }
    } catch (e) {
      // try the next du form
    }
  }
  return result;
}
