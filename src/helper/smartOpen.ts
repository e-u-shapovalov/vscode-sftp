import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { showTextDocument } from '../host';
import { L } from '../i18n';

// Opening a binary blob or a huge file as a text document freezes the VS Code editor (a 45 MB exe
// will hang it). So after a download we decide whether to open the file straight away or ask first.
// Two triggers make us ask instead of opening:
//   1. the file is larger than this threshold (even a text log — a 200 MB log still hangs the editor)
//   2. the extension is a known non-text/binary type VS Code can't usefully display
// Everything else (source, configs, logs, plain text) opens immediately, as before.
const LARGE_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

// Known binary / non-text extensions — opening these in the text editor is never useful and often
// freezes it. Lower-case, without the dot.
const BINARY_EXTS = new Set([
  // executables / libraries
  'exe', 'dll', 'so', 'dylib', 'bin', 'o', 'a', 'lib', 'msi', 'apk', 'app', 'deb', 'rpm', 'class',
  // archives
  'zip', 'rar', '7z', 'gz', 'tar', 'tgz', 'bz2', 'xz', 'jar', 'war', 'iso', 'dmg',
  // images
  'png', 'jpg', 'jpeg', 'gif', 'bmp', 'ico', 'tif', 'tiff', 'webp', 'psd', 'heic',
  // audio / video
  'wav', 'mp3', 'flac', 'aac', 'ogg', 'm4a', 'mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm',
  // documents / fonts / db
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'ttf', 'otf', 'woff', 'woff2', 'eot',
  'sqlite', 'db', 'mdb', 'dat',
  // graphics/CAD project files that aren't text either
  'cdr', 'ai', 'eps', 'sketch', 'fig', 'xcf', 'blend',
]);

// Known text/source extensions — open these straight away. Anything NOT in here and NOT a known
// binary is treated as "unknown" and prompts first, so an unrecognized binary (e.g. a vendor .cdr,
// a firmware blob) can't slip through and make VS Code choke on "cannot be opened as text".
const TEXT_EXTS = new Set([
  // code
  'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'json', 'json5', 'jsonc', 'py', 'rb', 'php', 'phtml',
  'java', 'c', 'h', 'cpp', 'hpp', 'cc', 'cxx', 'cs', 'go', 'rs', 'swift', 'kt', 'kts', 'scala',
  'lua', 'pl', 'pm', 'r', 'dart', 'ex', 'exs', 'erl', 'hs', 'clj', 'groovy', 'vb', 'fs', 'fsx',
  'sh', 'bash', 'zsh', 'fish', 'bat', 'cmd', 'ps1', 'psm1', 'sql', 'graphql', 'gql', 'proto',
  // web / markup / style
  'html', 'htm', 'xhtml', 'css', 'scss', 'sass', 'less', 'vue', 'svelte', 'astro', 'xml', 'svg',
  // config / data
  'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'config', 'properties', 'env', 'editorconfig',
  'gitignore', 'gitattributes', 'dockerignore', 'csv', 'tsv', 'tab',
  // docs / text / logs
  'txt', 'text', 'md', 'markdown', 'rst', 'adoc', 'asciidoc', 'tex', 'log', 'nfo', 'srt', 'vtt',
  'diff', 'patch', 'lock',
]);

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

// Decide how to open a just-downloaded file: open it, or ask first (binary / oversized). Returns
// silently without opening when the user declines — the download itself already succeeded.
export async function openDownloadedFile(
  uri: vscode.Uri,
  option?: vscode.TextDocumentShowOptions
): Promise<void> {
  let size = 0;
  try {
    size = fs.statSync(uri.fsPath).size;
  } catch (e) {
    // Can't stat (vanished, permissions) — fall back to the normal open path.
  }

  const name = path.basename(uri.fsPath);
  const ext = path.extname(name).slice(1).toLowerCase();
  const isLarge = size > LARGE_FILE_BYTES;
  const isBinary = BINARY_EXTS.has(ext);
  // Extensionless files (Makefile, Dockerfile, LICENSE, README) are almost always text.
  const isText = ext === '' || TEXT_EXTS.has(ext);

  // Open straight away ONLY for recognized text/source that isn't huge. Everything else — known
  // binary, oversized, OR an unrecognized type — prompts first, so VS Code never tries to render a
  // blob as text.
  if (isText && !isLarge) {
    await showTextDocument(uri, option);
    return;
  }

  // Build a reason for the prompt. Large wins over binary/unknown because size is the worst hazard.
  let question: string;
  if (isLarge) {
    question = L({
      en: `"${name}" is ${humanSize(size)} (over 10 MB). Opening large files in VS Code can freeze the editor. Open it anyway?`,
      ru: `Файл «${name}» весит ${humanSize(size)} (больше 10 МБ). Большие файлы могут подвесить редактор VS Code. Всё равно открыть?`,
    });
  } else if (isBinary) {
    question = L({
      en: `"${name}" looks like a binary file (.${ext}). VS Code can't display it as text and may freeze. Open it anyway?`,
      ru: `Файл «${name}» похож на бинарный (.${ext}). VS Code не покажет его как текст и может подвиснуть. Всё равно открыть?`,
    });
  } else {
    question = L({
      en: `"${name}" is not a recognized text file (.${ext}). It may be binary and could make VS Code choke. Open it anyway?`,
      ru: `Тип файла «${name}» (.${ext}) не распознан как текстовый — возможно, он бинарный и подвесит VS Code. Всё равно открыть?`,
    });
  }

  const OPEN = L({ en: 'Open', ru: 'Открыть' });
  const REVEAL = L({ en: 'Reveal in Explorer', ru: 'Показать в проводнике' });
  const choice = await vscode.window.showWarningMessage(
    question,
    { modal: true },
    { title: OPEN },
    { title: REVEAL }
  );

  if (!choice) {
    return; // dismissed / "Cancel" — leave the file downloaded but unopened
  }
  if (choice.title === REVEAL) {
    vscode.commands.executeCommand('revealFileInOS', uri);
    return;
  }
  await showTextDocument(uri, option);
}
