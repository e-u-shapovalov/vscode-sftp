const { parse: parseJsonc } = require('jsonc-parser');
const { scanSettings, scanConfig, offsetToLine } = require('../src/modules/legacyDoctor/scan');
const { migrateSettingsText } = require('../src/modules/legacyDoctor/autofix');
const { getConfigTemplate } = require('../src/modules/legacyDoctor/template');
const { ensureFilePermText } = require('../src/modules/legacyDoctor/ensureFilePerm');

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
  test.each(['en', 'ru'])('%s template is valid JSONC with the required fields', lang => {
    const errors = [];
    const parsed = parseJsonc(getConfigTemplate(lang), errors, { allowTrailingComma: true });
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

describe('legacy doctor — backfill filePerm/dirPerm (Part 7)', () => {
  test('adds both keys to a config that has neither, as octal numbers', () => {
    const text = '{\n  "host": "h",\n  "protocol": "sftp"\n}';
    const { text: out, added } = ensureFilePermText(text);
    expect(added.sort()).toEqual(['dirPerm', 'filePerm']);
    const parsed = parseJsonc(out);
    expect(parsed.filePerm).toBe(644);
    expect(parsed.dirPerm).toBe(755);
    // Existing keys survive.
    expect(parsed.host).toBe('h');
  });

  test('preserves comments and untouched keys (surgical JSONC edit)', () => {
    const text = '{\n  // my server\n  "host": "h" // inline\n}';
    const { text: out } = ensureFilePermText(text);
    expect(out).toContain('// my server');
    expect(out).toContain('// inline');
    expect(parseJsonc(out).host).toBe('h');
  });

  test('leaves an existing filePerm/dirPerm untouched (no additions)', () => {
    const text = '{\n  "host": "h",\n  "filePerm": 600,\n  "dirPerm": 700\n}';
    const { text: out, added } = ensureFilePermText(text);
    expect(added).toEqual([]);
    expect(out).toBe(text); // byte-for-byte unchanged
    const parsed = parseJsonc(out);
    expect(parsed.filePerm).toBe(600);
    expect(parsed.dirPerm).toBe(700);
  });

  test('adds only the missing one when the other is present', () => {
    const text = '{\n  "host": "h",\n  "filePerm": 640\n}';
    const { added } = ensureFilePermText(text);
    expect(added).toEqual(['dirPerm']);
  });

  test('is idempotent — a second pass adds nothing', () => {
    const once = ensureFilePermText('{\n  "host": "h"\n}');
    const twice = ensureFilePermText(once.text);
    expect(twice.added).toEqual([]);
    expect(twice.text).toBe(once.text);
  });

  test('backfills every element of a config array independently', () => {
    const text = '[\n  { "host": "a" },\n  { "host": "b", "filePerm": 600 }\n]';
    const { text: out, added } = ensureFilePermText(text);
    expect(added.sort()).toEqual(['dirPerm', 'filePerm']);
    const parsed = parseJsonc(out);
    expect(parsed[0].filePerm).toBe(644);
    expect(parsed[0].dirPerm).toBe(755);
    // The element that already had filePerm keeps its value; only its missing dirPerm is added.
    expect(parsed[1].filePerm).toBe(600);
    expect(parsed[1].dirPerm).toBe(755);
  });

  test('skips a local-protocol server (perms are a remote concept)', () => {
    const text = '{\n  "protocol": "local",\n  "context": "./"\n}';
    const { text: out, added } = ensureFilePermText(text);
    expect(added).toEqual([]);
    expect(out).toBe(text);
  });
});
