import type { HandleKey } from '../../src/codec.js';

/**
 * Shared fixtures for SEP-0000 e2e conformance tests.
 *
 * `OTHER_SERVER_KEYS` simulates a handle minted by a different deployment so tests can assert
 * cross-server rejection (§6 integrity; check `sep-0000-handle-rejected-by-other-server`).
 */
export const OTHER_SERVER_KEYS: HandleKey[] = [
  { keyId: 0, secret: Buffer.from('other-deployment-key-material!!') },
];
