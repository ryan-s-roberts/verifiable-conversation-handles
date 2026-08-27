/**
 * Unit tests for shared versioned JSON state-commitment wrapper (SEP draft §3).
 *
 * Provides a version byte + field name envelope so fixture heads can evolve without breaking
 * decode of older commitment shapes.
 */
import { describe, expect, it } from 'vitest';
import { decodeVersionedJsonHead, encodeVersionedJsonHead } from './versioned-json-head.js';

describe('versioned-json-head', () => {
  /** §3: versioned envelope round-trips typed payload via caller-supplied decoder. */
  it('round-trips versioned payloads', () => {
    const encoded = encodeVersionedJsonHead(1, 'items', ['a']);
    const decoded = decodeVersionedJsonHead(
      encoded,
      1,
      'items',
      (raw) => (Array.isArray(raw) ? (raw as string[]) : []),
    );
    expect(decoded).toEqual(['a']);
  });

  /** Legacy plain JSON arrays decode when a caller supplies a legacy hook. */
  it('supports legacy array decode when provided', () => {
    const legacy = new TextEncoder().encode(JSON.stringify(['legacy']));
    const decoded = decodeVersionedJsonHead(
      legacy,
      1,
      'items',
      () => [],
      (parsed) => (Array.isArray(parsed) ? (parsed as string[]) : undefined),
    );
    expect(decoded).toEqual(['legacy']);
  });
});
