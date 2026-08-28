import type { HandleKey } from '../src/codec.js';
import { ConversationHandleClient } from '../src/client.js';
import {
  createConversationFixtureApp,
  createIfcFixtureApp,
  type FixtureApp,
  type IfcFixtureApp,
} from '../src/fixtures/app.js';
import { memoryFixtureTools } from '../src/fixtures/memory-tools.js';
import { serveMcpEphemeral } from '../src/http-server.js';
import { EXTENSION_ID, ERROR_CODE_HANDLE_NOT_RECOGNIZED } from '../src/schema/draft/schema.js';
import { peekCidHexFromHandle } from './peek-cid.js';
import { Client } from '@modelcontextprotocol/client';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

export const TEST_KEYS: HandleKey[] = [
  { keyId: 0, secret: Buffer.from('test-key-primary-32bytes!!!!!!') },
  { keyId: 1, secret: Buffer.from('test-key-secondary-32bytes!!!!!') },
];

export interface TestHarnessOptions {
  onMissingHandle?: 'new-conversation' | 'none';
  now?: () => number;
  retentionSeconds?: number;
  maxHandleBytes?: number;
}

export interface TestHarness {
  url: string;
  port: number;
  close: () => Promise<void>;
  manager: ReturnType<typeof createConversationFixtureApp>['manager'];
}

export interface IfcTestHarness extends TestHarness {
  journal: IfcFixtureApp['journal'];
}

function resolvePrincipal(ctx: { http?: { authInfo?: { extra?: Record<string, unknown> } } }) {
  const principal = ctx.http?.authInfo?.extra?.principal;
  return typeof principal === 'string' ? principal : undefined;
}

function harnessSettings(options: TestHarnessOptions = {}) {
  return {
    handleLifetimeSeconds: 3600,
    conversationRetentionSeconds: options.retentionSeconds ?? 86_400,
    onMissingHandle: options.onMissingHandle ?? 'new-conversation',
    maxHandleBytes: options.maxHandleBytes ?? 1024,
  } as const;
}

function pluginOptions(options: TestHarnessOptions = {}) {
  return {
    keys: TEST_KEYS,
    resolvePrincipal,
    now: options.now,
    settings: harnessSettings(options),
  };
}

async function serveFixtureApp(app: FixtureApp): Promise<TestHarness> {
  const http = await serveMcpEphemeral(app.handler);
  return {
    url: http.url,
    port: http.port,
    manager: app.manager,
    close: async () => {
      await http.close();
    },
  };
}

export async function startTestHarness(options: TestHarnessOptions = {}): Promise<TestHarness> {
  return serveFixtureApp(
    createConversationFixtureApp({
      ...pluginOptions(options),
      serverName: 'conversation-handle-test',
      serverVersion: '0.0.0',
    }),
  );
}

export async function startIfcTestHarness(options: TestHarnessOptions = {}): Promise<IfcTestHarness> {
  const app = createIfcFixtureApp({
    ...pluginOptions(options),
    serverName: 'conversation-handle-ifc-test',
    serverVersion: '0.0.0',
  });
  const base = await serveFixtureApp(app);
  return { ...base, journal: app.journal };
}

export async function withHarness<T>(
  fn: (harness: TestHarness) => Promise<T>,
  options: TestHarnessOptions = {},
): Promise<T> {
  const harness = await startTestHarness(options);
  try {
    return await fn(harness);
  } finally {
    await harness.close();
  }
}

export async function withClient<T>(
  harness: TestHarness,
  token: string | undefined,
  fn: (client: Client, handleClient: ConversationHandleClient) => Promise<T>,
): Promise<T> {
  const transport = new StreamableHTTPClientTransport(new URL(harness.url), {
    requestInit: token
      ? {
          headers: { Authorization: `Bearer ${token}` },
        }
      : undefined,
  });
  const client = new Client(
    { name: 'test-client', version: '0.0.0' },
    { versionNegotiation: { mode: { pin: '2026-07-28' } } },
  );
  const handleClient = new ConversationHandleClient({ maxHandleBytes: 1024 });
  await client.connect(transport);
  try {
    return await fn(client, handleClient);
  } finally {
    await client.close();
  }
}

export async function callMemoryAppend(
  client: Client,
  handleClient: ConversationHandleClient,
  text: string,
  sessionKey = 'default',
): Promise<{ result: unknown; handleMeta: unknown }> {
  const result = await client.callTool({
    name: 'memory_append',
    arguments: { text },
    _meta: handleClient.buildRequestMeta(sessionKey),
  });
  const meta = (result as { _meta?: Record<string, unknown> })._meta?.[EXTENSION_ID];
  handleClient.acceptResponseMeta((result as { _meta?: Record<string, unknown> })._meta, sessionKey);
  return { result, handleMeta: meta };
}

export async function callMemoryRead(
  client: Client,
  handleClient: ConversationHandleClient,
  sessionKey = 'default',
): Promise<{ result: unknown; handleMeta: unknown }> {
  const result = await client.callTool({
    name: 'memory_read',
    arguments: {},
    _meta: handleClient.buildRequestMeta(sessionKey),
  });
  handleClient.acceptResponseMeta((result as { _meta?: Record<string, unknown> })._meta, sessionKey);
  return { result, handleMeta: metaFromResult(result) };
}

export function metaFromResult(result: unknown): unknown {
  return (result as { _meta?: Record<string, unknown> })._meta?.[EXTENSION_ID];
}

/** Conformance helper: cid hex from a tool result or handleMeta payload (via RECOMMENDED layout peek). */
export function peekCid(source: unknown): string {
  let handle: unknown;
  if (source && typeof source === 'object' && 'handleMeta' in source) {
    const hm = (source as { handleMeta?: unknown }).handleMeta;
    handle = hm && typeof hm === 'object' ? (hm as { handle?: unknown }).handle : undefined;
  } else if (source && typeof source === 'object' && 'handle' in source) {
    handle = (source as { handle?: unknown }).handle;
  } else if (source && typeof source === 'object' && ('_meta' in source || 'result' in source)) {
    const fromResult = metaFromResult(
      (source as { result?: unknown }).result !== undefined
        ? (source as { result: unknown }).result
        : source,
    );
    handle =
      fromResult && typeof fromResult === 'object'
        ? (fromResult as { handle?: unknown }).handle
        : undefined;
  }
  if (typeof handle !== 'string') {
    throw new Error('missing handle for cid peek');
  }
  const cid = peekCidHexFromHandle(handle);
  if (!cid) {
    throw new Error('could not peek cid from handle');
  }
  return cid;
}

/** Apply response metas in arbitrary order (for client seq-ordering tests). */
export function acceptMetaOutOfOrder(
  handleClient: ConversationHandleClient,
  metas: unknown[],
  sessionKey = 'default',
): void {
  for (const meta of metas) {
    handleClient.acceptResponseMeta(meta, sessionKey);
  }
}

export function handleMetaFromResult(result: unknown): {
  handle: string;
  seq: number;
  supersededHandlePresented?: boolean;
} | undefined {
  const meta = metaFromResult(result);
  if (!meta || typeof meta !== 'object') {
    return undefined;
  }
  return meta as {
    handle: string;
    seq: number;
    supersededHandlePresented?: boolean;
  };
}

export function textFromResult(result: unknown): string {
  const content = (result as { content?: Array<{ type: string; text?: string }> }).content;
  return content?.[0]?.text ?? '';
}

/** Shared IFC / fixture tool caller: present handle meta, invoke, accept response. */
export async function callIfcTool(
  client: Client,
  handleClient: ConversationHandleClient,
  name: string,
  args: Record<string, unknown> = {},
  sessionKey = 'default',
): Promise<{ result: unknown; handleMeta: unknown }> {
  const result = await client.callTool({
    name,
    arguments: args,
    _meta: handleClient.buildRequestMeta(sessionKey),
  });
  handleClient.acceptResponseMeta((result as { _meta?: Record<string, unknown> })._meta, sessionKey);
  return { result, handleMeta: metaFromResult(result) };
}

export function callReceivePii(
  client: Client,
  handleClient: ConversationHandleClient,
  sessionKey = 'default',
): Promise<{ result: unknown; handleMeta: unknown }> {
  return callIfcTool(client, handleClient, 'receive_pii', {}, sessionKey);
}

export function callReceiveCredentials(
  client: Client,
  handleClient: ConversationHandleClient,
  sessionKey = 'default',
): Promise<{ result: unknown; handleMeta: unknown }> {
  return callIfcTool(client, handleClient, 'receive_credentials', {}, sessionKey);
}

export function callSanitizeCredentials(
  client: Client,
  handleClient: ConversationHandleClient,
  sessionKey = 'default',
): Promise<{ result: unknown; handleMeta: unknown }> {
  return callIfcTool(client, handleClient, 'sanitize_credentials', {}, sessionKey);
}

export function callEgressPost(
  client: Client,
  handleClient: ConversationHandleClient,
  destination: string,
  body: string,
  sessionKey = 'default',
): Promise<{ result: unknown; handleMeta: unknown }> {
  return callIfcTool(client, handleClient, 'egress_post', { destination, body }, sessionKey);
}

export { memoryFixtureTools, ERROR_CODE_HANDLE_NOT_RECOGNIZED };
