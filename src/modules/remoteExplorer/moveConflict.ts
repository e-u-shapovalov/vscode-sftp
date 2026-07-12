import * as vscode from 'vscode';
import { FileType } from '../../core';
import { serverFileMd5, formatPerm, sizeDetail } from '../../helper/fileFacts';
import { L } from '../../i18n';

// What to do with one colliding item during a drag&drop move.
//   overwrite — replace the existing destination
//   rename    — move under `newName` instead (caller re-checks that name for a fresh collision)
//   skip      — leave this item where it is, continue with the rest
//   cancel    — abort the whole move (skip every remaining item)
//   dedup     — the destination already holds byte-identical content; the caller drops the source
export type ConflictAction = 'overwrite' | 'rename' | 'skip' | 'cancel' | 'dedup';

export interface ConflictResult {
  action: ConflictAction;
  newName?: string;
}

// Owner/size/mode/md5 known about one side of the collision. `md5`: undefined = not computed
// (not a regular file, or sizes already differ), null = tried but no exec channel (FTP), string = digest.
interface SideFacts {
  type: FileType;
  isDir: boolean;
  size?: number;
  mode?: number;
  owner?: string;
  md5?: string | null;
}

export interface OwnerHint {
  owner?: string;
  group?: string;
  uid?: number;
  gid?: number;
}

function ownerString(owner?: string, group?: string, uid?: number, gid?: number): string | undefined {
  if (owner) {
    return group ? `${owner}:${group}` : owner;
  }
  if (typeof uid === 'number') {
    return typeof gid === 'number' ? `${uid}:${gid}` : String(uid);
  }
  return undefined;
}

// Build display facts from an already-obtained lstat. The caller lstats both paths itself (authoritative
// type for the overwrite/dedup decisions) so this never issues its own request and never downgrades an
// unknown type to "file". Owner NAMES come from the tree `hint`; a bare lstat only has numeric uid/gid.
function factsFromStat(stat: any, hint?: OwnerHint): SideFacts {
  const type: FileType = stat && typeof stat.type === 'number' ? stat.type : FileType.Unknown;
  return {
    type,
    isDir: type === FileType.Directory,
    size: stat ? stat.size : undefined,
    mode: stat ? stat.mode : undefined,
    owner:
      (hint && ownerString(hint.owner, hint.group, hint.uid, hint.gid)) ||
      (stat ? ownerString(undefined, undefined, stat.uid, stat.gid) : undefined),
  };
}

function typeLabel(t: FileType): string {
  switch (t) {
    case FileType.Directory:
      return L({ en: 'folder', ru: 'папка' });
    case FileType.SymbolicLink:
      return L({ en: 'symlink', ru: 'симлинк' });
    case FileType.File:
      return L({ en: 'file', ru: 'файл' });
    default:
      return L({ en: 'special', ru: 'спец.' });
  }
}

function factLines(f: SideFacts): string {
  const na = L({ en: '(unknown)', ru: '(неизв.)' });
  const lines: string[] = [];
  lines.push(`  ${L({ en: 'type ', ru: 'тип  ' })}: ${typeLabel(f.type)}`);
  lines.push(`  ${L({ en: 'size ', ru: 'размер' })}: ${f.size === undefined ? na : sizeDetail(f.size)}`);
  if (f.mode !== undefined) {
    lines.push(`  ${L({ en: 'perms', ru: 'права ' })}: ${formatPerm(f.mode)}`);
  }
  if (f.owner) {
    lines.push(`  ${L({ en: 'owner', ru: 'влад. ' })}: ${f.owner}`);
  }
  if (f.type === FileType.File && f.md5 !== undefined) {
    lines.push(
      `  md5  : ${f.md5 || L({ en: '(n/a — needs SFTP + md5sum)', ru: '(н/д — нужен SFTP + md5sum)' })}`
    );
  }
  return lines.join('\n');
}

function buildDetail(src: SideFacts, dest: SideFacts): string {
  const parts = [
    L({ en: 'Already on the server:', ru: 'Уже на сервере:' }),
    factLines(dest),
    '',
    L({ en: 'Being moved in:', ru: 'Перемещается:' }),
    factLines(src),
  ];
  const bothFiles = src.type === FileType.File && dest.type === FileType.File;
  if (bothFiles) {
    if (src.md5 && dest.md5) {
      parts.push('');
      parts.push(L({ en: 'MD5: ✗ differ — the files are NOT the same.', ru: 'MD5: ✗ различаются — файлы не совпадают.' }));
    } else if (src.size !== undefined && dest.size !== undefined && src.size !== dest.size) {
      parts.push('');
      parts.push(L({ en: 'Sizes differ.', ru: 'Размеры различаются.' }));
    }
  } else if (src.type !== dest.type) {
    parts.push('');
    parts.push(
      L({
        en: `Different kinds of object (${typeLabel(dest.type)} → ${typeLabel(src.type)}).`,
        ru: `Разные типы объектов (${typeLabel(dest.type)} → ${typeLabel(src.type)}).`,
      })
    );
  }
  return parts.join('\n');
}

// "test.html" -> "test (2).html"; "notes" -> "notes (2)". A leading-dot name (".env") has no split.
function suggestName(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot > 0) {
    return `${name.slice(0, dot)} (2)${name.slice(dot)}`;
  }
  return `${name} (2)`;
}

function hasControlChar(t: string): boolean {
  for (let i = 0; i < t.length; i += 1) {
    if (t.charCodeAt(i) < 32) {
      return true;
    }
  }
  return false;
}

// A name segment that can't exist on the destination's local mirror would rename on the server and then
// fail the local `fse.move`, leaving the two sides out of sync. Reject the full Windows set on win32.
function localNameError(t: string): string | undefined {
  if (process.platform !== 'win32') {
    return undefined;
  }
  if (hasControlChar(t) || /[<>:"|?*]/.test(t)) {
    return L({
      en: 'Windows names can’t contain < > : " | ? * or control characters',
      ru: 'В именах Windows недопустимы < > : " | ? * и управляющие символы',
    });
  }
  if (/[ .]$/.test(t)) {
    return L({ en: 'Windows names can’t end with a space or a dot', ru: 'Имя Windows не может кончаться пробелом или точкой' });
  }
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(t)) {
    return L({ en: 'That is a reserved Windows device name', ru: 'Это зарезервированное имя устройства Windows' });
  }
  return undefined;
}

async function promptNewName(name: string, destFolderName: string): Promise<string | undefined> {
  const suggestion = suggestName(name);
  const dot = suggestion.lastIndexOf('.');
  const input = await vscode.window.showInputBox({
    ignoreFocusOut: true,
    title: L({
      en: `Rename before moving into "${destFolderName}"`,
      ru: `Переименовать перед переносом в «${destFolderName}»`,
    }),
    prompt: L({ en: 'New name in the destination folder', ru: 'Новое имя в целевой папке' }),
    value: suggestion,
    valueSelection: [0, dot > 0 ? dot : suggestion.length],
    validateInput: v => {
      const t = (v || '').trim();
      if (!t) {
        return L({ en: 'Enter a name', ru: 'Укажите имя' });
      }
      if (t === '.' || t === '..' || /[\/\\]/.test(t) || t.indexOf(String.fromCharCode(0)) !== -1) {
        return L({ en: 'A name, without slashes or NUL', ru: 'Имя без слэшей и NUL' });
      }
      if (t === name) {
        return L({ en: 'That is the current name — pick a different one', ru: 'Это текущее имя — выберите другое' });
      }
      return localNameError(t);
    },
  });
  return input === undefined ? undefined : input.trim();
}

// Ask the user how to resolve one name collision. `srcStat`/`destStat` are lstat results the caller
// already obtained (authoritative types), so this only hashes on top. Byte-identical regular files
// short-circuit to `dedup` with no prompt.
export async function resolveMoveConflict(
  remoteFs: any,
  args: {
    name: string;
    destFolderName: string;
    srcPath: string;
    destPath: string;
    srcStat: any;
    destStat: any;
    srcHint?: OwnerHint;
  }
): Promise<ConflictResult> {
  const src = factsFromStat(args.srcStat, args.srcHint);
  const dest = factsFromStat(args.destStat);

  // Dedup ONLY for two real regular files — never a symlink or unknown-type object: `md5sum` on a link
  // hashes its referent, so two different links pointing at same-content files would falsely match and
  // the source link would be destroyed. MD5 is skipped when sizes already differ (they can't be equal).
  const bothRealFiles = src.type === FileType.File && dest.type === FileType.File;
  const sizesKnown = src.size !== undefined && dest.size !== undefined;
  if (bothRealFiles && (!sizesKnown || src.size === dest.size)) {
    const [srcMd5, destMd5] = await Promise.all([
      serverFileMd5(remoteFs, args.srcPath),
      serverFileMd5(remoteFs, args.destPath),
    ]);
    src.md5 = srcMd5;
    dest.md5 = destMd5;
    if (srcMd5 && destMd5 && srcMd5 === destMd5) {
      return { action: 'dedup' };
    }
  }

  const overwrite: vscode.MessageItem = { title: L({ en: 'Overwrite', ru: 'Перезаписать' }) };
  const rename: vscode.MessageItem = { title: L({ en: 'Rename', ru: 'Переименовать' }) };
  const skip: vscode.MessageItem = { title: L({ en: 'Do nothing', ru: 'Ничего не делать' }) };
  const cancel: vscode.MessageItem = {
    title: L({ en: 'Cancel', ru: 'Отмена' }),
    isCloseAffordance: true,
  };

  const pick = await vscode.window.showWarningMessage(
    L({
      en: `"${args.name}" already exists in "${args.destFolderName}".`,
      ru: `«${args.name}» уже есть в «${args.destFolderName}».`,
    }),
    { modal: true, detail: buildDetail(src, dest) },
    overwrite,
    rename,
    skip,
    cancel
  );

  if (pick === overwrite) {
    // Overwriting a directory means removing it and everything inside — never silent. Re-confirm.
    if (dest.isDir) {
      const proceed: vscode.MessageItem = { title: L({ en: 'Delete & overwrite', ru: 'Удалить и перезаписать' }) };
      const ok = await vscode.window.showWarningMessage(
        L({
          en: `"${args.name}" is a folder — overwriting DELETES it and all its contents on the server (any local copy is moved to the OS trash). Continue?`,
          ru: `«${args.name}» — папка: перезапись УДАЛИТ её и всё содержимое на сервере (локальная копия, если есть, уходит в Корзину ОС). Продолжить?`,
        }),
        { modal: true },
        proceed
      );
      if (ok !== proceed) {
        return { action: 'skip' };
      }
    }
    return { action: 'overwrite' };
  }
  if (pick === skip) {
    return { action: 'skip' };
  }
  if (pick === rename) {
    const newName = await promptNewName(args.name, args.destFolderName);
    // Backed out of the rename prompt → treat as "do nothing" for this item, not a full cancel.
    return newName ? { action: 'rename', newName } : { action: 'skip' };
  }
  // cancel button or Esc
  return { action: 'cancel' };
}
