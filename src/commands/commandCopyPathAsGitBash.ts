import { Uri, env } from 'vscode';
import { COMMAND_COPY_PATH_GIT_BASH } from '../constants';
import { checkCommand } from './abstract/createCommand';

// Convert a native filesystem path to the form Git Bash (MSYS2) understands:
//   C:\Users\me\proj   ->  /c/Users/me/proj   (drive letter → /<lower-letter>, backslashes → /)
//   \\host\share\x     ->  //host/share/x     (UNC keeps a leading //)
// On non-Windows the path is already POSIX, so only the (no-op) slash pass applies.
export function toGitBashPath(fsPath: string): string {
  const isUnc = /^\\\\/.test(fsPath);
  const slashed = fsPath.replace(/\\/g, '/');
  if (isUnc) {
    return slashed;
  }
  // Drive-letter root: "C:" or "C:/…" -> "/c" or "/c/…".
  return slashed.replace(/^([A-Za-z]):(?=\/|$)/, (_m, drive) => `/${drive.toLowerCase()}`);
}

// Local-Explorer (and editor-title) context command: copy the selected file/folder path(s) in Git Bash
// form. Deliberately a plain command, NOT a file command — it needs no SFTP config, so it must work on
// any local path (handleCtxFromUri would throw "Config Not Found" outside a configured workspace).
export default checkCommand({
  id: COMMAND_COPY_PATH_GIT_BASH,
  async handleCommand(item?: Uri, items?: Uri[]) {
    // VS Code passes (clickedUri, [allSelectedUris]); honour a mouse + Ctrl multi-selection.
    let uris: Uri[] = [];
    if (Array.isArray(items) && items.length > 0 && items[0] instanceof Uri) {
      uris = items;
    } else if (item instanceof Uri) {
      uris = [item];
    }
    if (uris.length === 0) {
      return;
    }
    const text = uris.map(u => toGitBashPath(u.fsPath)).join('\n');
    await env.clipboard.writeText(text);
  },
});
