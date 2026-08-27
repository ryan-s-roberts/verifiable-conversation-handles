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
 * Clients MUST send the highest-seq handle (§4.2) and SHOULD discard lower-seq replacements.
 */
export class ConversationHandleClient {
  private readonly sessions = new Map<string, ConversationSession>();
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
   * Stores the server-issued handle when its advisory `seq` is not lower than the stored highest.
   * Out-of-order concurrent responses therefore cannot regress the client's handle.
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

    const session = this.getOrCreateSession(sessionKey);
    if (seq < session.highestSeq) {
      return;
    }

    session.highestSeq = seq;
    session.handle = handle;
    if (typeof response.conversationId === 'string') {
      session.conversationId = response.conversationId;
    }
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
    this.sessions.delete(sessionKey);
  }

  private getOrCreateSession(sessionKey: string): ConversationSession {
    let session = this.sessions.get(sessionKey);
    if (!session) {
      session = { highestSeq: 0 };
      this.sessions.set(sessionKey, session);
    }
    return session;
  }
}
