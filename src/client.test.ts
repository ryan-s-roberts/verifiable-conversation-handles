/**
 * Unit tests for `ConversationHandleClient` (SEP draft §5 client behaviour).
 *
 * Exercises sessionKey-scoped seq ordering, handle storage, capability advertisement, and
 * `maxHandleBytes` enforcement without the HTTP harness. E2e counterparts live in
 * `conformance/e2e/client-concurrency.test.ts`. Check ids in test names map to `conformance/sep-0000.yaml`.
 */
import { describe, expect, it } from 'vitest';
import { ConversationHandleClient } from './client.js';
import { EXTENSION_ID } from './schema/draft/schema.js';
import { CLIENT_CAPABILITIES_META_KEY } from './meta-keys.js';

function handleMeta(seq: number, handle = `handle-seq-${seq}`) {
  return {
    [EXTENSION_ID]: {
      handle,
      seq,
      expiresAt: 4_000_000_000,
      supersededHandlePresented: false,
    },
  };
}

describe('ConversationHandleClient concurrency', () => {
  /** §5.2: client tracks the highest seq seen for a session key across responses. */
  it('sep-0000-client-sends-highest-seq: accepts monotonic seq updates', () => {
    const client = new ConversationHandleClient();
    client.acceptResponseMeta(handleMeta(2, 'h2'));
    client.acceptResponseMeta(handleMeta(4, 'h4'));
    expect(client.getHandle()).toBe('h4');
    expect(client.getSession().highestSeq).toBe(4);
  });

  /** §5.2: out-of-order lower-seq responses must not regress the stored handle. */
  it('sep-0000-client-discards-lower-seq: discards out-of-order lower seq responses', () => {
    const client = new ConversationHandleClient();
    client.acceptResponseMeta(handleMeta(4, 'h4'));
    client.acceptResponseMeta(handleMeta(2, 'h2'));
    expect(client.getHandle()).toBe('h4');
    expect(client.getSession().highestSeq).toBe(4);
  });

  /** §5.2: requests must carry the highest-seq handle after concurrent accepts. */
  it('sep-0000-client-orders-by-seq: buildRequestMeta sends highest-seq handle after out-of-order accept', () => {
    const client = new ConversationHandleClient();
    client.acceptResponseMeta(handleMeta(4, 'h4'));
    client.acceptResponseMeta(handleMeta(2, 'h2'));
    const meta = client.buildRequestMeta();
    expect((meta[EXTENSION_ID] as { handle: string }).handle).toBe('h4');
  });

  /** Clearing a session key drops its binding without affecting other keys. */
  it('clear resets seq tracking', () => {
    const client = new ConversationHandleClient();
    client.acceptResponseMeta(handleMeta(3, 'h3'));
    client.clear();
    expect(client.getHandle()).toBeUndefined();
    expect(client.getSession().highestSeq).toBe(0);
  });

  /** Equal seq with a different handle string is rejected for the same session key. */
  it('rejects a different handle carrying the same conversation sequence', () => {
    const client = new ConversationHandleClient();
    client.acceptResponseMeta(handleMeta(5, 'first-at-five'));
    client.acceptResponseMeta(handleMeta(5, 'second-at-five'));
    expect(client.getHandle()).toBe('first-at-five');
    expect(client.getSession().highestSeq).toBe(5);
  });

  /** Seq ordering is scoped per sessionKey — higher seq on another key does not replace. */
  it('does not compare or replace handles across session keys', () => {
    const client = new ConversationHandleClient();
    client.acceptResponseMeta(handleMeta(2, 'session-a'), 'a');
    client.acceptResponseMeta(handleMeta(99, 'session-b'), 'b');

    expect(client.getSession('a')).toMatchObject({
      handle: 'session-a',
      highestSeq: 2,
    });
    expect(client.getSession('b')).toMatchObject({
      handle: 'session-b',
      highestSeq: 99,
    });
  });

  /** Distinct session keys keep independent highest-seq state. */
  it('isolates highest sequence state across session keys', () => {
    const client = new ConversationHandleClient();
    client.acceptResponseMeta(handleMeta(4, 'h4'), 'primary');
    client.acceptResponseMeta(handleMeta(2, 'h2'), 'alias');

    expect(client.getHandle('primary')).toBe('h4');
    expect(client.getHandle('alias')).toBe('h2');
    expect(client.getSession('alias').highestSeq).toBe(2);
  });

  /** Fork responses accepted under a child session key must not replace the parent session. */
  it('keeps a higher-sequence parent when a fork is accepted into a child session', () => {
    const client = new ConversationHandleClient();
    client.acceptResponseMeta(handleMeta(2, 'parent-h2'), 'parent');
    const fork = handleMeta(1, 'child-h1');

    client.acceptResponseMeta(fork, 'parent');
    client.acceptResponseMeta(fork, 'child');

    expect(client.getSession('parent')).toMatchObject({
      handle: 'parent-h2',
      highestSeq: 2,
    });
    expect(client.getSession('child')).toMatchObject({
      handle: 'child-h1',
      highestSeq: 1,
    });
  });

  /** Advisory-only meta without a handle must not update client state. */
  it('ignores meta without handle field', () => {
    const client = new ConversationHandleClient();
    client.acceptResponseMeta(handleMeta(3, 'h3'));
    client.acceptResponseMeta({
      [EXTENSION_ID]: {
        seq: 99,
        expiresAt: 4_000_000_000,
        supersededHandlePresented: false,
      },
    });
    expect(client.getHandle()).toBe('h3');
    expect(client.getSession().highestSeq).toBe(3);
  });

  /** Malformed seq values are ignored rather than corrupting session state. */
  it('ignores invalid or missing seq in response meta', () => {
    const client = new ConversationHandleClient();
    client.acceptResponseMeta(handleMeta(4, 'h4'));
    client.acceptResponseMeta({
      [EXTENSION_ID]: {
        handle: 'no-seq-handle',
        expiresAt: 4_000_000_000,
        supersededHandlePresented: false,
      },
    });
    expect(client.getHandle()).toBe('h4');
    expect(client.getSession().highestSeq).toBe(4);
    client.acceptResponseMeta({
      [EXTENSION_ID]: {
        handle: 'nan-seq',
        seq: Number.NaN,
        expiresAt: 4_000_000_000,
        supersededHandlePresented: false,
      },
    });
    expect(client.getHandle()).toBe('h4');
  });

  /** §5.1: client rejects server handles exceeding advertised `maxHandleBytes`. */
  it('sep-0000-respect-max-handle-bytes: throws when server handle exceeds client limit', () => {
    const client = new ConversationHandleClient({ maxHandleBytes: 8 });
    expect(() =>
      client.acceptResponseMeta({
        [EXTENSION_ID]: {
          handle: 'this-handle-is-way-too-long',
          seq: 1,
          expiresAt: 4_000_000_000,
          supersededHandlePresented: false,
        },
      }),
    ).toThrow(/maxHandleBytes/i);
  });

  /** §5.1: client advertises extension capability when sending a handle. */
  it('sep-0000-client-advertises-extension: buildRequestMeta advertises extension when carrying handle', () => {
    const client = new ConversationHandleClient({ maxHandleBytes: 512 });
    client.acceptResponseMeta(handleMeta(1, 'opaque'));
    const meta = client.buildRequestMeta();
    const caps = meta[CLIENT_CAPABILITIES_META_KEY] as { extensions?: Record<string, unknown> };
    expect(caps?.extensions?.[EXTENSION_ID]).toMatchObject({ maxHandleBytes: 512 });
    expect((meta[EXTENSION_ID] as { handle: string }).handle).toBe('opaque');
  });

  /** Fresh accept after clear succeeds on the bumped generation. */
  it('allows accept after clear on the same session key', () => {
    const client = new ConversationHandleClient();
    client.acceptResponseMeta(handleMeta(3, 'before-clear'));
    client.clear();
    client.acceptResponseMeta(handleMeta(1, 'after-clear'));
    expect(client.getHandle()).toBe('after-clear');
    expect(client.getSession().highestSeq).toBe(1);
  });

  /** Clear on one session key does not clear another. */
  it('clear on one session key leaves sibling session key bound', () => {
    const client = new ConversationHandleClient();
    client.acceptResponseMeta(handleMeta(4, 'h4'), 'primary');
    client.acceptResponseMeta(handleMeta(4, 'h4-alias'), 'alias');
    client.clear('primary');
    expect(client.getHandle('primary')).toBeUndefined();
    expect(client.getHandle('alias')).toBe('h4-alias');
    expect(client.getSession('alias').highestSeq).toBe(4);
  });
});
