import { describe, expect, it } from 'vitest';
import { mintHandle } from '../../src/codec.js';
import { setClientHandle } from '../../src/test-helpers.js';
import {
  EXTENSION_ID,
  CID_BYTE_LENGTH,
  ERROR_CODE_HANDLE_NOT_RECOGNIZED,
  MISSING_REQUIRED_CLIENT_CAPABILITY,
} from '../../src/schema/draft/schema.js';
import { CLIENT_CAPABILITIES_META_KEY } from '../../src/meta-keys.js';
import { parseCallToolHandleError } from '../../src/errors.js';
import {
  acceptMetaOutOfOrder,
  callMemoryAppend,
  callMemoryRead,
  handleMetaFromResult,
  metaFromResult,
  startTestHarness,
  TEST_KEYS,
  textFromResult,
  withClient,
} from '../harness.js';
import { OTHER_SERVER_KEYS } from './shared.js';

describe('conversation-handle e2e exchange', () => {

  it('sep-0000-exchange-expired-handle + sep-0000-handle-determines-expiry: expired authentic handle resumes same cid', async () => {
    let now = 1_000_000;
    const harness = await startTestHarness({ now: () => now });
    try {
      await withClient(harness, 'alice', async (client, handleClient) => {
        const first = await callMemoryAppend(client, handleClient, 'persist');
        const conversationId = (first.handleMeta as { conversationId: string }).conversationId;
        const expired = handleClient.getHandle()!;
        now = 4_000_000_001;
        setClientHandle(handleClient, expired, conversationId);
        const exchanged = await client.callTool({
          name: 'memory_read',
          arguments: {},
          _meta: handleClient.buildRequestMeta(),
        });
        handleClient.acceptResponseMeta((exchanged as { _meta?: Record<string, unknown> })._meta);
        const meta = metaFromResult(exchanged) as { conversationId: string; handle: string };
        expect(meta.conversationId).toBe(conversationId);
        expect(typeof meta.handle).toBe('string');
        expect(textFromResult(exchanged)).toBe('');
        expect((exchanged as { content?: unknown[] }).content ?? []).toHaveLength(0);
        const after = await callMemoryRead(client, handleClient);
        expect(textFromResult(after.result)).toBe('["persist"]');
      });
    } finally {
      await harness.close();
    }
  });

  it('sep-0000-expired-handle-not-sufficient + sep-0000-reject-inauthentic-or-expired: expired handle not valid for presenting request', async () => {
    let now = 1_000_000;
    const harness = await startTestHarness({ now: () => now });
    try {
      await withClient(harness, 'alice', async (client, handleClient) => {
        const first = await callMemoryAppend(client, handleClient, 'x');
        const conversationId = (first.handleMeta as { conversationId: string }).conversationId;
        const expired = handleClient.getHandle()!;
        now = 4_000_000_001;
        setClientHandle(handleClient, expired, conversationId);
        const exchanged = await client.callTool({
          name: 'memory_read',
          arguments: {},
          _meta: handleClient.buildRequestMeta(),
        });
        expect(textFromResult(exchanged)).toBe('');
        expect(textFromResult(exchanged)).not.toBe('["x"]');
        expect(metaFromResult(exchanged)).toBeDefined();
      });
    } finally {
      await harness.close();
    }
  });

  it('sep-0000-cid-stable-across-handles: conversationId is 32 hex chars from 128-bit cid', async () => {
    const harness = await startTestHarness();
    try {
      await withClient(harness, 'alice', async (client, handleClient) => {
        const { handleMeta } = await callMemoryAppend(client, handleClient, 'entropy');
        const conversationId = (handleMeta as { conversationId: string }).conversationId;
        expect(conversationId).toMatch(/^[0-9a-f]{32}$/);
      });
    } finally {
      await harness.close();
    }
  });
});
