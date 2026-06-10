import { parseTree, Node } from 'jsonc-parser';

// Pure scanning helpers for the legacy doctor. No `vscode` imports here so they stay unit-testable
// (test/legacyDoctor.spec.js). The orchestrator (./index) feeds them file text + known-key lists.

// Kinds of config issue the doctor reports. A plain const object (not a `const enum`) so the
// values survive transpile-only builds (jest's tsc.transpile) and are usable at runtime.
export const IssueKind = {
  // A legacy `sftp.<key>` setting that has a current `wireferry.<key>` twin — offer to rename.
  LegacyRename: 'legacy-rename',
  // A key (under either prefix, or a config field) that WireFerry no longer / never supported.
  Unsupported: 'unsupported',
} as const;

export type IssueKind = (typeof IssueKind)[keyof typeof IssueKind];

export interface Issue {
  kind: IssueKind;
  file: string;
  key: string; // full key as written, e.g. "sftp.debug" or "qwerty"
  line: number; // 1-based; 0 when the position is unknown
  replacement?: string; // for LegacyRename: the new key, e.g. "wireferry.debug"
}

// 1-based line number of a byte offset in `text`.
export function offsetToLine(text: string, offset: number): number {
  let line = 1;
  const end = Math.min(offset, text.length);
  for (let i = 0; i < end; i++) {
    if (text.charCodeAt(i) === 10 /* \n */) {
      line++;
    }
  }
  return line;
}

interface Prop {
  key: string;
  keyOffset: number;
}

// Property (key, offset) pairs of a JSONC object node, or [] when it isn't an object.
function objectProps(node: Node | undefined): Prop[] {
  if (!node || node.type !== 'object' || !node.children) {
    return [];
  }
  const props: Prop[] = [];
  for (const prop of node.children) {
    if (prop.type === 'property' && prop.children && prop.children[0]) {
      const keyNode = prop.children[0];
      if (typeof keyNode.value === 'string') {
        props.push({ key: keyNode.value, keyOffset: keyNode.offset });
      }
    }
  }
  return props;
}

// Scan a VS Code settings.json (JSONC) for WireFerry-related keys.
//   sftp.<known>     -> LegacyRename (replace with wireferry.<known>)
//   sftp.<unknown>   -> Unsupported
//   wireferry.<unknown> -> Unsupported
//   wireferry.<known>   -> fine (no issue)
// `knownSettingKeys` are the bare names from package.json contributes.configuration
// (e.g. "debug", "downloadWhenOpenInRemoteExplorer").
export function scanSettings(
  text: string,
  file: string,
  knownSettingKeys: ReadonlyArray<string>
): Issue[] {
  const issues: Issue[] = [];
  for (const { key, keyOffset } of objectProps(parseTree(text))) {
    const match = /^(sftp|wireferry)\.(.+)$/.exec(key);
    if (!match) {
      continue;
    }
    const prefix = match[1];
    const sub = match[2];
    const line = offsetToLine(text, keyOffset);
    const known = knownSettingKeys.indexOf(sub) !== -1;

    if (prefix === 'sftp' && known) {
      issues.push({
        kind: IssueKind.LegacyRename,
        file,
        key,
        line,
        replacement: `wireferry.${sub}`,
      });
    } else if (!known) {
      issues.push({
        kind: IssueKind.Unsupported,
        file,
        key,
        line,
      });
    }
  }
  return issues;
}

// Scan a .vscode/{wireferry,sftp}.json config (JSONC, single object or array of objects) for
// top-level fields outside `knownConfigKeys` (config.ts KNOWN_CONFIG_KEYS). Nested keys inside
// recognised objects (profiles/watcher/...) are intentionally not walked.
export function scanConfig(
  text: string,
  file: string,
  knownConfigKeys: ReadonlyArray<string>
): Issue[] {
  const issues: Issue[] = [];
  const root = parseTree(text);
  if (!root) {
    return issues;
  }
  const objects = root.type === 'array' ? root.children || [] : [root];
  for (const obj of objects) {
    for (const { key, keyOffset } of objectProps(obj)) {
      if (knownConfigKeys.indexOf(key) === -1) {
        issues.push({
          kind: IssueKind.Unsupported,
          file,
          key,
          line: offsetToLine(text, keyOffset),
        });
      }
    }
  }
  return issues;
}
