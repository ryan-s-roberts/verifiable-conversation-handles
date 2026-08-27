import { describe, expect, it } from 'vitest';
import { EXTENSION_ID } from '../../src/schema/draft/schema.js';
import { readToolHandleMeta } from '../../src/tool-meta.js';
import { withClient, withHarness } from '../harness.js';
/**
 * SEP-0000 e2e: capability negotiation (§1, §1.1, §7).
 *
 * Exercises server `initialize`/`discover` advertisement of extension settings and per-tool
 * `_meta` marks through the memory fixture HTTP harness. Check ids in test names map to
 * `conformance/sep-0000.yaml`.
 */
describe('conversation-handle e2e negotiation', () => {
  /** §7: server advertises extension id, handle lifetime, on-missing policy, and retention. */
  it('sep-0000-server-advertises-extension + sep-0000-advertise-retention: server/discover advertises extension settings', async () => {
    await withHarness(async (harness) => {
      await withClient(harness, 'alice', async (client) => {
        const discover = await client.discover();
        const ext = discover.capabilities?.extensions?.[EXTENSION_ID] as Record<string, unknown>;
        expect(ext?.handleLifetimeSeconds).toBe(3600);
        expect(ext?.onMissingHandle).toBe('new-conversation');
        expect(ext?.conversationRetentionSeconds).toBe(86_400);
      });
    });
  });

  /** §7: `onMissingHandle` and `handleLifetimeSeconds` reflect server configuration. */
  it('sep-0000-advertise-handle-lifetime + sep-0000-advertise-on-missing-handle: settings visible on discover', async () => {
    await withHarness(async (harness) => {
      await withClient(harness, 'alice', async (client) => {
        const ext = (await client.discover()).capabilities?.extensions?.[EXTENSION_ID] as Record<
          string,
          unknown
        >;
        expect(ext?.handleLifetimeSeconds).toBe(3600);
        expect(ext?.onMissingHandle).toBe('none');
      });
    }, { onMissingHandle: 'none' });
  });

  /** §1.1: conversation-scoped tools carry a static mark on tools/list. */
  it('sep-0000-tool-mark-on-list: tools/list exposes conversation-handle marks', async () => {
    await withHarness(async (harness) => {
      await withClient(harness, 'alice', async (client) => {
        const listed = await client.listTools();
        const byName = Object.fromEntries((listed.tools ?? []).map((t) => [t.name, t]));
        expect(readToolHandleMeta(byName.memory_append)).toEqual({
          requirement: 'preferred',
          mayMint: true,
        });
        expect(readToolHandleMeta(byName.memory_read)).toEqual({
          requirement: 'preferred',
          mayMint: true,
        });
        expect(readToolHandleMeta(byName.memory_append)).toBeDefined();
        expect(readToolHandleMeta(byName.memory_append)?.requirement).toBe('preferred');
      });
    });
  });
});
