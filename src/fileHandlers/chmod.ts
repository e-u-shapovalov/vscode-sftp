import { FileType, FileEntry } from '../core';
import createFileHandler from './createFileHandler';
import { FileHandleOption } from './option';

interface ChmodFs {
  chmod(path: string, mode: number): Promise<void>;
  list(path: string): Promise<FileEntry[]>;
}

// Apply `mode` to `fspath`. When recursive and the entry is a directory, descend FIRST and chmod the
// directory itself LAST: we must list it while it still has its execute bit, otherwise a mode that
// drops `x` (e.g. 644 on a folder) would lock us out of our own traversal. Matches `chmod -R` — the
// same mode is applied to every file and directory underneath.
async function chmodTree(
  remoteFs: ChmodFs,
  fspath: string,
  mode: number,
  recursive: boolean,
  isDirectory: boolean
): Promise<void> {
  if (recursive && isDirectory) {
    const entries = await remoteFs.list(fspath);
    for (const entry of entries) {
      await chmodTree(remoteFs, entry.fspath, mode, true, entry.type === FileType.Directory);
    }
  }
  await remoteFs.chmod(fspath, mode);
}

// No `ignore` transform on purpose: chmod only runs from the explicit "Change Permissions" command,
// so the sync `ignore` filter must not silently skip it (same reasoning as create/delete).
export const chmodRemote = createFileHandler<
  FileHandleOption & { mode?: number; recursive?: boolean }
>({
  name: 'chmodRemote',
  async handle(option) {
    if (typeof option.mode !== 'number') {
      return;
    }
    const remoteFs = await this.fileService.getRemoteFileSystem(this.config);
    const { remoteFsPath } = this.target;
    const stat = await remoteFs.lstat(remoteFsPath);
    await chmodTree(
      remoteFs as ChmodFs,
      remoteFsPath,
      option.mode,
      option.recursive === true,
      stat.type === FileType.Directory
    );
  },
});
