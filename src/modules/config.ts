import * as vscode from 'vscode';
import * as fse from 'fs-extra';
import * as path from 'path';
import { parse as parseJsonc, printParseErrorCode, ParseError } from 'jsonc-parser';
import { CONFIG_PATH, LEGACY_CONFIG_PATH } from '../constants';
import { reportError } from '../helper';
import { showTextDocument } from '../host';
import { getConfigTemplate } from './legacyDoctor/template';
import { getAlertLang } from '../i18n';

export { KNOWN_CONFIG_KEYS, validateConfig } from './configValidation';

const defaultConfig = {
  // common
  // name: undefined,
  remotePath: './',
  uploadOnSave: false,
  // Safe by default: stage each upload/download into a unique temp file beside the target and
  // atomically rename it into place, so an interrupted transfer never truncates the existing file.
  // transferTask falls back to a direct overwrite automatically when the directory isn't writable;
  // set this to false to force a direct overwrite everywhere.
  useTempFile: true,
  openSsh: false,
  downloadOnOpen: false,
  ignore: [],
  // ignoreFile: undefined,
  // watcher: {
  //   files: false,
  //   autoUpload: false,
  // },
  concurrency: 4,
  // limitOpenFilesOnRemote: false

  protocol: 'sftp',

  // server common
  // host,
  // port,
  // username,
  // password,
  connectTimeout: 10 * 1000,

  // sftp
  // agent,
  // privateKeyPath,
  // passphrase,
  interactiveAuth: false,
  // algorithms,

  // ftp
  secure: false,
  // secureOptions,
  // passive: false,
  remoteTimeOffsetInHours: 0,

  remoteExplorer: {
    order: 0,
  },
};

function mergedDefault(config) {
  return {
    ...defaultConfig,
    ...config,
  };
}

function getConfigPath(basePath) {
  return path.join(basePath, CONFIG_PATH);
}

function getLegacyConfigPath(basePath) {
  return path.join(basePath, LEGACY_CONFIG_PATH);
}

// Resolve which config file to read: prefer the current .vscode/wireferry.json, but fall back
// to a legacy .vscode/sftp.json so projects created before the rename keep working untouched.
export async function resolveConfigPath(basePath): Promise<string | null> {
  const primary = getConfigPath(basePath);
  if (await fse.pathExists(primary)) {
    return primary;
  }

  const legacy = getLegacyConfigPath(basePath);
  if (await fse.pathExists(legacy)) {
    return legacy;
  }

  return null;
}

export function readConfigsFromFile(configPath): Promise<any[]> {
  return fse.readFile(configPath, 'utf8').then((content: string) => {
    // Parse as JSONC so a config may carry // and /* */ comments and trailing commas — the
    // generated template (src/modules/legacyDoctor/template) ships with explanatory comments.
    const errors: ParseError[] = [];
    const config = parseJsonc(content, errors, {
      allowTrailingComma: true,
      disallowComments: false,
    });
    if (errors.length) {
      const { error, offset } = errors[0];
      throw new Error(
        `Invalid JSON in ${configPath}: ${printParseErrorCode(error)} at offset ${offset}`
      );
    }
    const configs = Array.isArray(config) ? config : [config];
    return configs.map(mergedDefault);
  });
}

export function tryLoadConfigs(workspace): Promise<any[]> {
  return resolveConfigPath(workspace).then(
    configPath => {
      if (configPath) {
        return readConfigsFromFile(configPath);
      }
      return [];
    },
    _ => []
  );
}

// export function getConfig(activityPath: string) {
//   const config = configTrie.findPrefix(normalizePath(activityPath));
//   if (!config) {
//     throw new Error(`(${activityPath}) config file not found`);
//   }

//   return normalizeConfig(config);
// }

export function newConfig(basePath) {
  return resolveConfigPath(basePath)
    .then(existing => {
      // Open an existing config (current or legacy) instead of creating a duplicate.
      if (existing) {
        return showTextDocument(vscode.Uri.file(existing));
      }

      const configPath = getConfigPath(basePath);
      // Write the same fully-commented, localized template the startup doctor uses (JSONC).
      return fse
        .outputFile(configPath, getConfigTemplate(getAlertLang()))
        .then(() => showTextDocument(vscode.Uri.file(configPath)));
    })
    .catch(reportError);
}
