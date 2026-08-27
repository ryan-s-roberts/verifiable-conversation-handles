import { createHmac } from 'node:crypto';

const STATE_COMMITMENT_DOMAIN = 'vch-fixture-state-commitment-v1\0';

/** Keyed, conversation-bound commitment that keeps canonical fixture state opaque. */
export function hashStateCommitment(
  state: Uint8Array,
  cid: Uint8Array,
  secret: Uint8Array,
): Uint8Array {
  return new Uint8Array(
    createHmac('sha256', secret).update(STATE_COMMITMENT_DOMAIN).update(cid).update(state).digest(),
  );
}
