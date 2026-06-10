import { modify, applyEdits, parse as parseJsonc, FormattingOptions } from 'jsonc-parser';

export interface Rename {
  from: string; // e.g. "sftp.debug"
  to: string; // e.g. "wireferry.debug"
}

const WF_KEY = /^(wireferry|sftp)\./;

// Insert grouped: position a new WireFerry key right after the last existing wireferry.*/sftp.*
// key, so all WireFerry-related settings stay clustered together (user requirement). Falls back
// to the end of the object when none exist yet.
function groupedInsertionIndex(properties: string[]): number {
  let idx = properties.length;
  for (let i = 0; i < properties.length; i++) {
    if (WF_KEY.test(properties[i])) {
      idx = i + 1;
    }
  }
  return idx;
}

// Rename legacy sftp.<key> settings to wireferry.<key> in a settings.json text, preserving each
// value and keeping the WireFerry keys grouped. Pure string -> string (JSONC-aware), so it
// survives comments/formatting and is unit-testable. Returns the original text unchanged if a
// rename's source key is absent or its target already exists.
export function migrateSettingsText(text: string, renames: ReadonlyArray<Rename>): string {
  const eol = text.indexOf('\r\n') !== -1 ? '\r\n' : '\n';
  const formattingOptions: FormattingOptions = { tabSize: 4, insertSpaces: true, eol };

  let out = text;
  for (const { from, to } of renames) {
    const current = parseJsonc(out) || {};
    if (!(from in current) || to in current) {
      continue; // nothing to move, or destination already set — don't clobber
    }
    const value = current[from];
    // Remove the legacy key, then add the new one at the grouped position.
    out = applyEdits(out, modify(out, [from], undefined, { formattingOptions }));
    out = applyEdits(
      out,
      modify(out, [to], value, { formattingOptions, getInsertionIndex: groupedInsertionIndex })
    );
  }
  return out;
}
