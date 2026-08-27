/**
 * Unit tests for memory fixture state-commitment codec (SEP draft §3).
 *
 * `encodeMemoryHead` / `decodeMemoryHead` embed conversation memory in the opaque `state` bytes
 * carried inside handles. Used by the memory e2e harness, not traced directly in sep-0000.yaml.
 */
import { describe, expect, it } from 'vitest';
import { decodeMemoryHead, encodeMemoryHead } from './memory-head.js';

describe('memory-head', () => {
  /** §3: state commitment round-trips fixture memory entries. */
  it('round-trips memory entries', () => {
    const head = encodeMemoryHead(['a', 'b']);
    expect(decodeMemoryHead(head)).toEqual(['a', 'b']);
  });

  /** Empty commitment decodes as empty memory (initial conversation state). */
  it('empty bytes decode to empty memory', () => {
    expect(decodeMemoryHead(new Uint8Array(0))).toEqual([]);
  });
});
