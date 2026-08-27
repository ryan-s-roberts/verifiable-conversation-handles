/**
 * Unit tests for §1.1 tool marking helpers (`tool-meta.ts`).
 *
 * Check ids in test names map to `conformance/sep-0000.yaml`.
 */
import { describe, expect, it } from 'vitest';
import { EXTENSION_ID } from './schema/draft/schema.js';
import { buildToolHandleMeta, readToolHandleMeta } from './tool-meta.js';

describe('tool handle meta (§1.1)', () => {
  /** §1.1: marked tools carry requirement and mayMint under the extension id. */
  it('sep-0000-tool-mark-shape: buildToolHandleMeta emits namespaced mark with mayMint true', () => {
    expect(buildToolHandleMeta('preferred')).toEqual({
      [EXTENSION_ID]: { requirement: 'preferred', mayMint: true },
    });
    expect(buildToolHandleMeta('required')).toEqual({
      [EXTENSION_ID]: { requirement: 'required', mayMint: true },
    });
  });

  /** §1.1: fail-closed tools advertise `requirement: required` on the wire. */
  it('sep-0000-tool-mark-required: required mark shape is well-formed', () => {
    const mark = buildToolHandleMeta('required');
    expect(mark[EXTENSION_ID].requirement).toBe('required');
    expect(mark[EXTENSION_ID].mayMint).toBe(true);
  });

  /** §1.1: clients parse well-formed marks and ignore unknown / malformed payloads. */
  it('sep-0000-tool-mark-parse: readToolHandleMeta accepts valid marks and rejects garbage', () => {
    expect(
      readToolHandleMeta({
        name: 'memory_append',
        _meta: { [EXTENSION_ID]: { requirement: 'preferred', mayMint: true, extra: 'ignored' } },
      }),
    ).toEqual({ requirement: 'preferred', mayMint: true });

    expect(
      readToolHandleMeta({
        _meta: { [EXTENSION_ID]: { requirement: 'required', mayMint: false } },
      }),
    ).toEqual({ requirement: 'required', mayMint: false });

    expect(readToolHandleMeta({ name: 'health' })).toBeUndefined();
    expect(
      readToolHandleMeta({
        _meta: { [EXTENSION_ID]: { requirement: 'sometimes' } },
      }),
    ).toBeUndefined();
  });

  /** §1.1: unmarked tools are conversation-agnostic; use `.requirement` for required vs preferred. */
  it('sep-0000-tool-mark-client-helpers: readToolHandleMeta distinguishes unmarked and requirement', () => {
    const preferred = { _meta: buildToolHandleMeta('preferred') };
    const required = { _meta: buildToolHandleMeta('required') };
    expect(readToolHandleMeta(preferred)).toBeDefined();
    expect(readToolHandleMeta(required)).toBeDefined();
    expect(readToolHandleMeta({ name: 'ping' })).toBeUndefined();
    expect(readToolHandleMeta(preferred)?.requirement).toBe('preferred');
    expect(readToolHandleMeta(required)?.requirement).toBe('required');
  });
});
