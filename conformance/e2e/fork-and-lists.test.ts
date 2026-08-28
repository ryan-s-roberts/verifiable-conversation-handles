import { describe, expect, it } from 'vitest';
import {
  callMemoryAppend,
  callMemoryRead,
  metaFromResult,
  peekCid,
  textFromResult,
  withClient,
  withHarness,
} from '../harness.js';

/**
 * SEP-0000 e2e: fork and protocol invariants (§4.5, §7).
 *
 * Fork mints a fresh cid; tools/list is handle-independent; server may decline to mint handles.
 */
describe('conversation-handle e2e fork and lists', () => {
  /** §4.5: `fork: true` mints a new conversation with empty state, not a copy of parent memory. */
  it('sep-0000-fork-mints-fresh-cid: fork mints new conversation without shared memory', async () => {
    await withHarness(async (harness) => {
      await withClient(harness, 'alice', async (client, handleClient) => {
        await callMemoryAppend(client, handleClient, 'parent-data');
        const parent = await callMemoryAppend(client, handleClient, 'parent-data-2');
        const parentId = peekCid(parent);
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
          handle: string;
          seq: number;
        };
        const forkId = peekCid(forkMeta);
        expect(forkId).not.toBe(parentId);
        expect(forkMeta.seq).toBe(1);
        expect(textFromResult(forked)).toBe('[]');
        expect(handleClient.getSession()).toMatchObject({
          handle: parentHandle,
        });
        expect(handleClient.getSession('fork')).toMatchObject({
          handle: forkMeta.handle,
          highestSeq: 1,
        });

        const parentRead = await callMemoryRead(client, handleClient);
        expect(textFromResult(parentRead.result)).toBe('["parent-data","parent-data-2"]');
      });
    });
  });

  /** §6.4 / §1.1: handle presence must not change tools/list names or marks. */
  it('sep-0000-lists-invariant-across-conversations: tools/list unchanged by handle presence', async () => {
    await withHarness(async (harness) => {
      await withClient(harness, 'alice', async (client, handleClient) => {
        const metaByName = (tools: Array<{ name: string; _meta?: unknown }> | undefined) =>
          Object.fromEntries((tools ?? []).map((t) => [t.name, t._meta]));

        const before = await client.listTools();
        await callMemoryAppend(client, handleClient, 'x');
        const after = await client.listTools({ _meta: handleClient.buildRequestMeta() });
        expect(after.tools?.map((t) => t.name).sort()).toEqual(before.tools?.map((t) => t.name).sort());
        expect(metaByName(after.tools)).toEqual(metaByName(before.tools));
        handleClient.clear();
        const second = await callMemoryAppend(client, handleClient, 'y');
        const lists = await Promise.all([
          client.listTools({ _meta: handleClient.buildRequestMeta() }),
          client.listTools(),
        ]);
        expect(lists[0].tools?.map((t) => t.name).sort()).toEqual(lists[1].tools?.map((t) => t.name).sort());
        expect(metaByName(lists[0].tools)).toEqual(metaByName(lists[1].tools));
        expect(peekCid(second)).toMatch(/^[0-9a-f]{32}$/);
      });
    });
  });

  /** §4.1: when `onMissingHandle` is `none`, responses omit handle meta entirely. */
  it('sep-0000-mint-or-decline-per-setting: no handle when configured to none', async () => {
    await withHarness(async (harness) => {
      await withClient(harness, 'alice', async (client, handleClient) => {
        const result = await client.callTool({
          name: 'memory_read',
          arguments: {},
          _meta: handleClient.buildRequestMeta(),
        });
        expect(metaFromResult(result)).toBeUndefined();
      });
    }, { onMissingHandle: 'none' });
  });
});
