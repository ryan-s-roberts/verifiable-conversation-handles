import type { ConversationHandleClient } from './client.js';
import { EXTENSION_ID } from './schema/draft/schema.js';

export function flipHandleByte(handle: string): string {
  const raw = Buffer.from(handle, 'base64url');
  const mutated = Buffer.from(raw);
  mutated[mutated.length - 1]! ^= 0x01;
  return mutated.toString('base64url');
}

export function setClientSession(
  client: ConversationHandleClient,
  session: { handle: string; conversationId: string; highestSeq?: number },
  sessionKey = 'default',
): void {
  const current = client.getSession(sessionKey);
  const seq = session.highestSeq ?? current.highestSeq;
  if (session.conversationId.length === 0) {
    throw new Error('test session requires a conversationId');
  }
  client.clear(sessionKey);

  client.acceptResponseMeta(
    {
      [EXTENSION_ID]: {
        handle: session.handle,
        conversationId: session.conversationId,
        seq,
        expiresAt: 0,
        supersededHandlePresented: false,
      },
    },
    sessionKey,
  );
}

export function setClientHandle(
  client: ConversationHandleClient,
  handle: string,
  conversationId: string,
  sessionKey = 'default',
): void {
  setClientSession(client, { handle, conversationId }, sessionKey);
}
