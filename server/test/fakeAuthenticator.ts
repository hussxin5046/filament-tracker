import { createHash, createSign, generateKeyPairSync, randomBytes, type KeyObject } from 'node:crypto';

/**
 * A pretend passkey device for tests: it makes a key pair and answers the two WebAuthn requests the way a
 * phone or security key would, so the server's real checking (the library's) can be run against it.
 * It verifies nothing itself and is never part of the app.
 */

// ---- Just enough CBOR to write an attestation object and a COSE key ------------------------------

function head(major: number, value: number): Buffer {
  if (value < 24) return Buffer.from([(major << 5) | value]);
  if (value < 256) return Buffer.from([(major << 5) | 24, value]);
  const out = Buffer.alloc(3);
  out[0] = (major << 5) | 25;
  out.writeUInt16BE(value, 1);
  return out;
}

type Cbor = number | string | Buffer | Map<number | string, Cbor>;

function cbor(value: Cbor): Buffer {
  if (typeof value === 'number') return value >= 0 ? head(0, value) : head(1, -1 - value);
  if (typeof value === 'string') return Buffer.concat([head(3, Buffer.byteLength(value)), Buffer.from(value)]);
  if (Buffer.isBuffer(value)) return Buffer.concat([head(2, value.length), value]);
  return Buffer.concat([head(5, value.size), ...[...value].flatMap(([key, item]) => [cbor(key), cbor(item)])]);
}

const sha256 = (data: Buffer | string) => createHash('sha256').update(data).digest();
const b64 = (data: Buffer) => data.toString('base64url');

export interface FakePasskeyOptions {
  /** Where the browser says it is. */
  origin: string;
  /** The site the passkey is for. */
  site: string;
  /** Whether the device checks its owner (fingerprint, PIN). Real passkeys do. */
  verifiesUser?: boolean;
  /** Whether it says it is kept in a synced account. Such passkeys always report a counter of 0. */
  synced?: boolean;
}

export class FakePasskey {
  readonly id = randomBytes(16);
  /** How many times it has signed. Tests may set it back, to play a copied passkey. */
  counter = 0;
  private readonly key: KeyObject;
  private readonly publicKey: KeyObject;
  /** Whose passkey it is, as the server told it when it was made. */
  private userHandle: string | null = null;

  constructor(public options: FakePasskeyOptions) {
    const pair = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    this.key = pair.privateKey;
    this.publicKey = pair.publicKey;
  }

  private flags(attested: boolean): number {
    // User present, user verified, backup eligible, backed up, attested credential data included.
    return 0x01 | (this.options.verifiesUser === false ? 0 : 0x04) | (this.options.synced ? 0x08 | 0x10 : 0) | (attested ? 0x40 : 0);
  }

  private authenticatorData(attested: boolean): Buffer {
    const counter = Buffer.alloc(4);
    counter.writeUInt32BE(this.options.synced ? 0 : this.counter);
    const start = Buffer.concat([sha256(this.options.site), Buffer.from([this.flags(attested)]), counter]);
    if (!attested) return start;
    const jwk = this.publicKey.export({ format: 'jwk' });
    // A COSE key: EC2, ES256, P-256, x, y.
    const coseKey = cbor(new Map<number, Cbor>([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x!, 'base64url')], [-3, Buffer.from(jwk.y!, 'base64url')]]));
    const length = Buffer.alloc(2);
    length.writeUInt16BE(this.id.length);
    return Buffer.concat([start, Buffer.alloc(16), length, this.id, coseKey]);
  }

  private clientData(type: 'webauthn.create' | 'webauthn.get', challenge: string): Buffer {
    return Buffer.from(JSON.stringify({ type, challenge, origin: this.options.origin, crossOrigin: false }));
  }

  /** The answer to "make a passkey", for the options the server's add/start gave. */
  create(options: { challenge: string; user: { id: string } }) {
    this.userHandle = options.user.id;
    const clientDataJSON = this.clientData('webauthn.create', options.challenge);
    const attestationObject = cbor(new Map<string, Cbor>([['fmt', 'none'], ['attStmt', new Map()], ['authData', this.authenticatorData(true)]]));
    return {
      id: b64(this.id),
      rawId: b64(this.id),
      type: 'public-key',
      authenticatorAttachment: 'platform',
      clientExtensionResults: {},
      response: { clientDataJSON: b64(clientDataJSON), attestationObject: b64(attestationObject), transports: ['internal'] },
    };
  }

  /** The answer to "sign in", for the options the server's sign-in/start gave. Each use moves the counter on. */
  get(options: { challenge: string }) {
    this.counter += 1;
    const clientDataJSON = this.clientData('webauthn.get', options.challenge);
    const authenticatorData = this.authenticatorData(false);
    const signature = createSign('SHA256').update(Buffer.concat([authenticatorData, sha256(clientDataJSON)])).sign(this.key);
    return {
      id: b64(this.id),
      rawId: b64(this.id),
      type: 'public-key',
      authenticatorAttachment: 'platform',
      clientExtensionResults: {},
      response: { clientDataJSON: b64(clientDataJSON), authenticatorData: b64(authenticatorData), signature: b64(signature), userHandle: this.userHandle ?? undefined },
    };
  }
}
