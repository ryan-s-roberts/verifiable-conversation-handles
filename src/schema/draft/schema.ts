/**
 * Wire types for io.modelcontextprotocol/conversation-handle (SEP draft).
 * Source of truth for JSON shapes; not hand-edited generated artifacts.
 */

export const EXTENSION_ID = 'io.modelcontextprotocol/conversation-handle' as const;
export const ERROR_EXTENSION_META_KEY = 'io.modelcontextprotocol/conversation-handle-error' as const;

export const HANDLE_VERSION = 0x01;
export const CID_BYTE_LENGTH = 16;
export const TAG_BYTE_LENGTH = 16;
export const MAX_STATE_BYTE_LENGTH = 255;

export type OnMissingHandle = 'new-conversation' | 'none';
/** Runtime policy including fail-closed rejection when a handle is required. */
export type MissingHandlePolicy = OnMissingHandle | 'reject';
export type HandleProfile = 'symmetric' | 'asymmetric';

/** Per-tool conversation-handle mark on `tools/list` entries (§1.1). */
export type ToolHandleRequirement = 'required' | 'preferred';

export interface ToolConversationHandleMeta {
  requirement: ToolHandleRequirement;
  /**
   * Whether the server may mint/rotate a handle in this tool's response `_meta`.
   * If present, MUST match server behaviour. Omit only when the default (`true`) applies.
   */
  mayMint?: boolean;
}

export const DEFAULT_HANDLE_LIFETIME_SECONDS = 3600;
export const DEFAULT_MAX_HANDLE_BYTES = 1024;
export const DEFAULT_ON_MISSING_HANDLE: OnMissingHandle = 'new-conversation';

/** Server settings advertised in server/discover capabilities.extensions */
export interface ServerExtensionSettings {
  handleLifetimeSeconds?: number;
  conversationRetentionSeconds?: number;
  /** Internal retention window for server-side purge helpers (milliseconds). */
  retentionMs?: number;
  onMissingHandle?: OnMissingHandle;
  typicalHandleBytes?: number;
  maxHandleBytes?: number;
  profile?: HandleProfile;
  jwksUri?: string;
}

/** Client settings in io.modelcontextprotocol/clientCapabilities.extensions */
export interface ClientExtensionSettings {
  maxHandleBytes?: number;
}

/** Request _meta payload */
export interface ConversationHandleRequestMeta {
  handle?: string;
  fork?: boolean;
}

/** Response _meta payload (advisory mirrors + handle) */
export interface ConversationHandleResponseMeta {
  handle: string;
  conversationId: string;
  seq: number;
  expiresAt: number;
  supersededHandlePresented: boolean;
}

export type ConversationHandleFailureReason =
  | 'handle_missing'
  | 'handle_invalid'
  | 'handle_expired'
  | 'handle_retired'
  | 'handle_too_large'
  | 'principal_mismatch'
  | 'unauthenticated';

export const ERROR_CODE_HANDLE_NOT_RECOGNIZED = -30_001;
export const MISSING_REQUIRED_CLIENT_CAPABILITY = -32_021;
