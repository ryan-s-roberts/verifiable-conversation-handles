import { describe, expect, it } from 'vitest';
import { mintHandle } from '../../src/codec.js';
import { flipHandleByte, setClientHandle } from '../../src/test-helpers.js';
import { EXTENSION_ID, CID_BYTE_LENGTH } from '../../src/schema/draft/schema.js';
import { TEST_KEYS, callMemoryAppend, callMemoryRead, textFromResult, withClient, withHarness } from '../harness.js';

/**
 * SEP-0000 e2e: security and binding (§2.1, §5.1, §6).
 *
 * Opaque handle storage, forgery rejection, principal isolation, handle ≠ authorization,
 * argument/meta binding rules, and advisory mirror rejection.
 */
describe('conversation-handle e2e security', () => {
  /** §5.1: client stores the handle JSON string verbatim from response meta. */
  it('sep-0000-handle-is-json-string + sep-0000-client-returns-handle-verbatim: client stores handle verbatim only', async () => {
    await withHarness(async (harness) => {
      await withClient(harness, 'alice', async (client, handleClient) => {
        const { handleMeta } = await callMemoryAppend(client, handleClient, 'opaque');
        const stored = handleClient.getHandle();
        expect(typeof stored).toBe('string');
        expect(stored).toBe((handleMeta as { handle: string }).handle);
      });
    });
  });

  /** §6: single-byte tamper fails integrity verification with actionable error. */
  it('sep-0000-reject-forged-handle: tampered handle fails integrity verification', async () => {
    await withHarness(async (harness) => {
      await withClient(harness, 'alice', async (client, handleClient) => {
        const { handleMeta } = await callMemoryAppend(client, handleClient, 'opaque');
        const mutated = flipHandleByte(handleClient.getHandle()!);
        const conversationId = (handleMeta as { conversationId: string }).conversationId;
        setClientHandle(handleClient, mutated, conversationId);
        const read = await callMemoryRead(client, handleClient);
        expect(read.result).toMatchObject({ isError: true });
        expect(textFromResult(read.result)).toContain('integrity');
      });
    });
  });

  /** §2.1: conversation state is bound to the authenticated principal, not the handle alone. */
  it('sep-0000-no-cross-principal-conversation-state: bob cannot read alice memory', async () => {
    await withHarness(async (harness) => {
      let stolen = '';
      let conversationId = '';
      await withClient(harness, 'alice', async (client, handleClient) => {
        const result = await callMemoryAppend(client, handleClient, 'secret');
        stolen = handleClient.getHandle()!;
        conversationId = (result.handleMeta as { conversationId: string }).conversationId;
      });
      await withClient(harness, 'bob', async (client, handleClient) => {
        setClientHandle(handleClient, stolen, conversationId);
        const read = await callMemoryRead(client, handleClient);
        expect(read.result).toMatchObject({ isError: true });
        expect(textFromResult(read.result)).toMatch(/principal|not own/i);
      });
    });
  });

  /**
   * §2.1: a valid handle does not substitute for bearer authentication — unauthenticated
   * callers cannot access conversation state even with a stolen handle.
   */
  it('sep-0000-handle-not-authorization + sep-0000-state-commitment-not-authorization: valid handle without bearer yields no state', async () => {
    await withHarness(async (harness) => {
      let stolen = '';
      let conversationId = '';
      await withClient(harness, 'alice', async (client, handleClient) => {
        const result = await callMemoryAppend(client, handleClient, 'secret');
        stolen = handleClient.getHandle()!;
        conversationId = (result.handleMeta as { conversationId: string }).conversationId;
      });
      await withClient(harness, undefined, async (client, handleClient) => {
        setClientHandle(handleClient, stolen, conversationId);
        const read = await callMemoryRead(client, handleClient);
        expect(read.result).toMatchObject({ isError: true });
      });
    });
  });

  /** §5.1: handle in tool arguments is ignored — only `_meta` binding resolves conversation. */
  it('sep-0000-reject-handle-in-tool-arguments: handle in tool args does not bind conversation', async () => {
    await withHarness(async (harness) => {
      await withClient(harness, 'alice', async (client, handleClient) => {
        await callMemoryAppend(client, handleClient, 'bound');
        handleClient.clear();
        const forged = mintHandle(TEST_KEYS, {
          cid: new Uint8Array(CID_BYTE_LENGTH).fill(0x01),
          exp: 4_000_000_000,
          seq: 99,
          keyId: 0,
        });
        const result = await client.callTool({
          name: 'memory_read',
          arguments: {
            [EXTENSION_ID]: { handle: forged },
          },
          _meta: handleClient.buildRequestMeta(),
        });
        handleClient.acceptResponseMeta((result as { _meta?: Record<string, unknown> })._meta);
        expect(textFromResult(result)).toBe('[]');
      });
    });
  });

  /** §4.1: omitting handle starts a fresh conversation — prior memory is not visible. */
  it('sep-0000-invalid-handle-not-resolved + sep-0000-treated-as-no-conversation: omitting handle does not see prior memory', async () => {
    await withHarness(async (harness) => {
      await withClient(harness, 'alice', async (client, handleClient) => {
        await callMemoryAppend(client, handleClient, 'prior');
        handleClient.clear();
        const read = await callMemoryRead(client, handleClient);
        expect(textFromResult(read.result)).toBe('[]');
      });
    });
  });

  /** §5.1: advisory `conversationId`/`seq` mirrors without `handle` do not resolve conversation. */
  it('sep-0000-mirrors-not-accepted-as-input: advisory mirrors without handle do not resolve conversation', async () => {
    await withHarness(async (harness) => {
      await withClient(harness, 'alice', async (client, handleClient) => {
        const { handleMeta } = await callMemoryAppend(client, handleClient, 'secret');
        const mirrors = handleMeta as { conversationId: string; seq: number };
        handleClient.clear();
        const result = await client.callTool({
          name: 'memory_read',
          arguments: {},
          _meta: {
            ...handleClient.buildRequestMeta(),
            [EXTENSION_ID]: {
              conversationId: mirrors.conversationId,
              seq: mirrors.seq,
            },
          },
        });
        handleClient.acceptResponseMeta((result as { _meta?: Record<string, unknown> })._meta);
        expect(textFromResult(result)).toBe('[]');
      });
    });
  });
});
