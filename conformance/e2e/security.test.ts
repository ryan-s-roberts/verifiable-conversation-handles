import { describe, expect, it } from 'vitest';
import { flipHandleByte, mintHandle } from '../../src/codec.js';
import {
  EXTENSION_ID,
  CID_BYTE_LENGTH,
  ERROR_EXTENSION_META_KEY,
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

describe('conversation-handle e2e security', () => {

  it('sep-0000-handle-is-json-string + sep-0000-client-returns-handle-verbatim: client stores handle verbatim only', async () => {
    const harness = await startTestHarness();
    try {
      await withClient(harness, 'alice', async (client, handleClient) => {
        const { handleMeta } = await callMemoryAppend(client, handleClient, 'opaque');
        const stored = handleClient.getHandle();
        expect(typeof stored).toBe('string');
        expect(stored).toBe((handleMeta as { handle: string }).handle);
      });
    } finally {
      await harness.close();
    }
  });

  it('sep-0000-reject-forged-handle: tampered handle fails integrity verification', async () => {
    const harness = await startTestHarness();
    try {
      await withClient(harness, 'alice', async (client, handleClient) => {
        await callMemoryAppend(client, handleClient, 'opaque');
        const mutated = flipHandleByte(handleClient.getHandle()!);
        handleClient.testOnlySetHandle(mutated);
        const read = await callMemoryRead(client, handleClient);
        expect(read.result).toMatchObject({ isError: true });
        expect(textFromResult(read.result)).toBe('Conversation handle not recognised');
      });
    } finally {
      await harness.close();
    }
  });

  it('invalid and unauthorised handle failures are externally indistinguishable', async () => {
    const harness = await startTestHarness();
    try {
      let handle = '';
      await withClient(harness, 'alice', async (client, handleClient) => {
        await callMemoryAppend(client, handleClient, 'secret');
        handle = handleClient.getHandle()!;
      });

      const readWithHandle = (token: string | undefined, presentedHandle: string) =>
        withClient(harness, token, async (client, handleClient) => {
          handleClient.testOnlySetHandle(presentedHandle);
          return (await callMemoryRead(client, handleClient)).result;
        });

      const invalid = await readWithHandle('alice', flipHandleByte(handle));
      const liveNonOwner = await readWithHandle('bob', handle);
      const unauthenticated = await readWithHandle(undefined, handle);

      const record = harness.manager.store.listRecords()[0]!;
      harness.manager.store.markRetired(record.cid);
      const retiredNonOwner = await readWithHandle('bob', handle);

      expect(invalid).toEqual({
        isError: true,
        content: [{ type: 'text', text: 'Conversation handle not recognised' }],
        _meta: {
          [ERROR_EXTENSION_META_KEY]: {
            code: ERROR_CODE_HANDLE_NOT_RECOGNIZED,
            message: 'Conversation handle not recognised',
            data: {
              extension: EXTENSION_ID,
              reason: 'handle_invalid',
              remediation:
                'Re-send with the most recently received handle, or omit it to start a new conversation. Conversation-scoped preferences are not available without one.',
            },
          },
          'io.modelcontextprotocol/serverInfo': {
            name: 'conversation-handle-test',
            version: '0.0.0',
          },
        },
      });
      expect(liveNonOwner).toEqual(invalid);
      expect(retiredNonOwner).toEqual(invalid);
      expect(unauthenticated).toEqual(invalid);
    } finally {
      await harness.close();
    }
  });

  it('sep-0000-no-cross-principal-conversation-state: bob cannot read alice memory', async () => {
    const harness = await startTestHarness();
    try {
      let stolen = '';
      await withClient(harness, 'alice', async (client, handleClient) => {
        await callMemoryAppend(client, handleClient, 'secret');
        stolen = handleClient.getHandle()!;
      });
      await withClient(harness, 'bob', async (client, handleClient) => {
        handleClient.testOnlySetHandle(stolen);
        const read = await callMemoryRead(client, handleClient);
        expect(read.result).toMatchObject({ isError: true });
        expect(textFromResult(read.result)).toBe('Conversation handle not recognised');
      });
    } finally {
      await harness.close();
    }
  });

  it('sep-0000-handle-not-authorization + sep-0000-state-commitment-not-authorization: valid handle without bearer yields no state', async () => {
    const harness = await startTestHarness();
    try {
      let stolen = '';
      await withClient(harness, 'alice', async (client, handleClient) => {
        await callMemoryAppend(client, handleClient, 'secret');
        stolen = handleClient.getHandle()!;
      });
      await withClient(harness, undefined, async (client, handleClient) => {
        handleClient.testOnlySetHandle(stolen);
        const read = await callMemoryRead(client, handleClient);
        expect(read.result).toMatchObject({ isError: true });
      });
    } finally {
      await harness.close();
    }
  });

  it('sep-0000-reject-handle-in-tool-arguments: handle in tool args does not bind conversation', async () => {
    const harness = await startTestHarness();
    try {
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
    } finally {
      await harness.close();
    }
  });

  it('sep-0000-invalid-handle-not-resolved + sep-0000-treated-as-no-conversation: omitting handle does not see prior memory', async () => {
    const harness = await startTestHarness();
    try {
      await withClient(harness, 'alice', async (client, handleClient) => {
        await callMemoryAppend(client, handleClient, 'prior');
        handleClient.clear();
        const read = await callMemoryRead(client, handleClient);
        expect(textFromResult(read.result)).toBe('[]');
      });
    } finally {
      await harness.close();
    }
  });

  it('sep-0000-mirrors-not-accepted-as-input: advisory mirrors without handle do not resolve conversation', async () => {
    const harness = await startTestHarness();
    try {
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
    } finally {
      await harness.close();
    }
  });
});
