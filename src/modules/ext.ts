import * as vscode from 'vscode';
import { getUserSetting } from '../host';
import { invalidateAlertLangCache } from '../i18n';
import { EXTENSION_NAME } from '../constants';

// The extension was renamed sftp-link -> wireferry after a forced Marketplace takedown. Settings
// used to live under the `sftp.*` prefix, so every wireferry.* setting falls back to its sftp.*
// twin when the user hasn't set the new key — pre-rename settings.json keeps working untouched.
const LEGACY_EXTENSION_NAME = 'sftp';

// Where the post-transfer log ends up: a new editor tab (historic behaviour), the output channel
// (no tab, no focus change) or nowhere at all.
export type OperationLogMode = 'tab' | 'output' | 'off';

export interface ExtensionSetting {
  debug: boolean;
  downloadWhenOpenInRemoteExplorer: boolean;
  suppressLegacyConfigNotice: boolean;
  operationLog: OperationLogMode;
  showSizeInTree: boolean;
  sortBySizeInTree: boolean;
  profilesAsRoots: boolean;
}

// A setting counts as "set by the user" only when it has a global/workspace/folder
// value, as opposed to inheriting the package.json default. We need this so a
// legacy sftp.* value is used only as a fallback, never over an explicit wireferry.*.
function hasUserValue(config: vscode.WorkspaceConfiguration, key: string): boolean {
  const inspected = config.inspect(key);
  if (!inspected) {
    return false;
  }
  return (
    inspected.globalValue !== undefined ||
    inspected.workspaceValue !== undefined ||
    inspected.workspaceFolderValue !== undefined
  );
}

// Read one setting honouring the legacy sftp.* prefix:
//   explicit wireferry.*  ->  explicit sftp.*  ->  wireferry.* default.
function readSetting<T>(key: string, defaultValue: T): T {
  const config = getUserSetting(EXTENSION_NAME);
  if (hasUserValue(config, key)) {
    return config.get<T>(key, defaultValue);
  }

  const legacy = getUserSetting(LEGACY_EXTENSION_NAME);
  if (hasUserValue(legacy, key)) {
    return legacy.get<T>(key, defaultValue);
  }

  return config.get<T>(key, defaultValue);
}

// `unknown`, not `string`: a hand-edited settings.json can put null, a number or an object here and
// config.get hands it back verbatim, so the parameter type has to admit that.
function normalizeOperationLog(value: unknown): OperationLogMode {
  return value === 'output' || value === 'off' ? value : 'tab';
}

function readAllSettings(): ExtensionSetting {
  return {
    debug: readSetting<boolean>('debug', false),
    downloadWhenOpenInRemoteExplorer: readSetting<boolean>(
      'downloadWhenOpenInRemoteExplorer',
      true
    ),
    suppressLegacyConfigNotice: readSetting<boolean>('suppressLegacyConfigNotice', false),
    // Hand-edited settings.json can hold anything — VS Code only warns on an out-of-enum value, it
    // still hands it back verbatim. Fall back to the default rather than silently reporting nowhere.
    operationLog: normalizeOperationLog(readSetting<string>('operationLog', 'tab')),
    showSizeInTree: readSetting<boolean>('remoteExplorer.showSize', false),
    sortBySizeInTree: readSetting<boolean>('remoteExplorer.sortBySize', false),
    profilesAsRoots: readSetting<boolean>('remoteExplorer.profilesAsRoots', true),
  };
}

// A settings snapshot that lives until the next configuration change. Building it costs two
// getConfiguration + inspect calls per key (the legacy-prefix fallback), and the tree render path
// asks for it on every visible row — plus every log call checks `debug` through it.
//
// Until initExtensionSettingCache() runs the cache stays OFF and reads go straight through. That is
// deliberate: the old `debug` bug was a value captured once at module load, which then ignored the
// setting until a window reload. Here nothing can freeze at import time even if something reads
// before activation, and once the cache IS on it is thrown away the moment the user edits any
// wireferry.* or sftp.* key — so debug, operationLog and alertLanguage stay live as documented.
let cachedSetting: ExtensionSetting | undefined;
let cacheEnabled = false;

export function getExtensionSetting(): ExtensionSetting {
  if (!cacheEnabled) {
    return readAllSettings();
  }
  if (!cachedSetting) {
    cachedSetting = readAllSettings();
  }
  return cachedSetting;
}

export function initExtensionSettingCache(context: vscode.ExtensionContext): void {
  cacheEnabled = true;
  cachedSetting = undefined;
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration(EXTENSION_NAME) || e.affectsConfiguration(LEGACY_EXTENSION_NAME)) {
        cachedSetting = undefined;
        invalidateAlertLangCache();
      }
    }),
    {
      dispose: () => {
        cacheEnabled = false;
        cachedSetting = undefined;
      },
    }
  );
}
