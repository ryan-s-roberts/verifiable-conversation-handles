/**
 * Unit tests for IFC label-journal state-commitment codec (SEP draft §3; rationale §5.1).
 *
 * Encodes authoritative label sets into handle `state` bytes for the IFC e2e fixture.
 */
import { describe, expect, it } from 'vitest';
import { decodeLabelHead, encodeLabelHead } from './label-head.js';

describe('label-head codec', () => {
  /** §3: versioned label head round-trips empty and populated sets. */
  it('round-trips empty and populated label sets', () => {
    expect(decodeLabelHead(encodeLabelHead([]))).toEqual([]);
    expect(decodeLabelHead(encodeLabelHead(['pii']))).toEqual(['pii']);
  });

  /** Backward compatibility: pre-versioned plain JSON array heads still decode. */
  it('decodes legacy plain JSON array heads', () => {
    const legacy = new TextEncoder().encode(JSON.stringify(['pii']));
    expect(decodeLabelHead(legacy)).toEqual(['pii']);
  });
});
