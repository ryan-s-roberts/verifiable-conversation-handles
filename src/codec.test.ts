import { describe, expect, it } from 'vitest';
import { flipHandleByte, mintHandle, verifyHandle, type HandleKey } from './codec.js';
import { CID_BYTE_LENGTH } from './schema/draft/schema.js';

const keys: HandleKey[] = [
  { keyId: 0, secret: Buffer.from('primary-key-material-32-bytes!!') },
  { keyId: 1, secret: Buffer.from('secondary-key-material-32-bytes!') },
];

const FAR_FUTURE_EXP = 4_000_000_000;

const cid = new Uint8Array(CID_BYTE_LENGTH).fill(0xab);
const BASE64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

describe('codec §6.2', () => {
  it('sep-0000-s6.2-roundtrip', () => {
    const handle = mintHandle(keys, {
      cid,
      exp: 1_900_000_000,
      seq: 7,
      state: new TextEncoder().encode('v1'),
      keyId: 0,
    });
    const decoded = verifyHandle(keys, handle, { now: () => 1_800_000_000 });
    expect(decoded).toMatchObject({ keyId: 0, exp: 1_900_000_000, seq: 7 });
    expect(Buffer.from(decoded!.state).toString()).toBe('v1');
  });

  it('sep-0000-handle-carries-no-principal + sep-0000-no-identifying-data-in-handle: §6.2 body has no principal field', () => {
    const handle = mintHandle(keys, { cid, exp: FAR_FUTURE_EXP, seq: 1, keyId: 0 });
    const decoded = verifyHandle(keys, handle);
    expect(decoded).toBeTruthy();
    expect(Object.keys(decoded!)).toEqual(
      expect.arrayContaining(['version', 'keyId', 'cid', 'exp', 'seq', 'state']),
    );
    expect(Object.keys(decoded!)).toHaveLength(6);
  });

  it('sep-0000-reject-bad-tag-regardless-of-fields rejects tampered tag', () => {
    const handle = mintHandle(keys, { cid, exp: FAR_FUTURE_EXP, seq: 1, keyId: 0 });
    const tampered = flipHandleByte(handle);
    expect(verifyHandle(keys, tampered)).toBeNull();
  });

  it.each([
    ['junk characters', '!'],
    ['padding', '='],
    ['whitespace', '\n'],
  ])('rejects %s in base64url handles', (_description, suffix) => {
    const handle = mintHandle(keys, { cid, exp: FAR_FUTURE_EXP, seq: 1, keyId: 0 });
    expect(verifyHandle(keys, `${handle}${suffix}`)).toBeNull();
  });

  it('rejects the standard base64 alphabet', () => {
    const handle = mintHandle(keys, { cid, exp: FAR_FUTURE_EXP, seq: 1, keyId: 0 });
    const standardBase64 = handle.replace('-', '+');

    expect(standardBase64).not.toBe(handle);
    expect(Buffer.from(standardBase64, 'base64url')).toEqual(Buffer.from(handle, 'base64url'));
    expect(verifyHandle(keys, standardBase64)).toBeNull();
  });

  it('rejects non-canonical base64url trailing bits', () => {
    const handle = mintHandle(keys, { cid, exp: FAR_FUTURE_EXP, seq: 1, keyId: 0 });
    const lastIndex = BASE64URL_ALPHABET.indexOf(handle.at(-1)!);
    const nonCanonical = `${handle.slice(0, -1)}${BASE64URL_ALPHABET[lastIndex + 1]}`;

    expect(lastIndex & 0x0f).toBe(0);
    expect(Buffer.from(nonCanonical, 'base64url')).toEqual(Buffer.from(handle, 'base64url'));
    expect(verifyHandle(keys, nonCanonical)).toBeNull();
  });

  it.each([CID_BYTE_LENGTH - 1, CID_BYTE_LENGTH + 1])(
    'rejects minting with a %i-byte cid',
    (length) => {
      expect(() =>
        mintHandle(keys, {
          cid: new Uint8Array(length),
          exp: FAR_FUTURE_EXP,
          seq: 1,
          keyId: 0,
        }),
      ).toThrow(`cid must be ${CID_BYTE_LENGTH} bytes`);
    },
  );

  it('sep-0000-s6.2-dual-key-id', () => {
    const h0 = mintHandle(keys, { cid, exp: FAR_FUTURE_EXP, seq: 1, keyId: 0 });
    const h1 = mintHandle(keys, { cid, exp: FAR_FUTURE_EXP, seq: 2, keyId: 1 });
    expect(verifyHandle(keys, h0)?.keyId).toBe(0);
    expect(verifyHandle(keys, h1)?.keyId).toBe(1);
  });

  it('sep-0000-reject-expired-except-exchange rejects expired unless allowExpired', () => {
    const handle = mintHandle(keys, { cid, exp: 1_000, seq: 1, keyId: 0 });
    expect(verifyHandle(keys, handle, { now: () => 2_000 })).toBeNull();
    expect(verifyHandle(keys, handle, { now: () => 2_000, allowExpired: true })?.exp).toBe(1_000);
  });
});
