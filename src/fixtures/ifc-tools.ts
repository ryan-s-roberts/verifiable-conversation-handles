import { z } from 'zod';
import { cidToHex } from '../cid.js';
import { getActiveConversation } from '../active-context.js';
import type { ConversationStore } from '../store.js';
import type { ConversationToolDefinition } from '../integrate.js';
import { encodeLabelHead, isTaintLabel, type TaintLabel } from './label-head.js';

export type { TaintLabel } from './label-head.js';
export { isTaintLabel } from './label-head.js';

/**
 * Confidentiality labels that block guarded egress and fail-closed omission
 * (Plasm-shaped IFC sink policy). Integrity-axis `untrusted` is excluded.
 */
export const EGRESS_FORBIDDEN_LABELS: readonly TaintLabel[] = ['credentials', 'pii'];

const FORBIDDEN = new Set<TaintLabel>(EGRESS_FORBIDDEN_LABELS);

/** Per-conversation and per-principal multi-label journal (Plasm FlowFacts join-semilattice). */
export class TaintJournal {
  private readonly byCid = new Map<string, Set<TaintLabel>>();
  private readonly byPrincipal = new Map<string, Set<TaintLabel>>();

  mark(cid: Uint8Array, label: TaintLabel, principal?: string): void {
    this.update(cid, principal, (set) => {
      set.add(label);
    });
  }

  /** Sanitizer / declassification: clear specific labels (Plasm `sanitizes:` / `clears`). */
  clearLabels(cid: Uint8Array, labels: Iterable<TaintLabel>, principal?: string): void {
    const toClear = [...labels].filter(isTaintLabel);
    if (toClear.length === 0) {
      return;
    }
    this.update(cid, principal, (set) => {
      for (const label of toClear) {
        set.delete(label);
      }
    });
  }

  has(cid: Uint8Array, label: TaintLabel): boolean {
    return this.byCid.get(cidToHex(cid))?.has(label) ?? false;
  }

  hasPrincipal(principal: string, label: TaintLabel): boolean {
    return this.byPrincipal.get(principal)?.has(label) ?? false;
  }

  /**
   * Fail-closed on handle omission when the principal carries any confidentiality label
   * (same set as egress). Integrity-only `untrusted` does not trigger.
   */
  shouldRejectMissingHandle(principal: string): boolean {
    const labels = this.byPrincipal.get(principal);
    if (!labels) {
      return false;
    }
    for (const label of labels) {
      if (FORBIDDEN.has(label)) {
        return true;
      }
    }
    return false;
  }

  /** Guarded egress: block when cid or principal carries any forbidden confidentiality label. */
  blocksEgress(cid: Uint8Array, principal: string): boolean {
    return this.blockingLabels(cid, principal).length > 0;
  }

  blockingLabels(cid: Uint8Array, principal: string): TaintLabel[] {
    const present = new Set<TaintLabel>([
      ...(this.byCid.get(cidToHex(cid)) ?? []),
      ...(this.byPrincipal.get(principal) ?? []),
    ]);
    return EGRESS_FORBIDDEN_LABELS.filter((label) => present.has(label));
  }

  egressBlockedMessage(cid: Uint8Array, principal: string): string {
    const labels = this.blockingLabels(cid, principal);
    return `egress blocked: principal or conversation has ${labels.join('+')} label`;
  }

  /** Label-journal head for §3 state commitment (sorted join of cid labels). */
  head(cid: Uint8Array): Uint8Array {
    return encodeLabelHead(this.labelsFor(cid));
  }

  labelsFor(cid: Uint8Array): TaintLabel[] {
    return [...(this.byCid.get(cidToHex(cid)) ?? [])].sort();
  }

  clear(): void {
    this.byCid.clear();
    this.byPrincipal.clear();
  }

  private update(
    cid: Uint8Array,
    principal: string | undefined,
    apply: (set: Set<TaintLabel>) => void,
  ): void {
    this.mutateMap(this.byCid, cidToHex(cid), apply);
    if (principal) {
      this.mutateMap(this.byPrincipal, principal, apply);
    }
  }

  private mutateMap(
    map: Map<string, Set<TaintLabel>>,
    key: string,
    apply: (set: Set<TaintLabel>) => void,
  ): void {
    const set = map.get(key) ?? new Set<TaintLabel>();
    apply(set);
    if (set.size === 0) {
      map.delete(key);
    } else {
      map.set(key, set);
    }
  }
}

const emptySchema = z.object({});
export const receivePiiSchema = emptySchema;
export const receiveCredentialsSchema = emptySchema;
export const sanitizeCredentialsSchema = emptySchema;
export const egressPostSchema = z.object({
  destination: z.string(),
  body: z.string(),
});

type LabelOp = {
  name: string;
  description: string;
  op: 'mark' | 'clear';
  label: TaintLabel;
  body: unknown;
};

const LABEL_OPS: readonly LabelOp[] = [
  {
    name: 'receive_pii',
    description: 'Simulated PII source — joins `pii` into principal and conversation FlowFacts',
    op: 'mark',
    label: 'pii',
    body: { ssn: 'ssn-123-45-6789', name: 'Jane Doe' },
  },
  {
    name: 'receive_credentials',
    description:
      'Simulated credentials source — joins `credentials` into principal and conversation FlowFacts',
    op: 'mark',
    label: 'credentials',
    body: { token: 'sk-live-redacted', scope: 'admin' },
  },
  {
    name: 'sanitize_credentials',
    description:
      'Sanitizer — clears `credentials` from principal and conversation (declassification)',
    op: 'clear',
    label: 'credentials',
    body: { sanitized: ['credentials'] },
  },
];

function labelOpTool(journal: TaintJournal, spec: LabelOp): ConversationToolDefinition {
  return {
    description: spec.description,
    inputSchema: emptySchema,
    handleRequirement: 'preferred',
    handler: async () => {
      const active = getActiveConversation();
      if (!active) {
        return { content: [{ type: 'text', text: 'no active conversation' }] };
      }
      if (spec.op === 'mark') {
        journal.mark(active.record.cid, spec.label, active.record.principal);
      } else {
        journal.clearLabels(active.record.cid, [spec.label], active.record.principal);
      }
      return { content: [{ type: 'text', text: JSON.stringify(spec.body) }] };
    },
  };
}

export function ifcFixtureToolDefinitions(
  _store: ConversationStore,
  journal: TaintJournal,
): Record<string, ConversationToolDefinition> {
  const tools: Record<string, ConversationToolDefinition> = Object.fromEntries(
    LABEL_OPS.map((spec) => [spec.name, labelOpTool(journal, spec)]),
  );

  tools.egress_post = {
    description:
      'Guarded egress sink — blocked when principal or conversation has pii or credentials',
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
          content: [
            {
              type: 'text',
              text: journal.egressBlockedMessage(active.record.cid, active.record.principal),
            },
          ],
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
  };

  return tools;
}
