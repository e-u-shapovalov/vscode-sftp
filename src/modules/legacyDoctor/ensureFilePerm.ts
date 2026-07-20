import { parse as parseJsonc, modify, applyEdits, ParseError } from 'jsonc-parser';

// Default modes injected into a config that predates the filePerm/dirPerm options. They MATCH the
// runtime defaults applied in core/fileBaseOperations (0o644 / 0o755), so writing them in is
// behaviour-neutral — it only surfaces the setting so the user can see and change it (issue #2: new
// files were otherwise left at the server umask, often an insecure 666). Values are OCTAL numbers, the
// form the schema (`type: number`) and template use; parseOctalMode reads 644 as 0o644.
const FILE_PERM_DEFAULT = 644;
const DIR_PERM_DEFAULT = 755;

// jsonc-parser writes new keys with the same 4-space indentation the template and existing configs use.
const FORMAT = { formattingOptions: { tabSize: 4, insertSpaces: true } };

// Add `filePerm` / `dirPerm` to any server object that lacks them, WITHOUT touching existing keys,
// comments, or formatting (jsonc-parser edits surgically). Handles a single-object config and an array
// of server configs; a `protocol: "local"` entry is skipped (perms are a remote concept). Returns the
// possibly-rewritten text and the distinct set of keys that were added (empty = nothing to do).
export function ensureFilePermText(text: string): { text: string; added: string[] } {
  // Bail on a config that does not cleanly parse: a surgical modify() over malformed JSONC could land an
  // edit in the wrong place or further corrupt it. Leave a broken config untouched (the doctor's key
  // scan surfaces syntax problems separately). allowTrailingComma matches how configs are read elsewhere.
  const errors: ParseError[] = [];
  const parsed = parseJsonc(text, errors, { allowTrailingComma: true });
  if (errors.length > 0) {
    return { text, added: [] };
  }
  const added: string[] = [];
  let current = text;

  const ensureOn = (basePath: Array<string | number>, obj: any): void => {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
      return;
    }
    // Perms only mean something for a remote transfer; a local-protocol server has no use for them.
    if (obj.protocol === 'local') {
      return;
    }
    // Decisions read the ORIGINAL parse (obj); edits apply to the running `current` text. Inserting a
    // key never changes whether a sibling key is present, so this stays correct across both edits.
    if (obj.filePerm === undefined) {
      current = applyEdits(current, modify(current, [...basePath, 'filePerm'], FILE_PERM_DEFAULT, FORMAT));
      if (added.indexOf('filePerm') === -1) {
        added.push('filePerm');
      }
    }
    if (obj.dirPerm === undefined) {
      current = applyEdits(current, modify(current, [...basePath, 'dirPerm'], DIR_PERM_DEFAULT, FORMAT));
      if (added.indexOf('dirPerm') === -1) {
        added.push('dirPerm');
      }
    }
  };

  if (Array.isArray(parsed)) {
    parsed.forEach((el, i) => ensureOn([i], el));
  } else {
    ensureOn([], parsed);
  }

  return { text: current, added };
}
