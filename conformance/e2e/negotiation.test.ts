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
 * SEP-0000 e2e: capability negotiation (§5.1, §7).
 *
 * Exercises server `initialize`/`discover` advertisement of extension settings through the
 * memory fixture HTTP harness. Check ids in test names map to `conformance/sep-0000.yaml`.
 */
describe('conversation-handle e2e negotiation', () => {
  /** §7: server advertises extension id, handle lifetime, on-missing policy, and retention. */
  it('sep-0000-server-advertises-extension + sep-0000-advertise-retention: server/discover advertises extension settings', async () => {
    const harness = await startTestHarness();
    try {
      await withClient(harness, 'alice', async (client) => {
        const discover = await client.discover();
        const ext = discover.capabilities?.extensions?.[EXTENSION_ID] as Record<string, unknown>;
        expect(ext?.handleLifetimeSeconds).toBe(3600);
        expect(ext?.onMissingHandle).toBe('new-conversation');
        expect(ext?.conversationRetentionSeconds).toBe(86_400);
      });
    } finally {
      await harness.close();
    }
  });

  /** §7: `onMissingHandle` and `handleLifetimeSeconds` reflect server configuration. */
  it('sep-0000-advertise-handle-lifetime + sep-0000-advertise-on-missing-handle: settings visible on discover', async () => {
    const harness = await startTestHarness({ onMissingHandle: 'none' });
    try {
      await withClient(harness, 'alice', async (client) => {
        const ext = (await client.discover()).capabilities?.extensions?.[EXTENSION_ID] as Record<
          string,
          unknown
        >;
        expect(ext?.handleLifetimeSeconds).toBe(3600);
        expect(ext?.onMissingHandle).toBe('none');
      });
    } finally {
      await harness.close();
    }
  });
});
