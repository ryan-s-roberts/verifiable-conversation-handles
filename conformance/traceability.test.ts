/**
 * Traceability gate: every `sep-0000-*` check in `conformance/sep-0000.yaml` must map to a
 * vitest `it(...)` name in the traced test files (or be explicitly excluded/conditional).
 *
 * Prevents spec requirements from drifting without a corresponding automated check.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const spec = readFileSync(join(root, 'conversation-identity-sep-draft.md'), 'utf8');
const trace = parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'sep-0000.yaml'), 'utf8')) as {
  requirements: Array<{ text: string; check?: string; excluded?: string; issue?: string }>;
};

const specificationSection = spec.split('## Specification')[1]?.split('## Worked example')[0] ?? '';
const rfc2119 = [...specificationSection.matchAll(/\b(MUST NOT|MUST|SHOULD NOT|SHOULD|REQUIRED)\b/g)].length;

const TEST_FILES = [
  'src/client.test.ts',
  'src/codec.test.ts',
  'src/errors.test.ts',
  ...readdirSync(join(root, 'conformance/e2e'))
    .filter((name) => name.endsWith('.test.ts'))
    .map((name) => `conformance/e2e/${name}`),
] as const;

/** Checks that require asymmetric profile, DPoP, or other harness hooks not in this reference server. */
const CONDITIONAL_CHECKS = new Set([
  'sep-0000-asymmetric-audience-checked',
  'sep-0000-asymmetric-profile-constraints',
  'sep-0000-asymmetric-publishes-jwks',
  'sep-0000-pop-binding-when-available',
  'sep-0000-jwks-uri-required-for-asymmetric',
]);

function collectVitestNames(): string[] {
  const names: string[] = [];
  for (const file of TEST_FILES) {
    const content = readFileSync(join(root, file), 'utf8');
    for (const match of content.matchAll(/\bit\(\s*['`]([^'"`]+)['`]/g)) {
      names.push(match[1]!);
    }
  }
  return names;
}

describe('sep-0000 traceability', () => {
  it('maps primary specification requirements to checks, exclusions, or issues', () => {
    expect(trace.requirements.length).toBeGreaterThan(30);
    for (const row of trace.requirements) {
      expect(row.check || row.excluded || row.issue, row.text).toBeTruthy();
    }
  });

  it('documents coverage against specification RFC 2119 density', () => {
    const mapped = trace.requirements.filter((r) => r.check).length;
    const excluded = trace.requirements.filter((r) => r.excluded).length;
    const issues = trace.requirements.filter((r) => r.issue).length;
    expect(mapped + excluded + issues).toBeGreaterThanOrEqual(40);
    expect(rfc2119).toBeGreaterThan(mapped);
  });

  it('every exercisable sep-0000 check id is referenced by at least one vitest name', () => {
    const testNames = collectVitestNames();
    const missing: string[] = [];
    for (const row of trace.requirements) {
      if (!row.check || CONDITIONAL_CHECKS.has(row.check)) {
        continue;
      }
      const covered = testNames.some((name) => name.includes(row.check!));
      if (!covered) {
        missing.push(row.check);
      }
    }
    expect(missing, `checks without vitest coverage: ${missing.join(', ')}`).toEqual([]);
  });
});
