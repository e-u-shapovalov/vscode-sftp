// `vscode` is injected by the VS Code runtime, not installed in node_modules. secrets.ts only
// uses it for TYPES (SecretStorage / Memento / ExtensionContext) — at runtime everything goes
// through the context we inject via initSecrets — so an empty virtual mock is enough.
jest.mock('vscode', () => ({}), { virtual: true });

// logger pulls in the VS Code output/status-bar UI chain at load (app.ts → createStatusBarItem),
// which the empty vscode mock can't provide. Stub it so the unit test stays isolated to the
// credential logic; secrets.ts only uses logger to surface a rare index-write failure.
jest.mock('../src/logger', () => ({
  __esModule: true,
  default: { warn() {}, info() {}, debug() {}, error() {}, trace() {}, critical() {} },
}));

const {
  initSecrets,
  credentialKey,
  getCredential,
  storeCredential,
  deleteCredential,
  listIndexedCredentials,
} = require('../src/modules/secrets');

// Minimal in-memory stand-in for ExtensionContext.secrets / .globalState.
function fakeContext() {
  const secretStore = new Map();
  const stateStore = new Map();
  return {
    secrets: {
      get: k => Promise.resolve(secretStore.has(k) ? secretStore.get(k) : undefined),
      store: (k, v) => {
        secretStore.set(k, v);
        return Promise.resolve();
      },
      delete: k => {
        secretStore.delete(k);
        return Promise.resolve();
      },
    },
    globalState: {
      get: (k, d) => (stateStore.has(k) ? stateStore.get(k) : d),
      update: (k, v) => {
        stateStore.set(k, v);
        return Promise.resolve();
      },
    },
  };
}

const desc = over => ({
  protocol: 'sftp',
  host: 'example.com',
  port: 22,
  username: 'deploy',
  type: 'password',
  ...over,
});

describe('secrets keychain wrapper', () => {
  beforeEach(() => {
    initSecrets(fakeContext());
  });

  test('key format is versioned and includes protocol/port/type', () => {
    expect(credentialKey(desc())).toBe('wireferry:v1:sftp:example.com:22:deploy:password');
  });

  test('a colon in the host (IPv6) cannot collide two distinct identities', () => {
    // Without encodeURIComponent, ('a','b:c') and ('a:b','c') would produce the same string.
    const k1 = credentialKey(desc({ host: 'a', username: 'b:c' }));
    const k2 = credentialKey(desc({ host: 'a:b', username: 'c' }));
    expect(k1).not.toBe(k2);
    expect(k1).toContain('b%3Ac'); // ':' encoded
  });

  test('store then get round-trips, and password vs passphrase are separate entries', async () => {
    await storeCredential(desc({ type: 'password' }), 'pw');
    await storeCredential(desc({ type: 'passphrase' }), 'pp');
    expect(await getCredential(desc({ type: 'password' }))).toBe('pw');
    expect(await getCredential(desc({ type: 'passphrase' }))).toBe('pp');
  });

  test('the descriptor index records stored creds without duplicates', async () => {
    await storeCredential(desc(), 'pw');
    await storeCredential(desc(), 'pw-again'); // same identity → no duplicate index row
    const list = listIndexedCredentials();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ host: 'example.com', username: 'deploy', type: 'password' });
  });

  test('delete removes both the secret and its index row', async () => {
    await storeCredential(desc(), 'pw');
    await deleteCredential(desc());
    expect(await getCredential(desc())).toBeUndefined();
    expect(listIndexedCredentials()).toHaveLength(0);
  });

  test('concurrent stores of distinct identities all survive in the index (no lost update)', async () => {
    // globalState.update with a real async gap: without a serialized read-modify-write, the two
    // later stores would read the same empty list and the last update() would clobber the rest.
    const secretStore = new Map();
    const stateStore = new Map();
    initSecrets({
      secrets: {
        get: k => Promise.resolve(secretStore.get(k)),
        store: (k, v) => {
          secretStore.set(k, v);
          return Promise.resolve();
        },
        delete: k => {
          secretStore.delete(k);
          return Promise.resolve();
        },
      },
      globalState: {
        get: (k, d) => (stateStore.has(k) ? stateStore.get(k) : d),
        update: (k, v) =>
          new Promise(resolve => {
            setImmediate(() => {
              stateStore.set(k, v);
              resolve();
            });
          }),
      },
    });

    await Promise.all([
      storeCredential(desc({ username: 'u1' }), 'pw1'),
      storeCredential(desc({ username: 'u2' }), 'pw2'),
      storeCredential(desc({ username: 'u3' }), 'pw3'),
    ]);

    const users = listIndexedCredentials()
      .map(d => d.username)
      .sort();
    expect(users).toEqual(['u1', 'u2', 'u3']);
  });

  test('reads return undefined before initSecrets wired a store (no throw)', async () => {
    // Re-require in isolation to get an uninitialised module state.
    jest.resetModules();
    const fresh = require('../src/modules/secrets');
    expect(await fresh.getCredential(desc())).toBeUndefined();
    expect(fresh.listIndexedCredentials()).toEqual([]);
  });
});
