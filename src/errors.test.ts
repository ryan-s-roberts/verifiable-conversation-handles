/**
 * Unit tests for normative error surface (SEP draft §8).
 *
 * Asserts JSON-RPC and CallTool error envelopes, reason codes, and client parse round-trips.
 */
import { describe, expect, it } from 'vitest';
import {
  ConversationHandleError,
  conversationHandleToolError,
  parseCallToolHandleError,
} from './errors.js';
import {
  ERROR_CODE_HANDLE_NOT_RECOGNIZED,
  ERROR_EXTENSION_META_KEY,
  EXTENSION_ID,
  MISSING_REQUIRED_CLIENT_CAPABILITY,
} from './schema/draft/schema.js';

describe('§8 error surface', () => {
  /** §8: `ConversationHandleError.toJsonRpcError` emits the normative code, message, and remediation. */
  it('toJsonRpcError matches normative §8 shape', () => {
    const err = new ConversationHandleError('handle_invalid', 'handle integrity check failed');
    expect(err.toJsonRpcError(7)).toEqual({
      jsonrpc: '2.0',
      id: 7,
      error: {
        code: ERROR_CODE_HANDLE_NOT_RECOGNIZED,
        message: 'Conversation handle not recognised',
        data: {
          extension: EXTENSION_ID,
          reason: 'handle_invalid',
          remediation:
            'Re-send with the most recently received handle, or omit it to start a new conversation. Conversation-scoped preferences are not available without one.',
        },
      },
    });
  });

  /** §8: tool errors mirror JSON-RPC fields under `_meta[extension]`. */
  it('toCallToolErrorResult mirrors toJsonRpcError error fields in _meta', () => {
    const err = new ConversationHandleError('principal_mismatch', 'presented handle is not owned');
    const rpc = err.toJsonRpcError(1);
    const tool = err.toCallToolErrorResult();

    expect(tool.isError).toBe(true);
    expect(tool.content[0]?.text).toBe('presented handle is not owned');
    expect(tool._meta[ERROR_EXTENSION_META_KEY]).toEqual({
      code: rpc.error.code,
      message: rpc.error.message,
      data: rpc.error.data,
    });
  });

  /** §8: `conversationHandleToolError` / `parseCallToolHandleError` round-trip reason and code. */
  it('conversationHandleToolError and parseCallToolHandleError round-trip', () => {
    const tool = conversationHandleToolError('handle_too_large', 'handle exceeds maxHandleBytes');
    const parsed = parseCallToolHandleError(tool);
    expect(parsed?.code).toBe(ERROR_CODE_HANDLE_NOT_RECOGNIZED);
    expect(parsed?.data.reason).toBe('handle_too_large');
    expect(parsed?.message).toBe('Conversation handle not recognised');
  });

  /** §5.1: missing client capability advertisement uses `MissingRequiredClientCapabilityError`. */
  it('missingClientCapability uses MissingRequiredClientCapabilityError code', () => {
    const err = ConversationHandleError.missingClientCapability();
    expect(err.toJsonRpcError().error.code).toBe(MISSING_REQUIRED_CLIENT_CAPABILITY);
  });
});
