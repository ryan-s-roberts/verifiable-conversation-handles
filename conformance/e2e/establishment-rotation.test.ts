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

describe('conversation-handle e2e establishment and rotation', () => {

  it('sep-0000-no-dedicated-establishment-method + sep-0000-mint-or-decline-per-setting: mints handle without prior handle', async () => {
    const harness = await startTestHarness();
    try {
      await withClient(harness, 'alice', async (client, handleClient) => {
        const { handleMeta } = await callMemoryAppend(client, handleClient, 'hello');
        expect(handleMeta).toMatchObject({ seq: 1, supersededHandlePresented: false });
        expect(typeof (handleMeta as { handle?: string }).handle).toBe('string');
      });
    } finally {
      await harness.close();
    }
  });

  it('sep-0000-rotate-on-state-commitment-change + sep-0000-replacement-seq-monotonic + sep-0000-seq-strictly-increases: seq increases on state-changing response', async () => {
    const harness = await startTestHarness();
    try {
      await withClient(harness, 'alice', async (client, handleClient) => {
        const first = await callMemoryAppend(client, handleClient, 'a');
        const second = await callMemoryAppend(client, handleClient, 'b');
        expect((second.handleMeta as { seq: number }).seq).toBeGreaterThan(
          (first.handleMeta as { seq: number }).seq,
        );
        expect((second.handleMeta as { conversationId: string }).conversationId).toBe(
          (first.handleMeta as { conversationId: string }).conversationId,
        );
      });
    } finally {
      await harness.close();
    }
  });

  it('read-only call does not rotate handle when not near expiry', async () => {
    const harness = await startTestHarness();
    try {
      await withClient(harness, 'alice', async (client, handleClient) => {
        const first = await callMemoryAppend(client, handleClient, 'a');
        const beforeHandle = handleClient.getHandle();
        const read = await callMemoryRead(client, handleClient);
        expect(read.handleMeta).toBeUndefined();
        expect(handleClient.getHandle()).toBe(beforeHandle);
        expect((first.handleMeta as { seq: number }).seq).toBe(handleClient.getSession().highestSeq);
      });
    } finally {
      await harness.close();
    }
  });

  it('sep-0000-rotate-near-expiry: SHOULD rotate when remaining lifetime under half', async () => {
    let now = 1_000_000;
    const harness = await startTestHarness({
      now: () => now,
      retentionSeconds: 86_400,
    });
    try {
      await withClient(harness, 'alice', async (client, handleClient) => {
        await callMemoryAppend(client, handleClient, 'near');
        now = 2_801_000;
        const read = await callMemoryRead(client, handleClient);
        expect(read.handleMeta).toBeDefined();
        expect((read.handleMeta as { seq: number }).seq).toBeGreaterThan(1);
      });
    } finally {
      await harness.close();
    }
  });
});
