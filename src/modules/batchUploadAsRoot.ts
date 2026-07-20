import * as path from 'path';
import { fileOperations, FileSystem } from '../core';
import {
  canElevate,
  execAsRoot,
  ElevationCancelled,
  ElevationAuthFailed,
  shQuote,
  isAbsoluteRemotePath,
} from './privilegedExec';
import logger from '../logger';

export interface RootUploadItem {
  localPath: string;
  remotePath: string; // absolute POSIX
  remoteFs: FileSystem;
  localFs: FileSystem;
  host: string;
}

// A private staging mode so a world-readable /tmp can't leak a root-owned config's contents while the
// staged copy sits there between transfer and apply.
const STAGE_MODE = 0o600;

// Silent stage (local → /tmp, as the login user) + apply as root (`cat > dest` through the existing
// inode, which preserves the target's owner/mode/xattr), one file at a time. The FIRST execAsRoot prompts
// for the root password; the rest reuse the in-memory cache. A cancelled OR twice-rejected password aborts
// every remaining file (no per-file re-prompt storm). Never throws — each file lands in `ok` or `fail`,
// and the staged copy is always cleaned up.
export async function uploadFilesAsRoot(
  items: RootUploadItem[]
): Promise<{ ok: string[]; fail: string[] }> {
  const ok: string[] = [];
  const fail: string[] = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const base = path.posix.basename(it.remotePath);
    // Refuse a non-absolute path, the root itself ("/") or an empty basename, and a connection that can't
    // elevate — mirrors uploadFallback's guard so a stray candidate can never target "/".
    if (
      !isAbsoluteRemotePath(it.remotePath) ||
      it.remotePath === '/' ||
      base === '' ||
      !canElevate(it.remoteFs)
    ) {
      fail.push(it.remotePath);
      logger.error('batch root upload: refused (non-absolute / root / no elevation)', it.remotePath);
      continue;
    }
    // A unique staging name per file so two concurrent batches (or a retry) never clash in /tmp.
    const rand = `${process.pid.toString(36)}-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    const stage = `/tmp/.wf-batch-${rand}-${base}`;
    let staged = false;
    try {
      await fileOperations.transferFile(it.localPath, stage, it.localFs, it.remoteFs, {
        mode: STAGE_MODE,
      });
      staged = true;
      // Re-assert 0600 in case the server umask widened the put's create mode.
      await it.remoteFs.chmod(stage, STAGE_MODE).catch(() => undefined);
      // Apply as root. Refuse a target that vanished since the tree snapshot (a bare `>` would CREATE it
      // root:root, losing the owner/mode this feature exists to preserve) or became a symlink (the redirect
      // would write THROUGH it, outside the selected path). Only when it is still a real regular file does
      // `cat >` stream through its existing inode, keeping owner/mode/xattr. The cleanup rm is deliberately
      // NOT chained here: a failed cleanup must not report an applied file as failed, and the stage is
      // login-owned so `finally` removes it over SFTP without root.
      const applyCmd =
        `[ -f ${shQuote(it.remotePath)} ] && [ ! -L ${shQuote(it.remotePath)} ] && ` +
        `cat -- ${shQuote(stage)} > ${shQuote(it.remotePath)}`;
      const { code } = await execAsRoot(it.remoteFs, it.host, applyCmd);
      if (code === 0) {
        ok.push(it.remotePath);
      } else {
        fail.push(it.remotePath);
        logger.error(
          `batch root upload exit ${code} (target missing / symlink / write failed)`,
          it.remotePath
        );
      }
    } catch (e) {
      if (e instanceof ElevationCancelled || e instanceof ElevationAuthFailed) {
        // Can't elevate (dismissed or twice-wrong password) — abort the whole remaining batch instead of
        // prompting again for every file. `finally` still cleans THIS item's stage before the break.
        for (let j = i; j < items.length; j++) {
          fail.push(items[j].remotePath);
        }
        break;
      }
      fail.push(it.remotePath);
      logger.error(`batch root upload: ${(e as Error).message}`, it.remotePath);
    } finally {
      // Best-effort cleanup on EVERY path (success, apply failure, throw, break) so no staged copy is
      // orphaned in /tmp. The stage was written by the login user, so removing it needs no root.
      if (staged) {
        await it.remoteFs.unlink(stage).catch(() => undefined);
      }
    }
  }
  return { ok, fail };
}
