import { describe, expect, it } from 'vitest';
import { decodeHandle } from '../src/codec.js';
import { decodeLabelHead } from '../src/fixtures/label-head.js';
import { parseCallToolHandleError } from '../src/errors.js';
import { setClientSession } from '../src/test-helpers.js';
import { readToolHandleMeta } from '../src/tool-meta.js';
import {
  callEgressPost,
  callReceivePii,
  handleMetaFromResult,
  startIfcTestHarness,
  TEST_KEYS,
  textFromResult,
  withClient,
} from './harness.js';

/** Decode the §3 state-commitment bytes carried inside a handle (label-journal head in this fixture). */
function stateLabelsFromHandle(handle: string): string[] {
  const decoded = decodeHandle(TEST_KEYS, handle);
  return decodeLabelHead(decoded.state);
}

/**
 * Worked IFC consumer (SEP draft §3, §4.3, §8; rationale §5.1).
 *
 * The protocol supplies unforgeable conversation identity and an opaque state commitment; label
 * enforcement is server policy. This fixture models an information-flow runtime that:
 *   - keys a taint journal on `cid` (§2.2),
 *   - embeds the journal head in the state commitment (§3),
 *   - applies **current** authoritative labels on every request, including superseded handles (§4.3),
 *   - rejects missing handles after principal-level taint (§8 omission-as-maximum-taint policy).
 */
describe('ifc use-case e2e', () => {
  /**
   * §1.1: IFC tools advertise `preferred` — missing handle may mint until principal-level
   * fail-closed policy engages (post-taint reject). Marking `required` would overclaim.
   */
  it('sep-0000-tool-mark-on-list: IFC tools advertise preferred handle marks', async () => {
    const harness = await startIfcTestHarness();
    try {
      await withClient(harness, 'alice', async (client) => {
        const listed = await client.listTools();
        const byName = Object.fromEntries((listed.tools ?? []).map((t) => [t.name, t]));
        expect(readToolHandleMeta(byName.receive_pii)).toEqual({
          requirement: 'preferred',
          mayMint: true,
        });
        expect(readToolHandleMeta(byName.egress_post)).toEqual({
          requirement: 'preferred',
          mayMint: true,
        });
      });
    } finally {
      await harness.close();
    }
  });

  /**
   * §3 (state commitment) + §4.2 (rotation on commitment drift) + §4.3 (IFC supersession policy).
   *
   * Narrative: Alice starts clean and egress succeeds. `receive_pii` is a read-like boundary crossing
   * that taints the journal; the server rotates a handle whose commitment now names `pii`. Further
   * egress on the current handle is blocked.
   *
   * Stale-handle replay (pre-PII handle with an empty commitment) must not roll back taint: §4.3
   * permits an IFC runtime to ignore the commitment the presented handle carries and apply current
   * labels instead. The journal still records `pii` for this principal/cid, so egress remains blocked
   * even though the replayed handle's state bytes are clean.
   */
  it('ifc-use-case: egress blocked after PII received; state commitment carries label head', async () => {
    const harness = await startIfcTestHarness();
    try {
      await withClient(harness, 'alice', async (client, handleClient) => {
        const clean = await callEgressPost(client, handleClient, 'analytics', 'metrics');
        expect(clean.result).not.toMatchObject({ isError: true });
        expect(textFromResult(clean.result)).toContain('posted');

        const prePiiHandle = handleClient.getHandle()!;
        const prePiiSeq = (clean.handleMeta as { seq: number }).seq;
        expect(stateLabelsFromHandle(prePiiHandle)).toEqual([]);

        const pii = await callReceivePii(client, handleClient);
        expect(textFromResult(pii.result)).toContain('ssn-123-45-6789');
        const postPiiHandle = (pii.handleMeta as { handle: string }).handle;
        expect(stateLabelsFromHandle(postPiiHandle)).toEqual(['pii']);

        const blocked = await callEgressPost(client, handleClient, 'webhook', 'exfil attempt');
        expect(blocked.result).toMatchObject({ isError: true });
        expect(textFromResult(blocked.result)).toMatch(/egress blocked.*pii/i);

        setClientSession(handleClient, {
          handle: prePiiHandle,
          highestSeq: prePiiSeq,
        });
        expect(stateLabelsFromHandle(prePiiHandle)).toEqual([]);

        const stillBlocked = await callEgressPost(client, handleClient, 'webhook', 'stale handle exfil');
        expect(stillBlocked.result).toMatchObject({ isError: true });
        expect(textFromResult(stillBlocked.result)).toMatch(/egress blocked.*pii/i);
      });
    } finally {
      await harness.close();
    }
  });

  /**
   * §2.3 (principal–conversation association) + §4.3 + §5.1 fork (§4.5) + §8 fail-closed policy.
   *
   * Narrative: Asynchronous Provenance Reuse (rationale §5.1) — an adversary (or compromised model)
   * may mint a **fresh** `cid` via fork while the principal has already observed PII in another
   * conversation. The forked handle carries a clean per-cid commitment, but principal-scoped taint
   * must still block guarded egress. This closes the bypass where only cid-level labels were checked.
   *
   * Flow: seed conversation → fork a clean child (§5.1 `fork: true`) → receive PII on the parent →
   * present the fork handle → egress must fail because the **principal** is tainted, not merely the cid.
   */
  it('ifc-use-case fail-closed: egress blocked on clean forked conversation when principal is tainted', async () => {
    const harness = await startIfcTestHarness();
    try {
      await withClient(harness, 'alice', async (client, handleClient) => {
        await callEgressPost(client, handleClient, 'analytics', 'seed');
        const forked = await client.callTool({
          name: 'egress_post',
          arguments: { destination: 'fork-probe', body: 'probe' },
          _meta: handleClient.buildRequestMeta('default', { fork: true }),
        });
        const forkMeta = handleMetaFromResult(forked);
        expect(forkMeta).toBeDefined();
        expect(stateLabelsFromHandle(forkMeta!.handle)).toEqual([]);

        await callReceivePii(client, handleClient);

        setClientSession(handleClient, {
          handle: forkMeta!.handle,
          highestSeq: forkMeta!.seq,
        });
        const blocked = await client.callTool({
          name: 'egress_post',
          arguments: { destination: 'exfil', body: 'via-clean-cid' },
          _meta: handleClient.buildRequestMeta(),
        });
        expect(blocked).toMatchObject({ isError: true });
        expect(textFromResult(blocked)).toMatch(/egress blocked.*pii/i);
      });
    } finally {
      await harness.close();
    }
  });

  /**
   * §8 (handle omission) + rationale §5.1 (omission as maximum taint).
   *
   * Narrative: A model that suppresses the handle after PII exposure must not obtain a fresh,
   * untainted conversation. Under this fixture's fail-closed policy (`resolveOnMissingHandle →
   * reject` when the principal has seen PII), clearing the client session and omitting the handle
   * yields `handle_missing` rather than silently minting a new `cid`.
   */
  it('ifc-use-case fail-closed: missing handle rejected after principal saw PII', async () => {
    const harness = await startIfcTestHarness();
    try {
      await withClient(harness, 'alice', async (client, handleClient) => {
        await callReceivePii(client, handleClient);
        handleClient.clear();
        const result = await client.callTool({
          name: 'egress_post',
          arguments: { destination: 'analytics', body: 'exfil' },
          _meta: handleClient.buildRequestMeta(),
        });
        expect(result).toMatchObject({ isError: true });
        const envelope = parseCallToolHandleError(result);
        expect(envelope?.data.reason).toBe('handle_missing');
      });
    } finally {
      await harness.close();
    }
  });

  /**
   * §2.3 (cross-principal isolation) — negative control.
   *
   * Narrative: Alice's taint and fail-closed policy are scoped to her principal. Bob, who never
   * observed PII, must still mint a clean conversation and egress successfully. This confirms the
   * fixture blocks identity-reset and cross-cid bypass for a tainted principal without denying
   * unrelated principals.
   */
  it('ifc-use-case negative control: other principal egress succeeds without prior PII', async () => {
    const harness = await startIfcTestHarness();
    try {
      await withClient(harness, 'alice', async (client, handleClient) => {
        await callReceivePii(client, handleClient);
        handleClient.clear();
        const blocked = await client.callTool({
          name: 'egress_post',
          arguments: { destination: 'analytics', body: 'exfil' },
          _meta: handleClient.buildRequestMeta(),
        });
        expect(blocked).toMatchObject({ isError: true });
      });

      await withClient(harness, 'bob', async (client, handleClient) => {
        const result = await callEgressPost(client, handleClient, 'analytics', 'other-principal');
        expect(result.result).not.toMatchObject({ isError: true });
        expect(stateLabelsFromHandle(handleClient.getHandle()!)).toEqual([]);
      });
    } finally {
      await harness.close();
    }
  });

  /**
   * §4.2 LWW × IFC: parallel taint sources.
   *
   * N concurrent `receive_pii` calls each mint a replacement; the client keeps only max(seq).
   * Intermediate commitments are dropped client-side by construction. For monotone labels that is
   * safe *only because* enforcement reads the server journal (§4.3 IFC policy), not the retained
   * commitment bytes. Every minted head still carries `pii` once any sibling has marked.
   */
  it('ifc-use-case LWW: parallel receive_pii — client keeps max seq; journal authoritative', async () => {
    const harness = await startIfcTestHarness();
    try {
      await withClient(harness, 'alice', async (client, handleClient) => {
        await callEgressPost(client, handleClient, 'analytics', 'seed');
        const meta = handleClient.buildRequestMeta();
        const results = await Promise.all(
          [0, 1, 2].map(() =>
            client.callTool({
              name: 'receive_pii',
              arguments: {},
              _meta: meta,
            }),
          ),
        );
        for (const result of results) {
          handleClient.acceptResponseMeta((result as { _meta?: Record<string, unknown> })._meta);
        }
        const metas = results.map((r) => handleMetaFromResult(r)).filter(Boolean) as Array<{
          handle: string;
          seq: number;
        }>;
        expect(metas.length).toBe(3);
        const maxSeq = Math.max(...metas.map((m) => m.seq));
        expect(handleClient.getSession().highestSeq).toBe(maxSeq);
        for (const m of metas) {
          expect(stateLabelsFromHandle(m.handle)).toEqual(['pii']);
        }
        expect(stateLabelsFromHandle(handleClient.getHandle()!)).toEqual(['pii']);
        expect(harness.journal.hasPrincipal('alice', 'pii')).toBe(true);

        const blocked = await callEgressPost(client, handleClient, 'webhook', 'after-parallel-taint');
        expect(blocked.result).toMatchObject({ isError: true });
      });
    } finally {
      await harness.close();
    }
  });

  /**
   * §4.2 LWW × IFC: out-of-order accept must not resurrect a clean commitment over a newer tainted one.
   *
   * After taint, accepting the pre-PII (lower seq) meta is a no-op. The client continues to present
   * the higher-seq handle; egress stays blocked via the journal even if someone inspects the discarded
   * clean commitment bytes.
   */
  it('ifc-use-case LWW: lower-seq clean commitment cannot displace tainted higher seq', async () => {
    const harness = await startIfcTestHarness();
    try {
      await withClient(harness, 'alice', async (client, handleClient) => {
        const clean = await callEgressPost(client, handleClient, 'analytics', 'seed');
        const cleanMeta = (clean.result as { _meta?: Record<string, unknown> })._meta;
        const cleanSeq = (clean.handleMeta as { seq: number }).seq;

        const pii = await callReceivePii(client, handleClient);
        const taintedSeq = (pii.handleMeta as { seq: number }).seq;
        expect(taintedSeq).toBeGreaterThan(cleanSeq);
        expect(stateLabelsFromHandle(handleClient.getHandle()!)).toEqual(['pii']);

        handleClient.acceptResponseMeta(cleanMeta);
        expect(handleClient.getSession().highestSeq).toBe(taintedSeq);
        expect(stateLabelsFromHandle(handleClient.getHandle()!)).toEqual(['pii']);

        const blocked = await callEgressPost(client, handleClient, 'webhook', 'lww-regression');
        expect(blocked.result).toMatchObject({ isError: true });
      });
    } finally {
      await harness.close();
    }
  });

  /**
   * §4.2 / §4.3 TOCTOU under concurrency: egress check vs commitment mint.
   *
   * Parallel `receive_pii` + `egress_post` on the same presented handle. The egress *handler* may
   * observe a clean journal and succeed, while a sibling taint lands before response mint — so a
   * successful egress response can carry a `pii` commitment. Conversely, egress may lose the race
   * and error. Either way: never treat the retained commitment as the allow/deny oracle; the journal
   * is authoritative. LWW on the client merely picks which opaque snapshot bytes survive.
   */
  it('ifc-use-case LWW: concurrent taint+egress — commitment may disagree with handler outcome', async () => {
    const harness = await startIfcTestHarness();
    try {
      await withClient(harness, 'alice', async (client, handleClient) => {
        await callEgressPost(client, handleClient, 'analytics', 'seed');
        const meta = handleClient.buildRequestMeta();

        const [piiResult, egressResult] = await Promise.all([
          client.callTool({ name: 'receive_pii', arguments: {}, _meta: meta }),
          client.callTool({
            name: 'egress_post',
            arguments: { destination: 'webhook', body: 'race' },
            _meta: meta,
          }),
        ]);

        handleClient.acceptResponseMeta((piiResult as { _meta?: Record<string, unknown> })._meta);
        handleClient.acceptResponseMeta((egressResult as { _meta?: Record<string, unknown> })._meta);

        const egressMeta = handleMetaFromResult(egressResult);
        const egressOk = (egressResult as { isError?: boolean }).isError !== true;

        // receive_pii always taints the journal; egress may win or lose the TOCTOU race.
        expect(harness.journal.hasPrincipal('alice', 'pii')).toBe(true);

        if (egressOk && egressMeta?.handle) {
          // Allowed egress whose mint ran after taint can embed `pii` in the commitment.
          // Allowed egress that minted before taint may still carry a clean head — either is fine;
          // the point is the next request consults the journal, not these bytes.
        } else if (!egressOk) {
          expect(textFromResult(egressResult)).toMatch(/egress blocked.*pii/i);
        }

        // Subsequent egress must fail — journal wins over any LWW-retained snapshot.
        const later = await callEgressPost(client, handleClient, 'webhook', 'post-race');
        expect(later.result).toMatchObject({ isError: true });
        expect(stateLabelsFromHandle(handleClient.getHandle()!)).toEqual(['pii']);
      });
    } finally {
      await harness.close();
    }
  });
});
