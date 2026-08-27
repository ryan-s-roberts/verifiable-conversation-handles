import { z } from 'zod';
import { cidToHex } from '../cid.js';
import { getActiveConversation } from '../active-context.js';
import type { ConversationStore } from '../store.js';
import type { ConversationToolDefinition } from '../integrate.js';
import { decodeLabelHead, encodeLabelHead, type TaintLabel } from './label-head.js';

export type { TaintLabel } from './label-head.js';

const DEFAULT_TAINT_LABEL: TaintLabel = 'pii';

/** Per-conversation and per-principal label journal (IFC worked example). */
export class TaintJournal {
  private readonly byCid = new Map<string, Set<TaintLabel>>();
  private readonly byPrincipal = new Map<string, Set<TaintLabel>>();

  mark(cid: Uint8Array, label: TaintLabel, principal?: string): void {
    const key = cidToHex(cid);
    const cidLabels = this.byCid.get(key) ?? new Set<TaintLabel>();
    cidLabels.add(label);
    this.byCid.set(key, cidLabels);
    if (principal) {
      const principalLabels = this.byPrincipal.get(principal) ?? new Set<TaintLabel>();
      principalLabels.add(label);
      this.byPrincipal.set(principal, principalLabels);
    }
  }

  has(cid: Uint8Array, label: TaintLabel): boolean {
    return this.byCid.get(cidToHex(cid))?.has(label) ?? false;
  }

  hasPrincipal(principal: string, label: TaintLabel): boolean {
    return this.byPrincipal.get(principal)?.has(label) ?? false;
  }

  /** §8 fail-closed: reject missing handle after principal observed label. */
  shouldRejectMissingHandle(principal: string, label: TaintLabel = DEFAULT_TAINT_LABEL): boolean {
    return this.hasPrincipal(principal, label);
  }

  /** Guarded egress sink policy: block when cid or principal carries label. */
  blocksEgress(
    cid: Uint8Array,
    principal: string,
    label: TaintLabel = DEFAULT_TAINT_LABEL,
  ): boolean {
    return this.has(cid, label) || this.hasPrincipal(principal, label);
  }

  egressBlockedMessage(label: TaintLabel = DEFAULT_TAINT_LABEL): string {
    return `egress blocked: principal or conversation has ${label} label`;
  }

  /** Label-journal head for §3 state commitment. */
  head(cid: Uint8Array): Uint8Array {
    return encodeLabelHead(this.byCid.get(cidToHex(cid)) ?? []);
  }

  labelsFor(cid: Uint8Array): TaintLabel[] {
    return decodeLabelHead(this.head(cid));
  }

  clear(): void {
    this.byCid.clear();
    this.byPrincipal.clear();
  }
}

export const receivePiiSchema = z.object({});
export const egressPostSchema = z.object({
  destination: z.string(),
  body: z.string(),
});

const SYNTHETIC_PII = { ssn: 'ssn-123-45-6789', name: 'Jane Doe' };

export function ifcFixtureToolDefinitions(
  _store: ConversationStore,
  journal: TaintJournal,
): Record<string, ConversationToolDefinition> {
  return {
    receive_pii: {
      description: 'Simulated PII source — marks principal and conversation with pii label',
      inputSchema: receivePiiSchema,
      // preferred: missing handle may mint until principal taint triggers fail-closed policy
      handleRequirement: 'preferred',
      handler: async () => {
        const active = getActiveConversation();
        if (!active) {
          return { content: [{ type: 'text', text: 'no active conversation' }] };
        }
        journal.mark(active.record.cid, 'pii', active.record.principal);
        return {
          content: [{ type: 'text', text: JSON.stringify(SYNTHETIC_PII) }],
        };
      },
    },

    egress_post: {
      description: 'Guarded egress sink — blocked when principal or conversation has pii label',
      inputSchema: egressPostSchema,
      handleRequirement: 'preferred',
      handler: async (args) => {
        const active = getActiveConversation();
        if (!active) {
          return { content: [{ type: 'text', text: 'no active conversation' }] };
        }
        if (journal.blocksEgress(active.record.cid, active.record.principal)) {
          return {
            isError: true,
            content: [{ type: 'text', text: journal.egressBlockedMessage() }],
          };
        }
        const { destination, body } = args as { destination: string; body: string };
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ posted: true, destination, bytes: body.length }),
            },
          ],
        };
      },
    },
  };
}
