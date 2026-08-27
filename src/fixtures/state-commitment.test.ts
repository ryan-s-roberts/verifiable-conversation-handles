import { describe, expect, it } from 'vitest';
import { hashStateCommitment } from './state-commitment.js';

describe('fixture state commitment', () => {
  it('is fixed-size, deterministic, keyed, and scoped to the conversation', () => {
    const state = new TextEncoder().encode('sensitive fixture state');
    const cid = new Uint8Array(16).fill(0x01);
    const secret = new TextEncoder().encode('fixture-commitment-secret');
    const first = hashStateCommitment(state, cid, secret);
    const second = hashStateCommitment(state, cid, secret);
    const changedState = hashStateCommitment(
      new TextEncoder().encode('changed fixture state'),
      cid,
      secret,
    );
    const changedConversation = hashStateCommitment(state, new Uint8Array(16).fill(0x02), secret);
    const changedSecret = hashStateCommitment(
      state,
      cid,
      new TextEncoder().encode('other-fixture-commitment-secret'),
    );

    expect(first).toHaveLength(32);
    expect(first).toEqual(second);
    expect(first).not.toEqual(changedState);
    expect(first).not.toEqual(changedConversation);
    expect(first).not.toEqual(changedSecret);
    expect(Buffer.from(first).includes(Buffer.from('sensitive fixture state'))).toBe(false);
  });
});
