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

describe('conversation-handle e2e errors and meta', () => {

  it('sep-0000-respect-max-handle-bytes: rejects handles above client maxHandleBytes', async () => {
    const harness = await startTestHarness();
    try {
      let stolen = '';
      await withClient(harness, 'alice', async (client, handleClient) => {
        await callMemoryAppend(client, handleClient, 'x');
        stolen = handleClient.getHandle()!;
      });
      await withClient(harness, 'alice', async (client, handleClient) => {
        handleClient.testOnlySetHandle(stolen);
        const meta = {
          ...handleClient.buildRequestMeta(),
          [CLIENT_CAPABILITIES_META_KEY]: {
            extensions: { [EXTENSION_ID]: { maxHandleBytes: 8 } },
          },
          [EXTENSION_ID]: { handle: stolen },
        };
        const read = await client.callTool({
          name: 'memory_read',
          arguments: {},
          _meta: meta,
        });
        expect(read).toMatchObject({ isError: true });
        expect(textFromResult(read)).toMatch(/maxHandleBytes/i);
      });
    } finally {
      await harness.close();
    }
  });

  it('sep-0000-error-code-range + sep-0000-actionable-failure-error: handle errors use normative §8 envelope', async () => {
    const harness = await startTestHarness();
    try {
      await withClient(harness, 'alice', async (client, handleClient) => {
        await callMemoryAppend(client, handleClient, 'x');
        handleClient.testOnlySetHandle(flipHandleByte(handleClient.getHandle()!));
        const read = await client.callTool({
          name: 'memory_read',
          arguments: {},
          _meta: handleClient.buildRequestMeta(),
        });
        expect(read).toMatchObject({ isError: true });
        const envelope = parseCallToolHandleError(read);
        expect(envelope?.code).toBe(ERROR_CODE_HANDLE_NOT_RECOGNIZED);
        expect(envelope?.message).toBe('Conversation handle not recognised');
        expect(envelope?.data).toMatchObject({
          extension: EXTENSION_ID,
          reason: 'handle_invalid',
        });
        expect(envelope?.data.remediation).toMatch(/re-send|omit/i);
      });
    } finally {
      await harness.close();
    }
  });

  it('sep-0000-retired-cid-not-silently-reused: retired conversation handle is rejected', async () => {
    let now = 1_000_000;
    const harness = await startTestHarness({ now: () => now, retentionSeconds: 60 });
    try {
      let retiredHandle = '';
      await withClient(harness, 'alice', async (client, handleClient) => {
        await callMemoryAppend(client, handleClient, 'old');
        retiredHandle = handleClient.getHandle()!;
        now += 120_000;
        expect(harness.manager.purgeExpiredConversations()).toBe(1);
      });
      await withClient(harness, 'alice', async (client, handleClient) => {
        handleClient.testOnlySetSession({ handle: retiredHandle, highestSeq: 1 });
        const read = await client.callTool({
          name: 'memory_read',
          arguments: {},
          _meta: handleClient.buildRequestMeta(),
        });
        expect(read).toMatchObject({ isError: true });
        expect(textFromResult(read)).toMatch(/retired/i);
        expect(parseCallToolHandleError(read)?.data.reason).toBe('handle_retired');
      });
    } finally {
      await harness.close();
    }
  });

  it('sep-0000-handle-rejected-by-other-server: foreign deployment keys are not honoured', async () => {
    const harness = await startTestHarness();
    try {
      await withClient(harness, 'alice', async (client, handleClient) => {
        const foreign = mintHandle(OTHER_SERVER_KEYS, {
          cid: new Uint8Array(CID_BYTE_LENGTH).fill(0xcd),
          exp: 4_000_000_000,
          seq: 1,
          keyId: 0,
        });
        handleClient.testOnlySetHandle(foreign);
        const read = await callMemoryRead(client, handleClient);
        expect(read.result).toMatchObject({ isError: true });
        expect(textFromResult(read.result)).toBe('Conversation handle not recognised');
      });
    } finally {
      await harness.close();
    }
  });

  it('sep-0000-missing-capability-error: handle without client extension advertisement is rejected', async () => {
    const harness = await startTestHarness();
    try {
      await withClient(harness, 'alice', async (client, handleClient) => {
        await callMemoryAppend(client, handleClient, 'x');
        const handle = handleClient.getHandle()!;
        const result = await client.callTool({
          name: 'memory_read',
          arguments: {},
          _meta: {
            [EXTENSION_ID]: { handle },
          },
        });
        expect(result).toMatchObject({ isError: true });
        const envelope = parseCallToolHandleError(result);
        expect(envelope?.code).toBe(MISSING_REQUIRED_CLIENT_CAPABILITY);
      });
    } finally {
      await harness.close();
    }
  });

  it('sep-0000-handle-carried-in-meta: handle travels in extension request meta', async () => {
    const harness = await startTestHarness();
    try {
      await withClient(harness, 'alice', async (client, handleClient) => {
        await callMemoryAppend(client, handleClient, 'meta-path');
        const meta = handleClient.buildRequestMeta();
        expect((meta[EXTENSION_ID] as { handle: string }).handle).toBe(handleClient.getHandle());
        const read = await client.callTool({
          name: 'memory_read',
          arguments: {},
          _meta: meta,
        });
        expect(textFromResult(read)).toBe('["meta-path"]');
      });
    } finally {
      await harness.close();
    }
  });
});
