import * as vscode from 'vscode';
import * as fse from 'fs-extra';
import * as path from 'path';
import * as Joi from 'joi';
import { parse as parseJsonc, printParseErrorCode, ParseError } from 'jsonc-parser';
import { CONFIG_PATH, LEGACY_CONFIG_PATH } from '../constants';
import { reportError } from '../helper';
import { showTextDocument } from '../host';
import { getConfigTemplate } from './legacyDoctor/template';
import { getAlertLang } from '../i18n';

const nullable = schema => schema.optional().allow(null);

const configScheme = {
  name: Joi.string(),

  context: Joi.string(),
  protocol: Joi.any().valid('sftp', 'ftp', 'local'),

  host: Joi.string().required(),
  port: Joi.number().integer(),
  connectTimeout: Joi.number().integer(),
  username: Joi.string().required(),
  password: nullable(Joi.string()),

  agent: nullable(Joi.string()),
  privateKeyPath: nullable(Joi.string()),
  passphrase: nullable(Joi.string().allow(true)),
  interactiveAuth: Joi.alternatives([
    Joi.boolean(),
    Joi.array()
      .items(Joi.string()),
  ]).optional(),
  algorithms: Joi.any(),
  sshConfigPath: Joi.string(),
  sshCustomParams: Joi.string(),

  secure: Joi.any().valid(true, false, 'control', 'implicit'),
  secureOptions: nullable(Joi.object()),
  passive: Joi.boolean(),

  remotePath: Joi.string().required(),
  uploadOnSave: Joi.boolean(),
  useTempFile: Joi.boolean(),
  openSsh: Joi.boolean(),
  downloadOnOpen: Joi.boolean().allow('confirm'),

  ignore: Joi.array()
    .min(0)
    .items(Joi.string()),
  ignoreFile: Joi.string(),
  watcher: {
    files: Joi.string().allow(false, null),
    autoUpload: Joi.boolean(),
  },
  concurrency: Joi.number().integer(),

  syncOption: {
    delete: Joi.boolean(),
    skipCreate: Joi.boolean(),
    ignoreExisting: Joi.boolean(),
    update: Joi.boolean(),
  },
  remoteTimeOffsetInHours: Joi.number(),

  remoteExplorer: {
    filesExclude: Joi.array()
      .min(0)
      .items(Joi.string()),
    order: Joi.number(),
  },

  // Opt-out marker written by the legacy-config migration prompt: when true, WireFerry stops
  // offering to rename .vscode/sftp.json -> wireferry.json. Declared here so it isn't flagged
  // as an unknown key by the legacy doctor's config scan.
  keepLegacyConfigFormat: Joi.boolean(),
};

const defaultConfig = {
  // common
  // name: undefined,
  remotePath: './',
  uploadOnSave: false,
  useTempFile: false,
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

// Top-level config keys WireFerry recognises. Single source of truth for the legacy doctor's
// "unknown key" scan (src/modules/legacyDoctor). Derived from `configScheme` plus keys that
// exist in the JSON schema (schema/definitions.json) / at runtime but aren't in the Joi shape.
export const KNOWN_CONFIG_KEYS: ReadonlyArray<string> = [
  ...Object.keys(configScheme),
  'filePerm',
  'dirPerm',
  'defaultProfile',
  'limitOpenFilesOnRemote',
  'hop',
  'profiles',
  'remote',
];

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
async function resolveConfigPath(basePath): Promise<string | null> {
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

export function validateConfig(config) {
  const { error } = Joi.validate(config, configScheme, {
    allowUnknown: true,
    convert: false,
    language: {
      object: {
        child: '!!prop "{{!child}}" fails because {{reason}}',
      },
    },
  });
  return error;
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
