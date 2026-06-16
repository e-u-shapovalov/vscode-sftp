const Joi = require('joi');

const nullable = schema => schema.optional().allow(null);

const configScheme = {
  context: Joi.string(),
  protocol: Joi.any().valid('sftp', 'ftp', 'test'),

  host: Joi.string().required(),
  port: Joi.number().integer(),
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

  secure: Joi.any().valid(true, false, 'control', 'implicit').optional(),
  secureOptions: nullable(Joi.object()),
  passive: Joi.boolean().optional(),

  remotePath: Joi.string().required(),
  uploadOnSave: Joi.boolean().optional(),
  useTempFile: Joi.boolean().optional(),
  openSsh: Joi.boolean().optional(),
  ignore: Joi.array()
    .min(0)
    .items(Joi.string()),
  watcher: {
    files: Joi.string()
      .allow(false, null)
      .optional(),
    autoUpload: Joi.boolean().optional(),
  },
};

describe("validation config", () => {
  test("default config", () => {
    const config = {
      host: 'host',
      port: 22,
      username: 'username',
      password: null,
      protocol: 'sftp',
      agent: null,
      privateKeyPath: null,
      passive: false,
      interactiveAuth: false,

      remotePath: '/',
      uploadOnSave: false,

      useTempFile: false,
      openSsh: false,


      watcher: {
        files: false,
        autoUpload: false,
      },

      ignore: [
        '**/.vscode',
        '**/.git',
        '**/.DS_Store',
      ],
    };

    const result = Joi.validate(config, configScheme, {
      convert: false,
    });
    expect(result.error).toBe(null);
  });

  test("partial config", () => {
    const config = {
      host: 'host',
      port: 22,
      username: 'username',
      protocol: 'sftp',

      remotePath: '/',


      watcher: {},

      ignore: [
        '**/.vscode',
        '**/.git',
        '**/.DS_Store',
      ],
    };

    let result = Joi.validate(config, configScheme, {
      convert: false,
    });
    expect(result.error).toBe(null);

    delete config.watcher;
    result = Joi.validate(config, configScheme, {
      convert: false,
    });
    expect(result.error).toBe(null);
  });

  describe("key validaiton", () => {
    test("protocol must be one of ['sftp', 'ftp']", () => {
      const config = {
        host: 'host',
        port: 22,
        username: 'username',
        protocol: 'unknown',
        passive: false,
        interactiveAuth: false,

        remotePath: '/',
        uploadOnSave: false,

        useTempFile: false,
        openSsh: false,


        watcher: {
          files: false,
          autoUpload: false,
        },

        ignore: [
          '**/.vscode',
          '**/.git',
          '**/.DS_Store',
        ],
      };

      const result = Joi.validate(config, configScheme, {
        convert: false,
      });
      expect(result.error).not.toBe(null);
    });

    test("watcher files must be false or string", () => {
      const config = {
        host: 'host',
        port: 22,
        username: 'username',
        protocol: 'sftp',
        passive: false,
        interactiveAuth: false,

        remotePath: '/',
        uploadOnSave: false,

        useTempFile: false,
        openSsh: false,


        watcher: {
          files: false,
          autoUpload: false,
        },

        ignore: [
          '**/.vscode',
          '**/.git',
          '**/.DS_Store',
        ],
      };

      let result = Joi.validate(config, configScheme, {
        convert: false,
      });
      expect(result.error).toBe(null);

      config.watcher.files = '**/*.js';
      result = Joi.validate(config, configScheme, {
        convert: false,
      });
      expect(result.error).toBe(null);

      config.watcher.files = null;
      result = Joi.validate(config, configScheme, {
        convert: false,
      });
      expect(result.error).toBe(null);

      config.watcher.files = true;
      result = Joi.validate(config, configScheme, {
        convert: false,
      });
      expect(result.error).not.toBe(null);

      delete config.watcher;
      result = Joi.validate(config, configScheme, {
        convert: false,
      });
      expect(result.error).toBe(null);
    });

    test("ignore must be an array of string", () => {
      const config = {
        host: 'host',
        port: 22,
        username: 'username',
        protocol: 'sftp',
        passive: false,
        interactiveAuth: false,

        remotePath: '/',
        uploadOnSave: false,

        useTempFile: false,
        openSsh: false,


        watcher: {
          files: false,
          autoUpload: false,
        },

        ignore: [
          1,
          '**/.git',
          '**/.DS_Store',
        ],
      };

      let result = Joi.validate(config, configScheme, {
        convert: false,
      });
      expect(result.error).not.toBe(null);

      config.ignore = [];
      result = Joi.validate(config, configScheme, {
        convert: false,
      });
      expect(result.error).toBe(null);
    });

    test("pass", () => {
      const config = {
        host: 'host',
        port: 22,
        username: 'username',
        protocol: 'sftp',
        passive: false,
        interactiveAuth: false,
        passphrase: 'true',

        remotePath: '/',
        uploadOnSave: false,

        useTempFile: false,
        openSsh: false,


        watcher: {
          files: false,
          autoUpload: false,
        },

        ignore: [
          '**/.git',
          '**/.DS_Store',
        ],
      };

      let result = Joi.validate(config, configScheme, {
        convert: false,
      });
      expect(result.error).toBe(null);

      config.passphrase = false;
      result = Joi.validate(config, configScheme, {
        convert: false,
      });
      expect(result.error).not.toBe(null);
    });

    test("uploadOnSave is a boolean (per-profile fan-out is driven by booleans, not a string)", () => {
      const base = {
        host: 'host',
        port: 22,
        username: 'username',
        protocol: 'sftp',
        remotePath: '/',
        ignore: [],
      };

      [true, false].forEach(value => {
        const result = Joi.validate({ ...base, uploadOnSave: value }, configScheme, {
          convert: false,
        });
        expect(result.error).toBe(null);
      });

      // A string value is rejected — each profile opts in/out with a plain boolean.
      const bad = Joi.validate({ ...base, uploadOnSave: 'allProfiles' }, configScheme, {
        convert: false,
      });
      expect(bad.error).not.toBe(null);
    });
  });
});
