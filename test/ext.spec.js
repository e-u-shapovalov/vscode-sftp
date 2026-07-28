// `vscode` is injected by the VS Code runtime, not installed in node_modules, so
// it must be mocked virtually. The mock reads from a mutable store each test fills,
// mimicking WorkspaceConfiguration: `inspect().globalValue` is defined only when the
// user actually set the key, and `get(key, default)` falls back to the default.
const mockSettings = { wireferry: {}, sftp: {} };

jest.mock(
  'vscode',
  () => ({
    workspace: {
      getConfiguration(section) {
        const store = mockSettings[section] || {};
        return {
          inspect(key) {
            return key in store
              ? { key: `${section}.${key}`, globalValue: store[key] }
              : { key: `${section}.${key}` };
          },
          get(key, defaultValue) {
            return key in store ? store[key] : defaultValue;
          },
        };
      },
    },
  }),
  { virtual: true }
);

const { getExtensionSetting } = require('../src/modules/ext');

describe('legacy sftp.* settings fallback', () => {
  beforeEach(() => {
    mockSettings.wireferry = {};
    mockSettings.sftp = {};
  });

  test('reads wireferry.* when it is set', () => {
    mockSettings.wireferry.downloadWhenOpenInRemoteExplorer = true;
    mockSettings.wireferry.debug = true;
    const setting = getExtensionSetting();
    expect(setting.downloadWhenOpenInRemoteExplorer).toBe(true);
    expect(setting.debug).toBe(true);
  });

  test('falls back to legacy sftp.* when wireferry.* is unset', () => {
    mockSettings.sftp.downloadWhenOpenInRemoteExplorer = true;
    mockSettings.sftp.debug = true;
    const setting = getExtensionSetting();
    expect(setting.downloadWhenOpenInRemoteExplorer).toBe(true);
    expect(setting.debug).toBe(true);
  });

  test('explicit wireferry.* wins over legacy sftp.* (even when false)', () => {
    mockSettings.wireferry.downloadWhenOpenInRemoteExplorer = false;
    mockSettings.sftp.downloadWhenOpenInRemoteExplorer = true;
    expect(getExtensionSetting().downloadWhenOpenInRemoteExplorer).toBe(false);
  });

  test('uses package.json defaults when neither prefix is set', () => {
    const setting = getExtensionSetting();
    // Opt-out conveniences default true; opt-in/diagnostic settings default false.
    expect(setting.downloadWhenOpenInRemoteExplorer).toBe(true);
    expect(setting.profilesAsRoots).toBe(true);
    expect(setting.debug).toBe(false);
    expect(setting.showSizeInTree).toBe(false);
    expect(setting.operationLog).toBe('tab');
  });
});

describe('operationLog normalisation', () => {
  beforeEach(() => {
    mockSettings.wireferry = {};
    mockSettings.sftp = {};
  });

  test.each(['tab', 'output', 'off'])('keeps the valid value %p', value => {
    mockSettings.wireferry.operationLog = value;
    expect(getExtensionSetting().operationLog).toBe(value);
  });

  // settings.json is hand-editable and VS Code only WARNS on an out-of-enum value — it still hands
  // it back. Anything we don't recognise has to land on the default, never on "report nowhere".
  test.each([['unknown mode', 'nowhere'], ['wrong case', 'OFF'], ['stray whitespace', 'off ']])(
    'falls back to tab on %s',
    (_label, value) => {
      mockSettings.wireferry.operationLog = value;
      expect(getExtensionSetting().operationLog).toBe('tab');
    }
  );

  test.each([['null', null], ['a number', 42], ['a boolean', true], ['an object', {}], ['an array', []], ['an empty string', '']])(
    'falls back to tab on %s',
    (_label, value) => {
      mockSettings.wireferry.operationLog = value;
      expect(getExtensionSetting().operationLog).toBe('tab');
    }
  );

  test('honours the legacy sftp.* prefix like every other setting', () => {
    mockSettings.sftp.operationLog = 'output';
    expect(getExtensionSetting().operationLog).toBe('output');
  });

  test('explicit wireferry.* wins over legacy sftp.*', () => {
    mockSettings.wireferry.operationLog = 'off';
    mockSettings.sftp.operationLog = 'output';
    expect(getExtensionSetting().operationLog).toBe('off');
  });
});
