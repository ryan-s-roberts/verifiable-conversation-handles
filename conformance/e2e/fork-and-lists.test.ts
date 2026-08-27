import { describe, expect, it } from 'vitest';
import { mintHandle } from '../../src/codec.js';
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

/**
 * SEP-0000 e2e: fork and protocol invariants (§4.5, §7).
 *
 * Fork mints a fresh cid; tools/list is handle-independent; server may decline to mint handles.
 */
describe('conversation-handle e2e fork and lists', () => {

  /** §4.5: `fork: true` mints a new conversation with empty state, not a copy of parent memory. */
  it('sep-0000-fork-mints-fresh-cid: fork mints new conversation without shared memory', async () => {
    const harness = await startTestHarness();
    try {
      await withClient(harness, 'alice', async (client, handleClient) => {
        const parent = await callMemoryAppend(client, handleClient, 'parent-data');
        const parentId = (parent.handleMeta as { conversationId: string }).conversationId;
        const forked = await client.callTool({
          name: 'memory_read',
          arguments: {},
          _meta: handleClient.buildRequestMeta('default', { fork: true }),
        });
        handleClient.acceptResponseMeta((forked as { _meta?: Record<string, unknown> })._meta);
        const forkId = (metaFromResult(forked) as { conversationId: string }).conversationId;
        expect(forkId).not.toBe(parentId);
        expect(textFromResult(forked)).toBe('[]');
      });
    } finally {
      await harness.close();
    }
  });

  /** §7: handle presence must not change the tools/list catalogue. */
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

  /** §4.1: when `onMissingHandle` is `none`, responses omit handle meta entirely. */
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
