import {
  EXTENSION_ID,
  type ToolConversationHandleMeta,
  type ToolHandleRequirement,
} from './schema/draft/schema.js';

export type ToolHandleMetaBag = {
  [EXTENSION_ID]: ToolConversationHandleMeta;
};

/**
 * Build `tools/list` `_meta` marking for a conversation-scoped tool (§1.1).
 * Always advertises `mayMint: true` — callers that mint via the plugin must not lie on the wire.
 */
export function buildToolHandleMeta(requirement: ToolHandleRequirement): ToolHandleMetaBag {
  return {
    [EXTENSION_ID]: {
      requirement,
      mayMint: true,
    },
  };
}

/** Read the §1.1 mark from a `tools/list` tool descriptor, if present and well-formed. */
export function readToolHandleMeta(tool: unknown): ToolConversationHandleMeta | undefined {
  if (!tool || typeof tool !== 'object' || Array.isArray(tool)) {
    return undefined;
  }
  const meta = (tool as { _meta?: unknown })._meta;
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
    return undefined;
  }
  const payload = (meta as Record<string, unknown>)[EXTENSION_ID];
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return undefined;
  }
  const requirement = (payload as { requirement?: unknown }).requirement;
  if (requirement !== 'required' && requirement !== 'preferred') {
    return undefined;
  }
  const mayMintRaw = (payload as { mayMint?: unknown }).mayMint;
  const mayMint = typeof mayMintRaw === 'boolean' ? mayMintRaw : undefined;
  return mayMint === undefined ? { requirement } : { requirement, mayMint };
}
