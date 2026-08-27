import { CID_BYTE_LENGTH } from './schema/draft/schema.js';

const CONVERSATION_ID_PATTERN = /^[0-9a-f]{32}$/;

export function cidToHex(cid: Uint8Array): string {
  return Buffer.from(cid).toString('hex');
}

export function cidToConversationId(cid: Uint8Array): string {
  if (cid.length !== CID_BYTE_LENGTH) {
    throw new Error(`cid must be ${CID_BYTE_LENGTH} bytes`);
  }
  return cidToHex(cid);
}

export function conversationIdToCid(conversationId: string): Uint8Array {
  if (!CONVERSATION_ID_PATTERN.test(conversationId)) {
    throw new Error(`conversationId must be ${CID_BYTE_LENGTH * 2} lowercase hex characters`);
  }
  const bytes = Buffer.from(conversationId, 'hex');
  return new Uint8Array(bytes);
}
