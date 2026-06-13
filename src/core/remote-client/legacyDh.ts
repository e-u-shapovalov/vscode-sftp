import * as crypto from 'crypto';

// VS Code runs the extension host on Electron, whose crypto backend (BoringSSL) does not
// implement classic finite-field Diffie-Hellman: `crypto.createDiffieHellmanGroup('modp2')`
// throws "Unknown DH group", and `createDiffieHellman(prime, gen)` is equally unavailable.
// Modern servers are unaffected because they offer curve25519/ecdh (a separate EC code path
// that BoringSSL supports), but ancient servers that only speak `diffie-hellman-group1-sha1`
// (and friends) become unreachable — ssh2 negotiates the algorithm, then dies computing it.
//
// The DH math itself is trivial: pick a random x, compute g^x mod p. For the named MODP
// groups the prime/generator are fixed public constants (RFC 2409 / RFC 3526); for
// group-exchange the server supplies the prime. None of it needs a native crypto provider,
// so we patch the two factory functions to fall back to a BigInt implementation whenever the
// native one throws. Native is still preferred wherever it works — normal connections are
// untouched, this only rescues the cases that would otherwise hard-fail.

// Fixed MODP groups, prime as uppercase hex, generator 2. Verified byte-for-byte against
// Node's native createDiffieHellmanGroup(). These cover diffie-hellman-group1-sha1 (modp2)
// and diffie-hellman-group14-sha1/sha256 (modp14) — the groups legacy SSH servers actually use.
const MODP_GROUPS: { [name: string]: string } = {
  modp2:
    'FFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD129024E088A67CC74' +
    '020BBEA63B139B22514A08798E3404DDEF9519B3CD3A431B302B0A6DF25F1437' +
    '4FE1356D6D51C245E485B576625E7EC6F44C42E9A637ED6B0BFF5CB6F406B7ED' +
    'EE386BFB5A899FA5AE9F24117C4B1FE649286651ECE65381FFFFFFFFFFFFFFFF',
  modp14:
    'FFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD129024E088A67CC74' +
    '020BBEA63B139B22514A08798E3404DDEF9519B3CD3A431B302B0A6DF25F1437' +
    '4FE1356D6D51C245E485B576625E7EC6F44C42E9A637ED6B0BFF5CB6F406B7ED' +
    'EE386BFB5A899FA5AE9F24117C4B1FE649286651ECE45B3DC2007CB8A163BF05' +
    '98DA48361C55D39A69163FA8FD24CF5F83655D23DCA3AD961C62F356208552BB' +
    '9ED529077096966D670C354E4ABC9804F1746C08CA18217C32905E462E36CE3B' +
    'E39E772C180E86039B2783A2EC07A28FB5C55DF06F4C52C9DE2BCBF695581718' +
    '3995497CEA956AE515D2261898FA051015728E5A8AACAA68FFFFFFFFFFFFFFFF',
};

// tsconfig targets es6, where BigInt *literals* (0n, 1n, …) are a syntax error even though the
// runtime supports BigInt fine — so build the small constants via BigInt() instead.
const ZERO = BigInt(0);
const ONE = BigInt(1);
const TWO = BigInt(2);
const THREE = BigInt(3);

function bufToBig(buf: Buffer): bigint {
  return buf.length ? BigInt('0x' + buf.toString('hex')) : ZERO;
}

function bigToBuf(n: bigint): Buffer {
  let hex = n.toString(16);
  if (hex.length % 2) {
    hex = '0' + hex;
  }
  return Buffer.from(hex, 'hex');
}

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = ONE;
  base %= mod;
  while (exp > ZERO) {
    if (exp & ONE) {
      result = (result * base) % mod;
    }
    exp >>= ONE;
    base = (base * base) % mod;
  }
  return result;
}

// Mimics the slice of the Node DiffieHellman interface that ssh2's kex.js touches:
// generateKeys(), computeSecret(), getPrime(), getGenerator() (see ssh2/lib/protocol/kex.js).
class BigIntDiffieHellman {
  private readonly p: bigint;
  private readonly g: bigint;
  private priv: bigint = ZERO;

  constructor(prime: Buffer, generator: Buffer | number) {
    this.p = bufToBig(prime);
    this.g =
      typeof generator === 'number' ? BigInt(generator) : bufToBig(generator);
  }

  generateKeys(): Buffer {
    // Ephemeral private exponent in [2, p-2]. randomBytes is plenty of entropy for a
    // one-shot handshake key; reducing into range keeps it a valid exponent.
    const byteLen = (this.p.toString(16).length + 1) >> 1;
    // BigInt % of two positives is always >= 0, so x lands in [0, p-4] and priv in [2, p-2].
    const x = bufToBig(crypto.randomBytes(byteLen)) % (this.p - THREE);
    this.priv = x + TWO;
    return bigToBuf(modPow(this.g, this.priv, this.p));
  }

  computeSecret(otherPublicKey: Buffer): Buffer {
    return bigToBuf(modPow(bufToBig(Buffer.from(otherPublicKey)), this.priv, this.p));
  }

  getPrime(): Buffer {
    return bigToBuf(this.p);
  }

  getGenerator(): Buffer {
    return bigToBuf(this.g);
  }
}

let installed = false;

export function installLegacyDhSupport(): void {
  if (installed) {
    return;
  }
  installed = true;

  const anyCrypto = crypto as any;
  const nativeGroup = anyCrypto.createDiffieHellmanGroup;
  const nativeCreate = anyCrypto.createDiffieHellman;

  // Named MODP groups (diffie-hellman-group1/14-*).
  anyCrypto.createDiffieHellmanGroup = function patchedGroup(name: string) {
    try {
      return nativeGroup.call(this, name);
    } catch (err) {
      const prime = MODP_GROUPS[name];
      if (prime) {
        return new BigIntDiffieHellman(Buffer.from(prime, 'hex'), 2);
      }
      throw err;
    }
  };

  // Group-exchange: server supplies an arbitrary prime/generator.
  anyCrypto.createDiffieHellman = function patchedCreate(
    prime: Buffer | number,
    generator?: Buffer | number
  ) {
    try {
      return nativeCreate.call(this, prime, generator);
    } catch (err) {
      // Only the (primeBuffer, generator) form is part of the DH KEX path; leave the
      // numeric "generate a prime" overload to fail natively as before.
      if (Buffer.isBuffer(prime)) {
        return new BigIntDiffieHellman(prime, generator === undefined ? 2 : generator);
      }
      throw err;
    }
  };
}

// Patch on module load (side effect). sshClient.ts imports this module immediately before the
// ssh2 import precisely so this runs before ssh2's kex.js captures the crypto factories.
installLegacyDhSupport();
