const { validateConfig } = require('../src/modules/configValidation');

function validConfig(overrides = {}) {
  return {
    host: 'host',
    port: 22,
    username: 'username',
    protocol: 'sftp',
    remotePath: '/',
    ignore: ['**/.vscode', '**/.git', '**/.DS_Store'],
    ...overrides,
  };
}

function expectValid(config) {
  expect(validateConfig(config)).toBeUndefined();
}

function expectInvalid(config) {
  expect(validateConfig(config)).toBeDefined();
}

describe('configuration validation', () => {
  test('accepts a complete configuration', () => {
    expectValid(
      validConfig({
        password: null,
        agent: null,
        privateKeyPath: null,
        passive: false,
        interactiveAuth: false,
        uploadOnSave: false,
        useTempFile: true,
        openSsh: false,
        watcher: {
          files: false,
          autoUpload: false,
        },
      })
    );
  });

  test('accepts partial optional settings and unknown compatibility keys', () => {
    expectValid(validConfig({ watcher: {} }));
    expectValid(validConfig({ compatibilityExtensionField: 'kept' }));
  });

  test.each(['sftp', 'ftp', 'local'])('accepts protocol %s', protocol => {
    expectValid(validConfig({ protocol }));
  });

  test('rejects an unknown protocol', () => {
    expectInvalid(validConfig({ protocol: 'unknown' }));
  });

  test('does not coerce port strings and enforces the valid port range', () => {
    expectInvalid(validConfig({ port: '22' }));
    expectInvalid(validConfig({ port: 0 }));
    expectInvalid(validConfig({ port: 65536 }));
    expectValid(validConfig({ port: 1 }));
    expectValid(validConfig({ port: 65535 }));
  });

  test('watcher files must be false, null, or a glob string', () => {
    expectValid(validConfig({ watcher: { files: false, autoUpload: false } }));
    expectValid(validConfig({ watcher: { files: '**/*.js', autoUpload: true } }));
    expectValid(validConfig({ watcher: { files: null } }));
    expectInvalid(validConfig({ watcher: { files: true } }));
  });

  test('ignore must contain strings', () => {
    expectInvalid(validConfig({ ignore: [1, '**/.git'] }));
    expectValid(validConfig({ ignore: [] }));
  });

  test('passphrase accepts strings, true, and null but rejects false', () => {
    expectValid(validConfig({ passphrase: 'secretStorage' }));
    expectValid(validConfig({ passphrase: true }));
    expectValid(validConfig({ passphrase: null }));
    expectInvalid(validConfig({ passphrase: false }));
  });

  test('interactive authentication accepts a boolean or string answers', () => {
    expectValid(validConfig({ interactiveAuth: false }));
    expectValid(validConfig({ interactiveAuth: ['answer one', 'answer two'] }));
    expectInvalid(validConfig({ interactiveAuth: [1] }));
    expectInvalid(validConfig({ interactiveAuth: 'yes' }));
  });

  test('uploadOnSave remains a boolean for profile fan-out', () => {
    expectValid(validConfig({ uploadOnSave: true }));
    expectValid(validConfig({ uploadOnSave: false }));
    expectInvalid(validConfig({ uploadOnSave: 'allProfiles' }));
  });

  test('password sentinels remain valid strings', () => {
    expectValid(validConfig({ password: 'prompt' }));
    expectValid(validConfig({ password: 'secretStorage' }));
  });
});
