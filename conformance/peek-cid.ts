/**
 * Conformance-only: read cid hex from RECOMMENDED wire layout without verifying the MAC.
 * Not part of the package public API — hosts use their own session keys (§4.1).
 */
import { CID_BYTE_LENGTH, HANDLE_VERSION, TAG_BYTE_LENGTH } from '../src/schema/draft/schema.js';

const BODY_OVERHEAD = 1 + 1 + CID_BYTE_LENGTH + 4 + 4 + 1;

export function peekCidHexFromHandle(handle: string): string | undefined {
  try {
    const raw = Buffer.from(handle, 'base64url');
    if (raw.length < BODY_OVERHEAD + TAG_BYTE_LENGTH) {
      return undefined;
    }
    if (raw[0] !== HANDLE_VERSION) {
      return undefined;
    }
    return raw.subarray(2, 2 + CID_BYTE_LENGTH).toString('hex');
  } catch {
    return undefined;
  }
}
