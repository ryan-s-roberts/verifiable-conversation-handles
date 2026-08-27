export { decodeHandle, encodeHandle, mintHandle, verifyHandle } from './codec.js';
export type {
  DecodeHandleOptions,
  DecodedHandle,
  HandleKey,
  MintHandleInput,
  VerifyOptions,
} from './codec.js';

export { cidToConversationId, cidToHex, conversationIdToCid } from './cid.js';

export { generateCid, InMemoryConversationStore } from './store.js';
export type { ConversationRecord, ConversationStore } from './store.js';

export {
  conversationHandleToolError,
  ConversationHandleError,
  extensionErrorData,
  parseCallToolHandleError,
} from './errors.js';
export type {
  ConversationHandleToolErrorResult,
  ExtensionErrorData,
  ExtensionErrorEnvelope,
} from './errors.js';

export { conversationHandlePlugin, getActiveConversation } from './extension.js';
export type {
  ConversationHandleManager,
  ConversationHandlePluginOptions,
  ToolHandler,
  ToolInvocationResult,
} from './extension.js';

export { ConversationHandleClient, parseAdvisorySeq } from './client.js';
export type { ConversationSession } from './client.js';

export { registerConversationTools } from './integrate.js';
export type { ConversationToolDefinition } from './integrate.js';

export {
  CID_BYTE_LENGTH,
  DEFAULT_HANDLE_LIFETIME_SECONDS,
  DEFAULT_MAX_HANDLE_BYTES,
  DEFAULT_ON_MISSING_HANDLE,
  ERROR_CODE_HANDLE_NOT_RECOGNIZED,
  ERROR_EXTENSION_META_KEY,
  EXTENSION_ID,
  HANDLE_VERSION,
  MAX_STATE_BYTE_LENGTH,
  MISSING_REQUIRED_CLIENT_CAPABILITY,
  TAG_BYTE_LENGTH,
} from './schema/draft/schema.js';
export type {
  ClientExtensionSettings,
  ConversationHandleFailureReason,
  ConversationHandleRequestMeta,
  ConversationHandleResponseMeta,
  HandleProfile,
  MissingHandlePolicy,
  OnMissingHandle,
  ServerExtensionSettings,
} from './schema/draft/schema.js';
