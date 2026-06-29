import * as Joi from 'joi';

const nullable = schema => schema.optional().allow(null);

const configScheme = {
  name: Joi.string(),

  context: Joi.string(),
  protocol: Joi.any().valid('sftp', 'ftp', 'local'),

  // The 'local' protocol talks to the local filesystem only, so host/username are meaningless there.
  // Requiring them unconditionally rejected every `"protocol": "local"` config; require them only for
  // the remote protocols (sftp/ftp, and an absent protocol which defaults to sftp).
  host: Joi.string().when('protocol', {
    is: 'local',
    then: Joi.optional(),
    otherwise: Joi.required(),
  }),
  port: Joi.number()
    .integer()
    .min(1)
    .max(65535),
  connectTimeout: Joi.number().integer(),
  username: Joi.string().when('protocol', {
    is: 'local',
    then: Joi.optional(),
    otherwise: Joi.required(),
  }),
  password: nullable(Joi.string()),

  agent: nullable(Joi.string()),
  privateKeyPath: nullable(Joi.string()),
  passphrase: nullable(Joi.string().allow(true)),
  interactiveAuth: Joi.alternatives()
    .try(
      Joi.boolean(),
      Joi.array()
        .items(Joi.string())
    )
    .optional(),
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
  concurrency: Joi.number()
    .integer()
    .min(1)
    .max(512),

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

  maxFileSize: Joi.number().min(0),
  keepLegacyConfigFormat: Joi.boolean(),
};

// Top-level config keys WireFerry recognises. Single source of truth for the legacy doctor's
// unknown-key scan. A few runtime/schema keys are not represented in the Joi shape.
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

// Joi 17 validates through a compiled schema instance; the root-level Joi.validate() API from
// Joi 10 no longer exists.
const configValidator = Joi.object(configScheme);

export function validateConfig(config): Joi.ValidationError | undefined {
  const { error } = configValidator.validate(config, {
    allowUnknown: true,
    convert: false,
  });
  return error;
}
