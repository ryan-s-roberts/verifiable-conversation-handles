import {
  CLIENT_CAPABILITIES_META_KEY,
  PROTOCOL_VERSION_META_KEY,
} from './meta-keys.js';
import {
  EXTENSION_ID,
  type ClientExtensionSettings,
  type ConversationHandleResponseMeta,
} from './schema/draft/schema.js';

/** Per-conversation client state. Handle remains opaque; seq mirror used only for ordering (§4.1). */
export interface ConversationSession {
  handle?: string;
  highestSeq: number;
  conversationId?: string;
}

const MAX_HANDLE_SEQ = 0xffff_ffff;

/** Parse advisory seq mirror; rejects non-integer, negative, or out-of-range values. */
export function parseAdvisorySeq(seq: unknown): number | undefined {
  if (typeof seq !== 'number' || !Number.isSafeInteger(seq) || seq < 0 || seq > MAX_HANDLE_SEQ) {
    return undefined;
  }
  return seq;
}

/**
 * Opaque client-side handle persistence with seq-aware merge for concurrent responses.
 * Each instance is scoped to one issuing server; state within it is keyed by `conversationId`.
 * Clients MUST send the highest-seq handle (§4.2) and SHOULD discard lower-seq replacements.
 */
export class ConversationHandleClient {
  private readonly conversations = new Map<string, ConversationSession>();
  private readonly sessionConversationIds = new Map<string, string>();
  private readonly unboundSessions = new Map<string, ConversationSession>();
  private readonly maxHandleBytes?: number;

  constructor(settings?: ClientExtensionSettings) {
    this.maxHandleBytes = settings?.maxHandleBytes;
  }

  getSession(sessionKey = 'default'): Readonly<ConversationSession> {
    return this.getOrCreateSession(sessionKey);
  }

  /** Returns the latest handle verbatim, or undefined when none is stored. */
  getHandle(sessionKey = 'default'): string | undefined {
    return this.getOrCreateSession(sessionKey).handle;
  }

  /**
   * Stores the server-issued handle when its advisory `seq` is not lower than the stored highest
   * for the same conversation. A logical session is pinned to the first `conversationId` it accepts;
   * fork responses must therefore be accepted under a distinct child session key.
   */
  acceptResponseMeta(meta: unknown, sessionKey = 'default'): void {
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
      return;
    }
    const payload = (meta as Record<string, unknown>)[EXTENSION_ID];
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return;
    }
    const response = payload as ConversationHandleResponseMeta;
    const handle = response.handle;
    if (typeof handle !== 'string') {
      return;
    }
    if (this.maxHandleBytes !== undefined && Buffer.byteLength(handle, 'utf8') > this.maxHandleBytes) {
      throw new Error('server issued handle exceeding maxHandleBytes');
    }

    const seq = parseAdvisorySeq(response.seq);
    if (seq === undefined) {
      return;
    }
    const conversationId = response.conversationId;
    if (typeof conversationId !== 'string' || conversationId.length === 0) {
      return;
    }

    const boundConversationId = this.sessionConversationIds.get(sessionKey);
    if (boundConversationId !== undefined && boundConversationId !== conversationId) {
      return;
    }

    const session = this.bindSession(sessionKey, conversationId);
    if (seq < session.highestSeq) {
      return;
    }
    if (seq === session.highestSeq && session.handle !== undefined && session.handle !== handle) {
      return;
    }

    session.highestSeq = seq;
    session.handle = handle;
  }

  /**
   * Build per-request _meta envelope fields for a stateless MCP client.
   */
  buildRequestMeta(sessionKey = 'default', extras?: { fork?: boolean }): Record<string, unknown> {
    const handle = this.getHandle(sessionKey);
    const clientSettings: ClientExtensionSettings = {};
    if (this.maxHandleBytes !== undefined) {
      clientSettings.maxHandleBytes = this.maxHandleBytes;
    }
    const extensionPayload: Record<string, unknown> = {};
    if (handle !== undefined) {
      extensionPayload.handle = handle;
    }
    if (extras?.fork) {
      extensionPayload.fork = true;
    }
    return {
      [PROTOCOL_VERSION_META_KEY]: '2026-07-28',
      [CLIENT_CAPABILITIES_META_KEY]: {
        extensions: {
          [EXTENSION_ID]: clientSettings,
        },
      },
      ...(Object.keys(extensionPayload).length > 0 ? { [EXTENSION_ID]: extensionPayload } : {}),
    };
  }

  clear(sessionKey = 'default'): void {
    this.unboundSessions.delete(sessionKey);
    const conversationId = this.sessionConversationIds.get(sessionKey);
    if (conversationId === undefined) {
      return;
    }
    this.sessionConversationIds.delete(sessionKey);
    if (![...this.sessionConversationIds.values()].includes(conversationId)) {
      this.conversations.delete(conversationId);
    }
  }

  /** Test-only injection of session state without parsing the handle. */
  testOnlySetSession(
    session: { handle?: string; highestSeq?: number; conversationId?: string },
    sessionKey = 'default',
  ): void {
    let target: ConversationSession;
    if (session.conversationId !== undefined) {
      const currentConversationId = this.sessionConversationIds.get(sessionKey);
      if (currentConversationId !== undefined && currentConversationId !== session.conversationId) {
        this.clear(sessionKey);
      }
      target = this.bindSession(sessionKey, session.conversationId);
    } else {
      target = this.getOrCreateSession(sessionKey);
    }
    if (session.handle !== undefined) {
      target.handle = session.handle;
    }
    if (session.highestSeq !== undefined) {
      target.highestSeq = session.highestSeq;
    }
  }

  /** @deprecated Use testOnlySetSession for handle + seq together. */
  testOnlySetHandle(handle: string, sessionKey = 'default'): void {
    this.testOnlySetSession({ handle }, sessionKey);
  }

  private getOrCreateSession(sessionKey: string): ConversationSession {
    const conversationId = this.sessionConversationIds.get(sessionKey);
    if (conversationId !== undefined) {
      return this.conversations.get(conversationId)!;
    }

    let session = this.unboundSessions.get(sessionKey);
    if (!session) {
      session = { highestSeq: 0 };
      this.unboundSessions.set(sessionKey, session);
    }
    return session;
  }

  private bindSession(sessionKey: string, conversationId: string): ConversationSession {
    let session = this.conversations.get(conversationId);
    if (!session) {
      session = this.unboundSessions.get(sessionKey) ?? { highestSeq: 0 };
      session.conversationId = conversationId;
      this.conversations.set(conversationId, session);
    }
    this.unboundSessions.delete(sessionKey);
    this.sessionConversationIds.set(sessionKey, conversationId);
    return session;
  }
}
