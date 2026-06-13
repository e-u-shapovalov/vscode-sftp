import * as vscode from 'vscode';
import { getUserSetting } from '../host';
import { EXTENSION_NAME } from '../constants';

// The extension was renamed sftp-link -> wireferry after a forced Marketplace takedown. Settings
// used to live under the `sftp.*` prefix, so every wireferry.* setting falls back to its sftp.*
// twin when the user hasn't set the new key — pre-rename settings.json keeps working untouched.
const LEGACY_EXTENSION_NAME = 'sftp';

export interface ExtensionSetting {
  debug: boolean;
  downloadWhenOpenInRemoteExplorer: boolean;
  suppressLegacyConfigNotice: boolean;
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

export function getExtensionSetting(): ExtensionSetting {
  return {
    debug: readSetting<boolean>('debug', false),
    downloadWhenOpenInRemoteExplorer: readSetting<boolean>(
      'downloadWhenOpenInRemoteExplorer',
      true
    ),
    suppressLegacyConfigNotice: readSetting<boolean>('suppressLegacyConfigNotice', false),
  };
}

// Whether the user has explicitly set wireferry.<key> (or legacy sftp.<key>) anywhere — as
// opposed to merely inheriting the package.json default. Drives the update-check first-run
// consent (Part 8): if checkForUpdates was never set, ask once before touching the network.
export function isSettingExplicitlySet(key: string): boolean {
  return (
    hasUserValue(getUserSetting(EXTENSION_NAME), key) ||
    hasUserValue(getUserSetting(LEGACY_EXTENSION_NAME), key)
  );
}
