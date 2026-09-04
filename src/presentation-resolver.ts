import type { ServerContext } from '@modelcontextprotocol/server';
import { decodeHandle, type DecodedHandle } from './codec.js';
import { ConversationHandleError } from './errors.js';
import type { PluginContext } from './plugin-context.js';
import type { HandlePresentation, PresentHandleResult } from './presentation.js';
import {
  clientAdvertisesExtension,
  readClientMaxHandleBytes,
  readPresentedHandle,
  readRequestMeta,
} from './request-meta.js';
import {
  DEFAULT_ON_MISSING_HANDLE,
  ERROR_CODE_HANDLE_NOT_RECOGNIZED,
  MISSING_REQUIRED_CLIENT_CAPABILITY,
  type ConversationHandleFailureReason,
  type MissingHandlePolicy,
} from './schema/draft/schema.js';
import type { ConversationRecord } from './store.js';

function presentFailure(
  reason: ConversationHandleFailureReason,
  message: string,
  code = ERROR_CODE_HANDLE_NOT_RECOGNIZED,
): PresentHandleResult {
  return { ok: false, failure: { reason, message, code } };
}

function verifyOwnership(
  record: ConversationRecord,
  principal: string | undefined,
): PresentHandleResult | null {
  if (!principal) {
    return presentFailure('unauthenticated', 'authenticated principal required to access conversation state');
  }
  if (record.principal !== principal) {
    return presentFailure('principal_mismatch', 'presented handle is not owned by the authenticated principal');
  }
  return null;
}

function missingHandlePolicy(ctx: PluginContext, requestCtx: ServerContext): MissingHandlePolicy {
  return (
    ctx.resolveOnMissingHandle?.(requestCtx) ??
    ctx.settings.onMissingHandle ??
    DEFAULT_ON_MISSING_HANDLE
  );
}

export function presentHandle(ctx: PluginContext, requestCtx: ServerContext): PresentHandleResult {
  const presentedHandle = readPresentedHandle(requestCtx);
  if (presentedHandle && !clientAdvertisesExtension(requestCtx)) {
    return presentFailure(
      'handle_missing',
      'client did not advertise the conversation-handle extension',
      MISSING_REQUIRED_CLIENT_CAPABILITY,
    );
  }
  if (!clientAdvertisesExtension(requestCtx)) {
    return { ok: true, presentation: { kind: 'inactive' } };
  }

  const requestMeta = readRequestMeta(requestCtx);
  const clientMaxHandleBytes = readClientMaxHandleBytes(requestCtx);
  const serverMaxHandleBytes = ctx.settings.maxHandleBytes;
  const maxHandleBytes =
    clientMaxHandleBytes === undefined
      ? serverMaxHandleBytes
      : serverMaxHandleBytes === undefined
        ? clientMaxHandleBytes
        : Math.min(clientMaxHandleBytes, serverMaxHandleBytes);
  const principal = ctx.resolvePrincipal(requestCtx);

  if (!presentedHandle) {
    const policy = missingHandlePolicy(ctx, requestCtx);
    if (policy === 'reject') {
      return presentFailure('handle_missing', 'conversation handle required');
    }
    return {
      ok: true,
      presentation: {
        kind: 'absent',
        mintOnResponse: policy === 'new-conversation',
        maxHandleBytes,
      },
    };
  }

  let decoded: DecodedHandle;
  try {
    decoded = decodeHandle(ctx.keys, presentedHandle, { maxBytes: maxHandleBytes, now: ctx.nowSec });
  } catch (error) {
    if (error instanceof ConversationHandleError) {
      return presentFailure(error.reason, error.message, error.code);
    }
    return presentFailure(
      'handle_invalid',
      error instanceof Error ? error.message : 'handle integrity check failed',
    );
  }

  if (ctx.store.isRetired(decoded.cid)) {
    return presentFailure('handle_retired', 'conversation has been retired');
  }

  const record = ctx.store.get(decoded.cid);
  if (!record) {
    return presentFailure('handle_invalid', 'conversation not found for presented handle');
  }

  const ownershipFailure = verifyOwnership(record, principal);
  if (ownershipFailure) {
    return ownershipFailure;
  }

  if (decoded.exp <= ctx.nowSec()) {
    return { ok: true, presentation: { kind: 'exchange', record, decoded, maxHandleBytes } };
  }

  if (requestMeta?.fork === true) {
    return {
      ok: true,
      presentation: {
        kind: 'fork',
        parent: record,
        decoded,
        superseded: decoded.seq < record.latestSeq,
        maxHandleBytes,
      },
    };
  }

  return {
    ok: true,
    presentation: {
      kind: 'valid',
      record,
      decoded,
      superseded: decoded.seq < record.latestSeq,
      maxHandleBytes,
    },
  };
}
