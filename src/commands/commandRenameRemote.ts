import * as path from 'path';
import { Uri, window } from 'vscode';
import { COMMAND_RENAME } from '../constants';
import { upath } from '../core';
import { renameRemote, handleCtxFromUri } from '../fileHandlers';
import { reportError } from '../helper';
import { ExplorerItem } from '../modules/remoteExplorer';
import { checkCommand } from './abstract/createCommand';
import { L } from '../i18n';

export default checkCommand({
  id: COMMAND_RENAME,
  async handleCommand(item) {
    // createCommand swallows the promise returned by handleCommand, so errors here would not reach
    // the outer catch. Wrap the body ourselves and route failures through reportError.
    try {
      // Use the node under the cursor — even inside a multi-selection, rename targets a single item.
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
      const oldRemote = ctx.target.remoteFsPath;
      const oldName = upath.basename(oldRemote);

      const newName = await window.showInputBox({
        value: oldName,
        prompt: L({ en: 'New name', ru: 'Новое имя' }),
        // Reject path separators and `.`/`..` — otherwise upath.join would normalize them into a
        // parent-directory move (path traversal) instead of a rename in place.
        validateInput: v => {
          const name = (v || '').trim();
          // Also reject control chars (CR/LF/NUL — control-channel/path injection) and Unicode
          // separator look-alikes: NFKC folds fullwidth "／" (U+FF0F) / "＼" back to / and \, which
          // a case-insensitive/Unicode-folding remote FS could treat as a real separator.
          const nfkc = name.normalize('NFKC');
          if (
            !name ||
            name === '.' ||
            name === '..' ||
            name.includes('/') ||
            name.includes('\\') ||
            upath.basename(name) !== name ||
            // tslint:disable-next-line:no-control-regex
            /[\x00-\x1f]/.test(name) ||
            nfkc.includes('/') ||
            nfkc.includes('\\') ||
            nfkc === '.' ||
            nfkc === '..'
          ) {
            return L({
              en: 'Enter a valid name (no path separators, no "." or "..")',
              ru: 'Введите корректное имя (без разделителей пути, без «.» и «..»)',
            });
          }
          return undefined;
        },
      });
      const trimmed = newName === undefined ? undefined : newName.trim();
      if (!trimmed || trimmed === oldName) {
        return;
      }

      const newRemotePath = upath.join(upath.dirname(oldRemote), trimmed);
      const localFrom = ctx.target.localFsPath;
      const localTo = path.join(path.dirname(localFrom), trimmed);

      await renameRemote(ctx, { newRemotePath, localRename: { from: localFrom, to: localTo } });
    } catch (error) {
      reportError(error);
    }
  },
});
