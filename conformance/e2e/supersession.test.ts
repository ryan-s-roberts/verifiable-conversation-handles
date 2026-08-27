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

describe('conversation-handle e2e supersession', () => {

  it('sep-0000-superseded-flag-set: stale seq sets supersededHandlePresented', async () => {
    const harness = await startTestHarness();
    try {
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
    } finally {
      await harness.close();
    }
  });

  it('sep-0000-supersession-not-rejected: superseded handle still succeeds', async () => {
    const harness = await startTestHarness();
    try {
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
    } finally {
      await harness.close();
    }
  });

  it('sep-0000-superseded-handle-not-assumed-current: stale handle sees current state after rotation', async () => {
    const harness = await startTestHarness();
    try {
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
    } finally {
      await harness.close();
    }
  });
});
