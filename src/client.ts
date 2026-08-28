import {
  CLIENT_CAPABILITIES_META_KEY,
  PROTOCOL_VERSION_META_KEY,
} from './meta-keys.js';
import {
  EXTENSION_ID,
  type ClientExtensionSettings,
} from './schema/draft/schema.js';

/** Per-session client state. Handle remains opaque; seq mirror used only for ordering (§4.1). */
export interface ConversationSession {
  handle?: string;
  highestSeq: number;
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
 * Each instance is scoped to one issuing server; state within it is keyed by host `sessionKey`
 * (hosts SHOULD use their own thread/UI key — response `_meta` does not mirror conversationId).
 * Clients MUST send the highest-seq handle (§4.2) and SHOULD discard lower-seq replacements.
 */
export class ConversationHandleClient {
  private readonly sessions = new Map<string, ConversationSession>();
  /** Per sessionKey generation — incremented on `clear()` to drop in-flight accepts. */
  private readonly sessionGenerations = new Map<string, number>();
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
   * for the same session key. Only `handle` and `seq` are read from response `_meta`.
   */
  acceptResponseMeta(meta: unknown, sessionKey = 'default'): void {
    const acceptEpoch = this.sessionGenerations.get(sessionKey) ?? 0;

    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
      return;
    }
    const payload = (meta as Record<string, unknown>)[EXTENSION_ID];
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return;
    }
    const fields = payload as Record<string, unknown>;
    const handle = fields.handle;
    if (typeof handle !== 'string') {
      return;
    }
    if (this.maxHandleBytes !== undefined && Buffer.byteLength(handle, 'utf8') > this.maxHandleBytes) {
      throw new Error('server issued handle exceeding maxHandleBytes');
    }

    const seq = parseAdvisorySeq(fields.seq);
    if (seq === undefined) {
      return;
    }

    const session = this.getOrCreateSession(sessionKey);
    if (seq < session.highestSeq) {
      return;
    }
    if (seq === session.highestSeq && session.handle !== undefined && session.handle !== handle) {
      return;
    }
    if ((this.sessionGenerations.get(sessionKey) ?? 0) !== acceptEpoch) {
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
    this.sessionGenerations.set(sessionKey, (this.sessionGenerations.get(sessionKey) ?? 0) + 1);
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
