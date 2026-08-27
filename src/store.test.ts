/**
 * Unit tests for `InMemoryConversationStore` (SEP draft §2.2 server state).
 *
 * Covers compare-and-swap seq bumps used during handle rotation (§4.2) and atomic memory
 * append used by the memory fixture. Not traced in `sep-0000.yaml`; e2e tests exercise the
 * public protocol surface built on these primitives.
 */
import { describe, expect, it } from 'vitest';
import { generateCid, InMemoryConversationStore } from './store.js';

function sampleRecord(latestSeq = 0) {
  return {
    cid: generateCid(),
    principal: 'alice',
    latestSeq,
    memory: [] as string[],
    createdAtMs: Date.now(),
    retired: false,
  };
}

describe('InMemoryConversationStore.compareAndBumpSeq', () => {
  /** §4.2: successful CAS bump returns the new monotonic seq. */
  it('bumps seq when expected matches and returns the new value', () => {
    const store = new InMemoryConversationStore();
    const record = sampleRecord(0);
    store.create(record);
    expect(store.compareAndBumpSeq(record.cid, 0)).toBe(1);
    expect(store.compareAndBumpSeq(record.cid, 1)).toBe(2);
    expect(store.get(record.cid)?.latestSeq).toBe(2);
  });

  /** Concurrent rotation losers must not corrupt `latestSeq`. */
  it('returns undefined when expected seq does not match', () => {
    const store = new InMemoryConversationStore();
    const record = sampleRecord(3);
    store.create(record);
    expect(store.compareAndBumpSeq(record.cid, 2)).toBeUndefined();
    expect(store.get(record.cid)?.latestSeq).toBe(3);
  });

  /** Missing cid is a programmer error, not a silent no-op. */
  it('throws when conversation is missing', () => {
    const store = new InMemoryConversationStore();
    expect(() => store.compareAndBumpSeq(generateCid(), 0)).toThrow(/not found/);
  });
});

describe('InMemoryConversationStore.appendMemory', () => {
  /** Fixture helper: memory mutations accumulate on the conversation record. */
  it('appends atomically to conversation memory', () => {
    const store = new InMemoryConversationStore();
    const record = sampleRecord(0);
    store.create(record);
    store.appendMemory(record.cid, 'a');
    store.appendMemory(record.cid, 'b');
    expect(store.get(record.cid)?.memory).toEqual(['a', 'b']);
  });
});
