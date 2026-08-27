import { encodeHandle } from './codec.js';
import { cidToConversationId } from './cid.js';
import { ConversationHandleError } from './errors.js';
import type { PluginContext } from './plugin-context.js';
import { EXTENSION_ID } from './schema/draft/schema.js';
import type { ConversationRecord } from './store.js';

const MAX_MINT_CAS_RETRIES = 8;

export function mintResponseMeta(
  ctx: PluginContext,
  record: ConversationRecord,
  superseded: boolean,
  maxHandleBytes?: number,
): Record<string, unknown> {
  for (let attempt = 0; attempt < MAX_MINT_CAS_RETRIES; attempt++) {
    const current = ctx.store.get(record.cid) ?? record;
    const nextSeq = current.latestSeq + 1;
    const mintInput: Parameters<typeof encodeHandle>[1] = {
      cid: current.cid,
      exp: ctx.nowSec() + ctx.settings.handleLifetimeSeconds!,
      seq: nextSeq,
      keyId: ctx.activeKeyId,
    };
    if (ctx.stateCommitment) {
      mintInput.state = ctx.stateCommitment(current);
    }
    const handle = encodeHandle(ctx.keys, mintInput, { maxBytes: maxHandleBytes });
    const bumped = ctx.store.compareAndBumpSeq(current.cid, current.latestSeq);
    if (bumped === nextSeq) {
      return {
        [EXTENSION_ID]: {
          handle,
          conversationId: cidToConversationId(current.cid),
          seq: nextSeq,
          expiresAt: ctx.nowSec() + ctx.settings.handleLifetimeSeconds!,
          supersededHandlePresented: superseded,
        },
      };
    }
  }
  throw new ConversationHandleError(
    'handle_invalid',
    `failed to mint handle after ${MAX_MINT_CAS_RETRIES} seq allocation attempts`,
  );
}
