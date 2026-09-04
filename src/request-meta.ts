import type { ServerContext } from '@modelcontextprotocol/server';
import { CLIENT_CAPABILITIES_META_KEY } from './meta-keys.js';
import {
  EXTENSION_ID,
  type ConversationHandleRequestMeta,
} from './schema/draft/schema.js';

/**
 * The SDK validates and lifts reserved wire `_meta` keys into `mcpReq.envelope` before dispatch.
 * Non-reserved extension metadata remains in `mcpReq._meta`.
 */
export function readClientCapabilities(ctx: ServerContext): Record<string, unknown> | undefined {
  const envelope = ctx.mcpReq.envelope as Record<string, unknown> | undefined;
  const capabilities = envelope?.[CLIENT_CAPABILITIES_META_KEY];
  return isRecord(capabilities) ? capabilities : undefined;
}

export function clientAdvertisesExtension(ctx: ServerContext): boolean {
  const caps = readClientCapabilities(ctx);
  const extensions = caps?.extensions;
  return isRecord(extensions) && extensions[EXTENSION_ID] !== undefined;
}

export function readRequestMeta(ctx: ServerContext): ConversationHandleRequestMeta | undefined {
  const meta = ctx.mcpReq._meta as Record<string, unknown> | undefined;
  const requestMeta = meta?.[EXTENSION_ID];
  return isRecord(requestMeta) ? (requestMeta as ConversationHandleRequestMeta) : undefined;
}

export function readClientMaxHandleBytes(ctx: ServerContext): number | undefined {
  const caps = readClientCapabilities(ctx);
  const extensions = caps?.extensions;
  if (!isRecord(extensions)) {
    return undefined;
  }
  const clientSettings = extensions[EXTENSION_ID];
  if (!isRecord(clientSettings)) {
    return undefined;
  }
  const maxHandleBytes = clientSettings.maxHandleBytes;
  return typeof maxHandleBytes === 'number' &&
    Number.isSafeInteger(maxHandleBytes) &&
    maxHandleBytes > 0
    ? maxHandleBytes
    : undefined;
}

export function readPresentedHandle(ctx: ServerContext): string | undefined {
  const requestMeta = readRequestMeta(ctx);
  const handle = requestMeta?.handle;
  return typeof handle === 'string' && handle.length > 0 ? handle : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
