const {
  stripSecretsForIdentity,
  hostIdentity,
} = require('../src/core/connectionIdentity');

describe('connection identity (secret-free, stable)', () => {
  test('strips top-level password/passphrase/privateKey', () => {
    const stripped = stripSecretsForIdentity({
      host: 'h',
      port: 22,
      username: 'u',
      protocol: 'sftp',
      password: 'pw',
      passphrase: 'pp',
      privateKey: 'KEY',
    });
    expect(stripped).toEqual({ host: 'h', port: 22, username: 'u', protocol: 'sftp' });
  });

  test('strips secrets inside a hop/jump-host block (deep, not just top level)', () => {
    const stripped = stripSecretsForIdentity({
      host: 'target',
      username: 'u',
      protocol: 'sftp',
      hop: { host: 'bastion', username: 'b', password: 'hoppw', privateKey: 'HOPKEY' },
    });
    expect(stripped.hop).toEqual({ host: 'bastion', username: 'b' });
  });

  test('strips secrets across an array of hops', () => {
    const stripped = stripSecretsForIdentity({
      host: 'target',
      hop: [
        { host: 'h1', password: 'p1' },
        { host: 'h2', privateKey: 'K2', passphrase: 'pp2' },
      ],
    });
    expect(stripped.hop).toEqual([{ host: 'h1' }, { host: 'h2' }]);
  });

  test('reduces interactiveAuth predefined answers to a bare boolean', () => {
    const stripped = stripSecretsForIdentity({
      host: 'h',
      interactiveAuth: ['otp-123456', 'secret-answer'],
    });
    expect(stripped.interactiveAuth).toBe(true);
  });

  test('identity stays stable when SSHClient fills hop.privateKey after reading the key file', () => {
    const before = hostIdentity({
      host: 'target',
      username: 'u',
      protocol: 'sftp',
      hop: { host: 'bastion', privateKeyPath: '~/.ssh/id' },
    });
    // privateKeyPath is read and hop.privateKey is written back mid-connect; the identity used for
    // the pending "save credential?" lookup must NOT change, or the offer is lost / never cleared.
    const after = hostIdentity({
      host: 'target',
      username: 'u',
      protocol: 'sftp',
      hop: { host: 'bastion', privateKeyPath: '~/.ssh/id', privateKey: 'PEM-BYTES' },
    });
    expect(after).toBe(before);
  });

  test('identity is key-order-independent but distinguishes different servers', () => {
    const a = hostIdentity({ host: 'h', port: 22, username: 'u', protocol: 'sftp' });
    const b = hostIdentity({ protocol: 'sftp', username: 'u', port: 22, host: 'h' });
    expect(a).toBe(b);
    expect(hostIdentity({ host: 'h', port: 2222, username: 'u', protocol: 'sftp' })).not.toBe(a);
  });

  test('does not mutate the input object (incl. nested hop)', () => {
    const input = { host: 'h', password: 'pw', hop: { host: 'b', password: 'hp' } };
    stripSecretsForIdentity(input);
    expect(input.password).toBe('pw');
    expect(input.hop.password).toBe('hp');
  });
});
