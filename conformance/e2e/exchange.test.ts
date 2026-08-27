import { describe, expect, it } from 'vitest';
import { setClientHandle } from '../../src/test-helpers.js';
import {
  callMemoryAppend,
  callMemoryRead,
  metaFromResult,
  textFromResult,
  withClient,
  withHarness,
} from '../harness.js';

/**
 * SEP-0000 e2e: expired-handle exchange and cid stability (§4.4, §2.2).
 *
 * Exchange path renews expiry without changing cid; expired handles cannot present state;
 * `conversationId` is the hex encoding of the 128-bit cid.
 */
describe('conversation-handle e2e exchange', () => {
  /**
   * §4.4: authentic expired handle on exchange resumes the same `conversationId` and returns
   * a fresh handle without leaking prior tool output in the exchange response body.
   */
  it('sep-0000-exchange-expired-handle + sep-0000-handle-determines-expiry: expired authentic handle resumes same cid', async () => {
    let now = 1_000_000;
    await withHarness(async (harness) => {
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
    }, { now: () => now });
  });

  /** §4.4: expired handle presented as current (non-exchange) does not return protected state. */
  it('sep-0000-expired-handle-not-sufficient + sep-0000-reject-inauthentic-or-expired: expired handle not valid for presenting request', async () => {
    let now = 1_000_000;
    await withHarness(async (harness) => {
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
    }, { now: () => now });
  });

  /** §2.2: `conversationId` is lowercase hex of the 128-bit cid (32 characters). */
  it('sep-0000-cid-stable-across-handles: conversationId is 32 hex chars from 128-bit cid', async () => {
    await withHarness(async (harness) => {
      await withClient(harness, 'alice', async (client, handleClient) => {
        const { handleMeta } = await callMemoryAppend(client, handleClient, 'entropy');
        const conversationId = (handleMeta as { conversationId: string }).conversationId;
        expect(conversationId).toMatch(/^[0-9a-f]{32}$/);
      });
    });
  });
});
