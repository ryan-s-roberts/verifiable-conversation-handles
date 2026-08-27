import { describe, expect, it } from 'vitest';
import { setClientHandle } from '../../src/test-helpers.js';
import {
  callMemoryAppend,
  callMemoryRead,
  handleMetaFromResult,
  textFromResult,
  withClient,
  withHarness,
} from '../harness.js';

/**
 * SEP-0000 e2e: superseded-handle presentation (§4.3).
 *
 * Stale but authentic handles must succeed, set `supersededHandlePresented`, and observe current
 * server state — not the commitment embedded in the presented handle.
 */
describe('conversation-handle e2e supersession', () => {
  /** §4.3: presenting seq < latest sets `supersededHandlePresented: true` in response meta. */
  it('sep-0000-superseded-flag-set: stale seq sets supersededHandlePresented', async () => {
    await withHarness(async (harness) => {
      await withClient(harness, 'alice', async (client, handleClient) => {
        await callMemoryAppend(client, handleClient, 'one');
        const stale = handleClient.getHandle()!;
        const conversationId = handleClient.getSession().conversationId!;
        await callMemoryAppend(client, handleClient, 'two');
        setClientHandle(handleClient, stale, conversationId);
        const read = await client.callTool({
          name: 'memory_append',
          arguments: { text: 'three' },
          _meta: handleClient.buildRequestMeta(),
        });
        handleClient.acceptResponseMeta((read as { _meta?: Record<string, unknown> })._meta);
        expect(read).not.toMatchObject({ isError: true });
        expect(handleMetaFromResult(read)?.supersededHandlePresented).toBe(true);
      });
    });
  });

  /** §4.3: superseded handles are not rejected — request still succeeds. */
  it('sep-0000-supersession-not-rejected: superseded handle still succeeds', async () => {
    await withHarness(async (harness) => {
      await withClient(harness, 'alice', async (client, handleClient) => {
        await callMemoryAppend(client, handleClient, 'one');
        const stale = handleClient.getHandle()!;
        const conversationId = handleClient.getSession().conversationId!;
        await callMemoryAppend(client, handleClient, 'two');
        setClientHandle(handleClient, stale, conversationId);
        const result = await client.callTool({
          name: 'memory_read',
          arguments: {},
          _meta: handleClient.buildRequestMeta(),
        });
        expect(result).not.toMatchObject({ isError: true });
        expect(textFromResult(result)).toBe('["one","two"]');
      });
    });
  });

  /**
   * §4.3: mutation on a superseded handle applies to current state (memory includes prior
   * writes), not a fork from the stale commitment.
   */
  it('sep-0000-superseded-handle-not-assumed-current: stale handle sees current state after rotation', async () => {
    await withHarness(async (harness) => {
      await withClient(harness, 'alice', async (client, handleClient) => {
        await callMemoryAppend(client, handleClient, 'one');
        const stale = handleClient.getHandle()!;
        const conversationId = handleClient.getSession().conversationId!;
        await callMemoryAppend(client, handleClient, 'two');
        setClientHandle(handleClient, stale, conversationId);
        const append = await client.callTool({
          name: 'memory_append',
          arguments: { text: 'three' },
          _meta: handleClient.buildRequestMeta(),
        });
        handleClient.acceptResponseMeta((append as { _meta?: Record<string, unknown> })._meta);
        const read = await callMemoryRead(client, handleClient);
        expect(textFromResult(read.result)).toBe('["one","two","three"]');
      });
    });
  });
});
