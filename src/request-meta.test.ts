import type { ServerContext } from '@modelcontextprotocol/server';
import { describe, expect, it, vi } from 'vitest';
import { parseCallToolHandleError } from './errors.js';
import { conversationHandlePlugin } from './extension.js';
import { CLIENT_CAPABILITIES_META_KEY } from './meta-keys.js';
import {
  clientAdvertisesExtension,
  readClientCapabilities,
  readClientMaxHandleBytes,
  readPresentedHandle,
} from './request-meta.js';
import { EXTENSION_ID } from './schema/draft/schema.js';

const TEST_KEYS = [{ keyId: 0, secret: Buffer.from('test-key-primary-32bytes!!!!!!') }];

function requestContext({
  meta,
  envelope,
}: {
  meta?: Record<string, unknown>;
  envelope?: Record<string, unknown>;
}): ServerContext {
  return {
    mcpReq: {
      _meta: meta,
      envelope,
    },
  } as unknown as ServerContext;
}

function advertisedContext(maxHandleBytes: unknown): ServerContext {
  return requestContext({
    envelope: {
      [CLIENT_CAPABILITIES_META_KEY]: {
        extensions: {
          [EXTENSION_ID]: { maxHandleBytes },
        },
      },
    },
  });
}

describe('request metadata', () => {
  it('reads capability and handle metadata from their protocol-defined runtime locations', () => {
    const ctx = requestContext({
      envelope: {
        [CLIENT_CAPABILITIES_META_KEY]: {
          extensions: { [EXTENSION_ID]: { maxHandleBytes: 512 } },
        },
      },
      meta: {
        [EXTENSION_ID]: { handle: 'official-handle' },
      },
    });

    expect(clientAdvertisesExtension(ctx)).toBe(true);
    expect(readClientMaxHandleBytes(ctx)).toBe(512);
    expect(readPresentedHandle(ctx)).toBe('official-handle');
  });

  it.each([
    ['unreserved envelope capabilities', { envelope: { capabilities: { extensions: { [EXTENSION_ID]: {} } } } }],
    ['unreserved request _meta capabilities', { meta: { capabilities: { extensions: { [EXTENSION_ID]: {} } } } }],
    [
      'unlifted reserved request _meta key',
      {
        meta: {
          [CLIENT_CAPABILITIES_META_KEY]: { extensions: { [EXTENSION_ID]: {} } },
        },
      },
    ],
  ])('ignores the non-runtime %s location', (_name, input) => {
    const ctx = requestContext(input);

    expect(readClientCapabilities(ctx)).toBeUndefined();
    expect(clientAdvertisesExtension(ctx)).toBe(false);
  });

  it('ignores extension metadata outside request _meta', () => {
    const ctx = requestContext({
      envelope: { [EXTENSION_ID]: { handle: 'envelope-handle' } },
    });

    expect(readPresentedHandle(ctx)).toBeUndefined();
  });

  it.each([
    ['string', '1024'],
    ['boolean', true],
    ['null', null],
    ['object', { value: 1024 }],
    ['array', [1024]],
    ['NaN', Number.NaN],
    ['positive infinity', Number.POSITIVE_INFINITY],
    ['negative infinity', Number.NEGATIVE_INFINITY],
    ['zero', 0],
    ['negative integer', -1],
    ['fraction', 1.5],
    ['unsafe integer', Number.MAX_SAFE_INTEGER + 1],
  ])('ignores an invalid maxHandleBytes %s', (_name, value) => {
    expect(readClientMaxHandleBytes(advertisedContext(value))).toBeUndefined();
  });

  it.each([1, 512, Number.MAX_SAFE_INTEGER])(
    'accepts positive safe-integer maxHandleBytes %s',
    (value) => {
      expect(readClientMaxHandleBytes(advertisedContext(value))).toBe(value);
    },
  );

  it('does not let a client raise the server handle limit', async () => {
    const handler = vi.fn(async () => ({ content: [{ type: 'text' as const, text: 'ok' }] }));
    const manager = conversationHandlePlugin({
      keys: TEST_KEYS,
      resolvePrincipal: () => 'alice',
      settings: { maxHandleBytes: 8 },
    });
    const ctx = requestContext({
      envelope: {
        [CLIENT_CAPABILITIES_META_KEY]: {
          extensions: { [EXTENSION_ID]: { maxHandleBytes: 1024 } },
        },
      },
      meta: {
        [EXTENSION_ID]: { handle: 'oversized-handle' },
      },
    });

    const result = await manager.invokeToolHandler(ctx, {}, handler);

    expect(handler).not.toHaveBeenCalled();
    expect(parseCallToolHandleError(result)?.data.reason).toBe('handle_too_large');
  });
});
