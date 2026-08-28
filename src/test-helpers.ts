import type { ConversationHandleClient } from './client.js';
import { EXTENSION_ID } from './schema/draft/schema.js';

export function flipHandleByte(handle: string): string {
  const raw = Buffer.from(handle, 'base64url');
  const mutated = Buffer.from(raw);
  mutated[mutated.length - 1]! ^= 0x01;
  return mutated.toString('base64url');
}

/** Inject a handle with an explicit advisory seq (required — no silent coercion). */
export function setClientSession(
  client: ConversationHandleClient,
  session: { handle: string; highestSeq: number },
  sessionKey = 'default',
): void {
  if (!Number.isSafeInteger(session.highestSeq) || session.highestSeq < 0) {
    throw new Error('setClientSession requires a non-negative integer highestSeq');
  }
  client.clear(sessionKey);
  client.acceptResponseMeta(
    {
      [EXTENSION_ID]: {
        handle: session.handle,
        seq: session.highestSeq,
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
  highestSeq: number,
  sessionKey = 'default',
): void {
  setClientSession(client, { handle, highestSeq }, sessionKey);
}
