import { describe, expect, it } from 'vitest';
import { flipHandleByte, mintHandle } from '../../src/codec.js';
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

describe('conversation-handle e2e fork and lists', () => {

  it('sep-0000-fork-mints-fresh-cid: fork mints new conversation without shared memory', async () => {
    const harness = await startTestHarness();
    try {
      await withClient(harness, 'alice', async (client, handleClient) => {
        await callMemoryAppend(client, handleClient, 'parent-data');
        const parent = await callMemoryAppend(client, handleClient, 'parent-data-2');
        const parentId = (parent.handleMeta as { conversationId: string }).conversationId;
        const parentHandle = handleClient.getHandle()!;
        expect((parent.handleMeta as { seq: number }).seq).toBeGreaterThan(1);
        const forked = await client.callTool({
          name: 'memory_read',
          arguments: {},
          _meta: handleClient.buildRequestMeta('default', { fork: true }),
        });
        handleClient.acceptResponseMeta(
          (forked as { _meta?: Record<string, unknown> })._meta,
          'fork',
        );
        const forkMeta = metaFromResult(forked) as {
          conversationId: string;
          handle: string;
          seq: number;
        };
        const forkId = forkMeta.conversationId;
        expect(forkId).not.toBe(parentId);
        expect(forkMeta.seq).toBe(1);
        expect(textFromResult(forked)).toBe('[]');
        expect(handleClient.getSession()).toMatchObject({
          conversationId: parentId,
          handle: parentHandle,
        });
        expect(handleClient.getSession('fork')).toMatchObject({
          conversationId: forkId,
          handle: forkMeta.handle,
          highestSeq: 1,
        });

        const parentRead = await callMemoryRead(client, handleClient);
        expect(textFromResult(parentRead.result)).toBe('["parent-data","parent-data-2"]');
      });
    } finally {
      await harness.close();
    }
  });

  it('sep-0000-lists-invariant-across-conversations: tools/list unchanged by handle presence', async () => {
    const harness = await startTestHarness();
    try {
      await withClient(harness, 'alice', async (client, handleClient) => {
        const before = await client.listTools();
        await callMemoryAppend(client, handleClient, 'x');
        const after = await client.listTools({ _meta: handleClient.buildRequestMeta() });
        expect(after.tools?.map((t) => t.name).sort()).toEqual(before.tools?.map((t) => t.name).sort());
        handleClient.clear();
        const second = await callMemoryAppend(client, handleClient, 'y');
        const lists = await Promise.all([
          client.listTools({ _meta: handleClient.buildRequestMeta() }),
          client.listTools(),
        ]);
        expect(lists[0].tools?.map((t) => t.name).sort()).toEqual(lists[1].tools?.map((t) => t.name).sort());
        expect((second.handleMeta as { conversationId: string }).conversationId).toBeDefined();
      });
    } finally {
      await harness.close();
    }
  });

  it('sep-0000-mint-or-decline-per-setting: no handle when configured to none', async () => {
    const harness = await startTestHarness({ onMissingHandle: 'none' });
    try {
      await withClient(harness, 'alice', async (client, handleClient) => {
        const result = await client.callTool({
          name: 'memory_read',
          arguments: {},
          _meta: handleClient.buildRequestMeta(),
        });
        expect(metaFromResult(result)).toBeUndefined();
      });
    } finally {
      await harness.close();
    }
  });
});
