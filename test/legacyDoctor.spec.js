const { parse: parseJsonc } = require('jsonc-parser');
const { scanSettings, scanConfig, offsetToLine } = require('../src/modules/legacyDoctor/scan');
const { migrateSettingsText } = require('../src/modules/legacyDoctor/autofix');
const { CONFIG_TEMPLATE } = require('../src/modules/legacyDoctor/template');

// These modules are pure (jsonc-parser only, no `vscode`), so they need no mock.
const KNOWN_SETTINGS = [
  'debug',
  'downloadWhenOpenInRemoteExplorer',
  'checkForUpdates',
  'suppressLegacyConfigNotice',
];
const KNOWN_CONFIG = [
  'name',
  'host',
  'port',
  'username',
  'password',
  'protocol',
  'remotePath',
  'context',
  'uploadOnSave',
  'keepLegacyConfigFormat',
];

describe('legacy doctor — settings scan', () => {
  test('flags a legacy sftp.<known> key as a rename, with line numbers', () => {
    const text = '{\n  "sftp.downloadWhenOpenInRemoteExplorer": true,\n  "sftp.debug": true\n}';
    const issues = scanSettings(text, 'settings.json', KNOWN_SETTINGS);
    expect(issues).toHaveLength(2);
    expect(issues[0]).toMatchObject({
      kind: 'legacy-rename',
      key: 'sftp.downloadWhenOpenInRemoteExplorer',
      replacement: 'wireferry.downloadWhenOpenInRemoteExplorer',
      line: 2,
    });
    expect(issues[1]).toMatchObject({ kind: 'legacy-rename', key: 'sftp.debug', line: 3 });
  });

  test('flags unsupported keys under either prefix', () => {
    const text = '{\n  "sftp.printDebugLog": true,\n  "wireferry.qwerty": 1\n}';
    const issues = scanSettings(text, 'settings.json', KNOWN_SETTINGS);
    expect(issues).toHaveLength(2);
    expect(issues.every(i => i.kind === 'unsupported')).toBe(true);
  });

  test('leaves valid wireferry.<known> and unrelated keys alone', () => {
    const text = '{\n  "wireferry.debug": true,\n  "editor.fontSize": 14\n}';
    expect(scanSettings(text, 'settings.json', KNOWN_SETTINGS)).toHaveLength(0);
  });

  test('survives comments (JSONC) and reports the real line', () => {
    const text = '{\n  // a legacy setting left over from SFTP Link\n  "sftp.debug": true\n}';
    const issues = scanSettings(text, 'settings.json', KNOWN_SETTINGS);
    expect(issues).toHaveLength(1);
    expect(issues[0].line).toBe(3);
  });
});

describe('legacy doctor — config scan', () => {
  test('flags unknown top-level config keys', () => {
    const text = '{\n  "host": "h",\n  "qwerty": "x"\n}';
    const issues = scanConfig(text, 'wireferry.json', KNOWN_CONFIG);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ kind: 'unsupported', key: 'qwerty', line: 3 });
  });

  test('handles an array of configs', () => {
    const text = '[\n  { "host": "h" },\n  { "bogus": 1 }\n]';
    const issues = scanConfig(text, 'config', KNOWN_CONFIG);
    expect(issues).toHaveLength(1);
    expect(issues[0].key).toBe('bogus');
  });

  test('accepts the keepLegacyConfigFormat marker', () => {
    const text = '{\n  "host": "h",\n  "keepLegacyConfigFormat": true\n}';
    expect(scanConfig(text, 'config', KNOWN_CONFIG)).toHaveLength(0);
  });
});

describe('legacy doctor — autofix (settings migration)', () => {
  test('renames sftp.* to wireferry.* preserving the value', () => {
    const text = '{\n  "sftp.debug": true\n}';
    const out = migrateSettingsText(text, [{ from: 'sftp.debug', to: 'wireferry.debug' }]);
    const parsed = parseJsonc(out);
    expect(parsed['wireferry.debug']).toBe(true);
    expect('sftp.debug' in parsed).toBe(false);
  });

  test('does not clobber an existing target key', () => {
    const text = '{\n  "sftp.debug": true,\n  "wireferry.debug": false\n}';
    const out = migrateSettingsText(text, [{ from: 'sftp.debug', to: 'wireferry.debug' }]);
    expect(parseJsonc(out)['wireferry.debug']).toBe(false);
  });

  test('clusters the migrated key next to other wireferry.* keys', () => {
    const text =
      '{\n  "sftp.debug": true,\n  "editor.fontSize": 14,\n  "wireferry.checkForUpdates": true\n}';
    const out = migrateSettingsText(text, [{ from: 'sftp.debug', to: 'wireferry.debug' }]);
    const keys = Object.keys(parseJsonc(out));
    expect(Math.abs(keys.indexOf('wireferry.debug') - keys.indexOf('wireferry.checkForUpdates'))).toBe(1);
  });
});

describe('legacy doctor — config template', () => {
  test('is valid JSONC and contains the required fields', () => {
    const errors = [];
    const parsed = parseJsonc(CONFIG_TEMPLATE, errors, { allowTrailingComma: true });
    expect(errors).toHaveLength(0);
    ['name', 'host', 'port', 'username', 'protocol', 'remotePath', 'context', 'uploadOnSave'].forEach(
      key => expect(parsed).toHaveProperty(key)
    );
  });
});

describe('offsetToLine', () => {
  test('counts newlines (1-based)', () => {
    expect(offsetToLine('a\nb\nc', 0)).toBe(1);
    expect(offsetToLine('a\nb\nc', 2)).toBe(2);
    expect(offsetToLine('a\nb\nc', 4)).toBe(3);
  });
});
