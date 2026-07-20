import * as path from 'path';
import { fileOperations, FileSystem } from '../core';
import { canElevate, execAsRoot, ElevationCancelled, shQuote, isAbsoluteRemotePath } from './privilegedExec';
import logger from '../logger';

export interface RootUploadItem {
  localPath: string;
  remotePath: string; // absolute POSIX
  remoteFs: FileSystem;
  localFs: FileSystem;
  host: string;
}

// Silent stage (local → /tmp) + apply as root (`cat > dest`, which preserves the target's owner/mode),
// one file at a time. The FIRST execAsRoot prompts for the root password; the rest reuse the in-memory
// cache (privilegedExec rootPwCache). A cancelled password aborts every remaining file. Never throws —
// each file lands in `ok` or `fail`, so the caller can report a clean summary.
export async function uploadFilesAsRoot(
  items: RootUploadItem[]
): Promise<{ ok: string[]; fail: string[] }> {
  const ok: string[] = [];
  const fail: string[] = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (!isAbsoluteRemotePath(it.remotePath) || !canElevate(it.remoteFs)) {
      fail.push(it.remotePath);
      logger.error('batch root upload: not elevatable / non-absolute path', it.remotePath);
      continue;
    }
    const base = path.posix.basename(it.remotePath);
    // A unique staging name per file so two concurrent batches (or a retry) never clash in /tmp.
    const rand = `${process.pid.toString(36)}-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    const stage = `/tmp/.wf-batch-${rand}-${base}`;
    try {
      await fileOperations.transferFile(it.localPath, stage, it.localFs, it.remoteFs);
      // `cat -- <stage> > <remote>` writes through the existing inode, keeping the destination's owner and
      // mode (unlike a cp/mv that would inherit root:root); then remove the staged copy.
      const applyCmd = `cat -- ${shQuote(stage)} > ${shQuote(it.remotePath)} && rm -fv -- ${shQuote(stage)}`;
      const { code } = await execAsRoot(it.remoteFs, it.host, applyCmd); // 1st call prompts, then cached
      if (code === 0) {
        ok.push(it.remotePath);
      } else {
        fail.push(it.remotePath);
        logger.error(`batch root upload exit ${code}`, it.remotePath);
      }
    } catch (e) {
      if (e instanceof ElevationCancelled) {
        // The user dismissed the password prompt — abort the whole remaining batch rather than prompting
        // again per file.
        for (let j = i; j < items.length; j++) {
          fail.push(items[j].remotePath);
        }
        break;
      }
      fail.push(it.remotePath);
      logger.error(`batch root upload: ${(e as Error).message}`, it.remotePath);
    }
  }
  return { ok, fail };
}
