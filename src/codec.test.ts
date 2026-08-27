/**
 * Unit tests for handle codec (SEP draft §6.2 handle format and verification).
 *
 * Covers round-trip, field shape, dual key-id verification, expiry, and tamper rejection.
 * Check ids in test names map to `conformance/sep-0000.yaml`.
 */
import { describe, expect, it } from 'vitest';
import { mintHandle, verifyHandle, type HandleKey } from './codec.js';
import { CID_BYTE_LENGTH } from './schema/draft/schema.js';
import { flipHandleByte } from './test-helpers.js';

const keys: HandleKey[] = [
  { keyId: 0, secret: Buffer.from('primary-key-material-32-bytes!!') },
  { keyId: 1, secret: Buffer.from('secondary-key-material-32-bytes!') },
];

const FAR_FUTURE_EXP = 4_000_000_000;

const cid = new Uint8Array(CID_BYTE_LENGTH).fill(0xab);

describe('codec §6.2', () => {
  /** §6.2: mint → verify round-trip preserves cid, exp, seq, state, and keyId. */
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

  /** §6.2 + §2.1: decoded handle exposes only normative fields — no principal or identifying data. */
  it('sep-0000-handle-carries-no-principal + sep-0000-no-identifying-data-in-handle: §6.2 body has no principal field', () => {
    const handle = mintHandle(keys, { cid, exp: FAR_FUTURE_EXP, seq: 1, keyId: 0 });
    const decoded = verifyHandle(keys, handle);
    expect(decoded).toBeTruthy();
    expect(Object.keys(decoded!)).toEqual(
      expect.arrayContaining(['version', 'keyId', 'cid', 'exp', 'seq', 'state']),
    );
    expect(Object.keys(decoded!)).toHaveLength(6);
  });

  /** §6.2: any byte corruption (including tag) fails verification. */
  it('sep-0000-reject-bad-tag-regardless-of-fields rejects tampered tag', () => {
    const handle = mintHandle(keys, { cid, exp: FAR_FUTURE_EXP, seq: 1, keyId: 0 });
    const tampered = flipHandleByte(handle);
    expect(verifyHandle(keys, tampered)).toBeNull();
  });

  /** §6.2: server may mint with any configured keyId; verifier accepts all active keys. */
  it('sep-0000-s6.2-dual-key-id', () => {
    const h0 = mintHandle(keys, { cid, exp: FAR_FUTURE_EXP, seq: 1, keyId: 0 });
    const h1 = mintHandle(keys, { cid, exp: FAR_FUTURE_EXP, seq: 2, keyId: 1 });
    expect(verifyHandle(keys, h0)?.keyId).toBe(0);
    expect(verifyHandle(keys, h1)?.keyId).toBe(1);
  });

  /** §6.2 + §4.4: expired handles rejected unless explicitly allowed (exchange path). */
  it('sep-0000-reject-expired-except-exchange rejects expired unless allowExpired', () => {
    const handle = mintHandle(keys, { cid, exp: 1_000, seq: 1, keyId: 0 });
    expect(verifyHandle(keys, handle, { now: () => 2_000 })).toBeNull();
    expect(verifyHandle(keys, handle, { now: () => 2_000, allowExpired: true })?.exp).toBe(1_000);
  });
});
