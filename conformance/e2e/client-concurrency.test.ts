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

describe('conversation-handle e2e client concurrency', () => {

  it('sep-0000-client-sends-highest-seq: out-of-order accept keeps highest seq for next request', async () => {
    const harness = await startTestHarness();
    try {
      await withClient(harness, 'alice', async (client, handleClient) => {
        await callMemoryAppend(client, handleClient, 'seed');
        const second = await callMemoryAppend(client, handleClient, 'two');
        const fourth = await callMemoryAppend(client, handleClient, 'four');
        handleClient.clear();
        acceptMetaOutOfOrder(handleClient, [
          { [EXTENSION_ID]: fourth.handleMeta },
          { [EXTENSION_ID]: second.handleMeta },
        ]);
        expect(handleClient.getSession().highestSeq).toBe(
          (fourth.handleMeta as { seq: number }).seq,
        );
        const read = await callMemoryRead(client, handleClient);
        expect(read.result).not.toMatchObject({ isError: true });
        expect(textFromResult(read.result)).toBe('["seed","two","four"]');
      });
    } finally {
      await harness.close();
    }
  });

  it('sep-0000-client-discards-lower-seq: lower seq accept does not regress stored handle', async () => {
    const harness = await startTestHarness();
    try {
      await withClient(harness, 'alice', async (_client, handleClient) => {
        acceptMetaOutOfOrder(handleClient, [
          {
            [EXTENSION_ID]: {
              handle: 'high-handle',
              conversationId: 'abc',
              seq: 5,
              expiresAt: 4_000_000_000,
              supersededHandlePresented: false,
            },
          },
          {
            [EXTENSION_ID]: {
              handle: 'low-handle',
              conversationId: 'abc',
              seq: 2,
              expiresAt: 4_000_000_000,
              supersededHandlePresented: false,
            },
          },
        ]);
        expect(handleClient.getHandle()).toBe('high-handle');
        expect(handleClient.getSession().highestSeq).toBe(5);
      });
    } finally {
      await harness.close();
    }
  });

  it('sep-0000-client-concurrency-parallel: parallel appends complete and client tracks highest seq', async () => {
    const harness = await startTestHarness();
    try {
      await withClient(harness, 'alice', async (client, handleClient) => {
        await callMemoryAppend(client, handleClient, 'seed');
        const meta = handleClient.buildRequestMeta();
        const results = await Promise.all(
          ['a', 'b', 'c'].map((text) =>
            client.callTool({
              name: 'memory_append',
              arguments: { text },
              _meta: meta,
            }),
          ),
        );
        for (const result of results) {
          handleClient.acceptResponseMeta((result as { _meta?: Record<string, unknown> })._meta);
        }
        const seqs = results
          .map((r) => handleMetaFromResult(r)?.seq)
          .filter((s): s is number => typeof s === 'number');
        expect(seqs.length).toBe(3);
        expect(handleClient.getSession().highestSeq).toBe(Math.max(...seqs));
        const read = await callMemoryRead(client, handleClient);
        const memory = JSON.parse(textFromResult(read.result)) as string[];
        expect(memory).toContain('seed');
        expect(memory).toContain('a');
        expect(memory).toContain('b');
        expect(memory).toContain('c');
      });
    } finally {
      await harness.close();
    }
  });

  it('sep-0000-client-concurrency-interleaved: stale in-flight handle converges after newer seq accepted', async () => {
    const harness = await startTestHarness();
    try {
      await withClient(harness, 'alice', async (client, handleClient) => {
        const first = await callMemoryAppend(client, handleClient, 'seed');
        const staleHandle = (first.handleMeta as { handle: string }).handle;
        const staleMeta = {
          ...handleClient.buildRequestMeta(),
          [EXTENSION_ID]: { handle: staleHandle },
        };
        const inflight = client.callTool({
          name: 'memory_append',
          arguments: { text: 'from-stale' },
          _meta: staleMeta,
        });
        const fresh = await callMemoryAppend(client, handleClient, 'fresh');
        const staleResult = await inflight;
        handleClient.acceptResponseMeta((staleResult as { _meta?: Record<string, unknown> })._meta);
        expect(handleClient.getSession().highestSeq).toBe(
          Math.max(
            (fresh.handleMeta as { seq: number }).seq,
            handleMetaFromResult(staleResult)?.seq ?? 0,
          ),
        );
        const read = await callMemoryRead(client, handleClient);
        const memory = JSON.parse(textFromResult(read.result)) as string[];
        expect(memory).toContain('seed');
        expect(memory).toContain('from-stale');
        expect(memory).toContain('fresh');
      });
    } finally {
      await harness.close();
    }
  });
});
