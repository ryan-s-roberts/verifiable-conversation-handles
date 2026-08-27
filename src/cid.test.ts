import { describe, expect, it } from 'vitest';
import { cidToConversationId, conversationIdToCid } from './cid.js';
import { CID_BYTE_LENGTH } from './schema/draft/schema.js';

describe('conversation id codec', () => {
  it('round-trips a canonical conversation id', () => {
    const cid = new Uint8Array(CID_BYTE_LENGTH).fill(0xab);
    const conversationId = cidToConversationId(cid);

    expect(conversationId).toBe('ab'.repeat(CID_BYTE_LENGTH));
    expect(conversationIdToCid(conversationId)).toEqual(cid);
  });

  it.each([
    ['too short', 'ab'.repeat(CID_BYTE_LENGTH - 1)],
    ['too long', 'ab'.repeat(CID_BYTE_LENGTH + 1)],
    ['odd length', `${'ab'.repeat(CID_BYTE_LENGTH)}a`],
    ['non-hex characters', `${'ab'.repeat(CID_BYTE_LENGTH - 1)}zz`],
    ['trailing junk', `${'ab'.repeat(CID_BYTE_LENGTH)}zz`],
    ['whitespace', `${'ab'.repeat(CID_BYTE_LENGTH)} `],
    ['non-canonical uppercase', 'AB'.repeat(CID_BYTE_LENGTH)],
  ])('rejects a %s conversation id', (_description, conversationId) => {
    expect(() => conversationIdToCid(conversationId)).toThrow(
      `conversationId must be ${CID_BYTE_LENGTH * 2} lowercase hex characters`,
    );
  });
});
