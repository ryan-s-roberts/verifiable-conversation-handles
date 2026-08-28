import { decodeVersionedJsonHead, encodeVersionedJsonHead } from './versioned-json-head.js';

export const LABEL_HEAD_VERSION = 1;

/** Plasm-shaped data-class names (confidentiality + integrity). Sorted for stable heads. */
export const TAINT_LABELS = ['credentials', 'pii', 'untrusted'] as const;
export type TaintLabel = (typeof TAINT_LABELS)[number];

const LABEL_SET = new Set<string>(TAINT_LABELS);

export function isTaintLabel(value: unknown): value is TaintLabel {
  return typeof value === 'string' && LABEL_SET.has(value);
}

export function encodeLabelHead(labels: Iterable<TaintLabel>): Uint8Array {
  const sorted = [...new Set(labels)].filter(isTaintLabel).sort();
  return encodeVersionedJsonHead(LABEL_HEAD_VERSION, 'labels', sorted);
}

export function decodeLabelHead(bytes: Uint8Array): TaintLabel[] {
  return decodeVersionedJsonHead(
    bytes,
    LABEL_HEAD_VERSION,
    'labels',
    (raw) => (Array.isArray(raw) ? raw.filter(isTaintLabel) : []),
    (parsed) => (Array.isArray(parsed) ? parsed.filter(isTaintLabel) : undefined),
  );
}
