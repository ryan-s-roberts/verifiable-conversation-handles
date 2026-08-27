import { createHmac, timingSafeEqual } from 'node:crypto';
import { ConversationHandleError } from './errors.js';
import {
  CID_BYTE_LENGTH,
  HANDLE_VERSION,
  MAX_STATE_BYTE_LENGTH,
  TAG_BYTE_LENGTH,
} from './schema/draft/schema.js';

export interface HandleKey {
  keyId: number;
  secret: Buffer;
}

export interface DecodedHandle {
  version: number;
  keyId: number;
  cid: Uint8Array;
  exp: number;
  seq: number;
  state: Uint8Array;
}

export interface MintHandleInput {
  cid: Uint8Array;
  exp: number;
  seq: number;
  state?: Uint8Array;
  keyId?: number;
}

export interface VerifyOptions {
  now?: () => number;
  allowExpired?: boolean;
}

const BODY_OVERHEAD = 1 + 1 + CID_BYTE_LENGTH + 4 + 4 + 1;

function encodeBase64Url(buffer: Buffer): string {
  return buffer.toString('base64url');
}

function decodeBase64Url(handle: string): Buffer {
  return Buffer.from(handle, 'base64url');
}

function buildBody(input: MintHandleInput): Buffer {
  const state = input.state ?? Buffer.alloc(0);
  if (state.length > MAX_STATE_BYTE_LENGTH) {
    throw new Error(`state commitment exceeds ${MAX_STATE_BYTE_LENGTH} bytes`);
  }
  const body = Buffer.alloc(BODY_OVERHEAD + state.length);
  let offset = 0;
  body[offset++] = HANDLE_VERSION;
  body[offset++] = input.keyId ?? 0;
  Buffer.from(input.cid).copy(body, offset);
  offset += CID_BYTE_LENGTH;
  body.writeUInt32BE(input.exp, offset);
  offset += 4;
  body.writeUInt32BE(input.seq, offset);
  offset += 4;
  body[offset++] = state.length;
  Buffer.from(state).copy(body, offset);
  return body;
}

function computeTag(body: Buffer, secret: Buffer): Buffer {
  return createHmac('sha256', secret).update(body).digest().subarray(0, TAG_BYTE_LENGTH);
}

export function mintHandle(keys: HandleKey[], input: MintHandleInput): string {
  const keyId = input.keyId ?? keys[0]?.keyId ?? 0;
  const key = keys.find((k) => k.keyId === keyId);
  if (!key) {
    throw new Error(`unknown key_id ${keyId}`);
  }
  const body = buildBody({ ...input, keyId });
  const tag = computeTag(body, key.secret);
  return encodeBase64Url(Buffer.concat([body, tag]));
}

export function verifyHandle(
  keys: HandleKey[],
  handle: string,
  options: VerifyOptions = {},
): DecodedHandle | null {
  let raw: Buffer;
  try {
    raw = decodeBase64Url(handle);
  } catch {
    return null;
  }
  if (raw.length < BODY_OVERHEAD + TAG_BYTE_LENGTH) {
    return null;
  }
  const body = raw.subarray(0, raw.length - TAG_BYTE_LENGTH);
  const tag = raw.subarray(raw.length - TAG_BYTE_LENGTH);
  const keyId = body[1]!;
  const key = keys.find((k) => k.keyId === keyId);
  if (!key) {
    return null;
  }
  const expected = computeTag(body, key.secret);
  if (tag.length !== expected.length || !timingSafeEqual(tag, expected)) {
    return null;
  }
  const version = body[0]!;
  if (version !== HANDLE_VERSION) {
    return null;
  }
  const cid = body.subarray(2, 2 + CID_BYTE_LENGTH);
  const exp = body.readUInt32BE(2 + CID_BYTE_LENGTH);
  const seq = body.readUInt32BE(2 + CID_BYTE_LENGTH + 4);
  const stateLen = body[2 + CID_BYTE_LENGTH + 8]!;
  const stateStart = BODY_OVERHEAD;
  if (body.length !== stateStart + stateLen) {
    return null;
  }
  const state = body.subarray(stateStart, stateStart + stateLen);
  const now = options.now?.() ?? Math.floor(Date.now() / 1000);
  if (!options.allowExpired && exp < now) {
    return null;
  }
  return { version, keyId, cid: new Uint8Array(cid), exp, seq, state: new Uint8Array(state) };
}

export interface DecodeHandleOptions {
  maxBytes?: number;
  now?: () => number;
}

export function decodeHandle(
  keys: HandleKey[],
  handle: string,
  options: DecodeHandleOptions = {},
): DecodedHandle {
  if (options.maxBytes !== undefined && Buffer.byteLength(handle, 'utf8') > options.maxBytes) {
    throw new ConversationHandleError('handle_too_large', 'handle exceeds maxHandleBytes');
  }
  const decoded = verifyHandle(keys, handle, {
    now: options.now,
    allowExpired: true,
  });
  if (!decoded) {
    throw new ConversationHandleError('handle_invalid', 'handle integrity check failed');
  }
  return decoded;
}

export function encodeHandle(
  keys: HandleKey[],
  input: MintHandleInput,
  options: { maxBytes?: number } = {},
): string {
  const handle = mintHandle(keys, input);
  if (options.maxBytes !== undefined && Buffer.byteLength(handle, 'utf8') > options.maxBytes) {
    throw new ConversationHandleError('handle_too_large', 'minted handle exceeds maxHandleBytes');
  }
  return handle;
}
