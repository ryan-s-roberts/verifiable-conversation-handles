# Quint model ↔ TypeScript implementation alignment

Cross-check of `lifecycle.qnt` against the reference implementation (`src/`).
Last reviewed against commit implementing the decomposed extension pipeline.

**Verdict:** The model **faithfully captures the §4 lifecycle core** that lives in
`presentation-resolver.ts`, `execution.ts`, `rotation.ts`, and `handle-mint.ts`.
It is **not** a byte-level model of `codec.ts` or a full model of `extension.ts`
negotiation edges. Several implementation paths are **unmodeled**; one rotation
detail differs slightly.

---

## Pipeline correspondence

```
invokeToolHandler (extension.ts)
  presentHandle          ↔  resolvePresented + presentation kinds (partial)
  buildExecutionPlan     ↔  establish / fork / exchange / bound plans
  executePlan            ↔  exchange-only / handler / rotate+mint
  shouldRotateHandle     ↔  shouldRotate
  mintResponseMeta       ↔  mintHandle + applyMint + issuedSeqs bump
```

| Implementation step | Quint artifact | Match |
|---------------------|----------------|-------|
| `presentHandle` success/failure branching | `resolvePresented` → `Outcome` | **Close** — see gaps below |
| `buildExecutionPlan` `inactive` / `absent` / `exchange` / `fork` / `valid` | `establish`, `exchangeExpired`, `forkConversation`, bound actions | **Partial** |
| `executePlan` exchange skips handler | `exchangeExpired` → `ExchangeOnly` | **Yes** |
| `executePlan` `refreshActive` before rotate | `mutateAndRotate` re-reads conv after mutation | **Yes** (implicit) |
| `shouldRotateHandle` absent/fork → always mint | `shouldRotate` `NoHandle` / fork → true | **Yes** |
| `shouldRotateHandle` commitment drift | `stateCommitmentChanged` | **Yes** |
| `shouldRotateHandle` near expiry on `valid` only | `isNearExpiry` on `Presented` only | **Yes** |
| `mintResponseMeta` seq = latestSeq + 1 | `applyMint`, `issuedSeqs` | **Yes** |
| `compareAndBumpSeq` after encode | not modeled | **N/A** |
| `ConversationHandleClient.acceptResponseMeta` | `client.canAccept` (`seq >= highestSeq`) | **Yes** |

---

## Aligned behaviors (model ≈ impl)

### Presentation (`presentHandle` / `resolvePresented`)

| Behavior | Impl | Model |
|----------|------|-------|
| Forged / bad MAC | `decodeHandle` throws → `Rejected` | `forged: true` → `Rejected` |
| Retired cid | `isRetired` → `handle_retired` | `isRetired` → `Rejected` |
| Unknown cid | `store.get` missing → `Rejected` | `not cids.keys().contains` → `Rejected` |
| Principal mismatch | `verifyOwnership` → `Rejected` | `conv.principal != principal` → `Rejected` |
| Expired authentic | `kind: 'exchange'` | `ExchangeOnly` |
| Valid, seq < latestSeq | `superseded: true` on presentation | `Ok({ superseded: true })` |
| Superseded not rejected | handler runs; e2e `supersession.test.ts` | `presentSupersededHandle` → `Ok` |

### Execution (`buildExecutionPlan` / `executePlan`)

| Behavior | Impl | Model |
|----------|------|-------|
| Establishment mints seq 1 | `createConversation` + mint after handler | `establish` → `latestSeq = 1` |
| Exchange mints, empty content | `{ content: [], _meta }` | `ExchangeOnly` (no serve) |
| Fork: new cid, parent link | `createConversation(..., parentCid)` | `forkConversation` |
| Rotation after state change | `stateCommitmentChanged` post-`refreshActive` | `mutateAndRotate` after `applyStateMutation` |
| No rotation when triggers false | `return result` without `_meta` mint | `serveWithoutRotation` → `minted: false` |

### Store / retention

| Behavior | Impl | Model |
|----------|------|-------|
| Retired cid rejected | `store.isRetired` | `rejectRetired` |
| No cid reuse after retire | `store.create` throws if retired | `nextCidNotRetired` |
| Retention marks retired | `purgeExpiredConversations` → `markRetired` | `expireRetention` |

### Client (`client.ts`)

| Behavior | Impl | Model |
|----------|------|-------|
| Accept `seq >= highestSeq` per host `sessionKey` | `acceptResponseMeta` keyed by `sessionKey` (no `conversationId` response mirror — §4.1) | `canAccept` on `sessions` map |
| Discard lower seq | early return when `seq < highestSeq` | `rejectStale` |
| Reject equal seq with different handle | `seq === highestSeq && handle differs` | `canAccept` handleId guard |
| Session isolation | Distinct host session keys (fork → child key) | `acceptOnIndependentSession` |
| clear bumps generation | `clear(sessionKey)` | `clearSession` |

---

## Gaps: implementation paths **not** in the model

These exist in `src/` but have **no dedicated Quint action** or invariant.

| Path | Implementation | Model gap |
|------|----------------|-----------|
| **Inactive** | `presentation.kind === 'inactive'` when client does not advertise extension (`presentation-resolver.ts:59–60`) | `inactiveServe` action ✓ |
| **Handle without capability** | Handle in `_meta` but no client extension → `MISSING_REQUIRED_CLIENT_CAPABILITY` | `rejectPresentedWithoutCapability` ✓ |
| **`onMissingHandle: 'none'`** | `absent` + `mintOnResponse: false` → `unbound`, no mint (`execution.ts:97–98`) | `serveUnbound` ✓ |
| **`onMissingHandle: 'reject'`** | `presentFailure('handle_missing')` | `rejectMissingHandle` ✓ |
| **Unauthenticated establish** | `buildExecutionPlan` fails if no principal on `absent` | `establish` always picks a principal |
| **Unauthenticated presented handle** | `verifyOwnership` → `unauthenticated` | `resolvePresented` checks principal but no separate unauthenticated action |
| **Fork on expired handle** | Expiry checked **before** fork (`presentation-resolver.ts:109–113`) → **exchange wins** | `forkConversation` requires valid parent; no expired+fork interaction |
| **Decode error variants** | `handle_too_large`, `handle_expired` at decode, `unknown key_id`, etc. | Collapsed to `forged: bool` |
| **`maxHandleBytes`** | `encodeHandle` / decode limits | Not modeled |
| **Mint encode-before-CAS** | `handle-mint.ts`: encode then `compareAndBumpSeq` | Seq bump modeled; encode failure not modeled |
| **Concurrent CAS retry** | `MAX_MINT_CAS_RETRIES` loop | Not modeled |
| **`supersededHandlePresented` meta** | Set only when `mintResponseMeta` runs | Not in `Outcome` (README notes this) |
| **Optional `stateCommitment` hook** | No rotation on commitment if hook omitted (`rotation.ts:12–14`) | Model always has `stateCommit`; `mutateAndRotate` always drifts commitment |
| **`purgeExpiredConversations`** | Called explicitly on manager | Modeled as nondet `expireRetention` step, not tied to plugin API |

---

## Gaps: model behaviors **not** exactly matching impl

| Topic | Model | Implementation | Severity |
|-------|-------|----------------|----------|
| **Superseded + mutate + rotate** | `presentSupersededAndMutate` | Stale handle + mutation + mint (`supersession.test.ts` append path) | **Yes** |
| **Rotation input handle** | `mutateAndRotate` presents `seq == latestSeq` | Client may present `seq < latestSeq`; rotation still uses `active.decoded` from presentation | **Low** — commitment/near-expiry logic still matches |
| **`shouldRotate` on exchange** | N/A (separate action) | Exchange never calls `shouldRotateHandle` | **None** — aligned |
| **Fork always rotates** | `fork` → mint seq 1 on child | `presentation.kind === 'fork'` → `shouldRotateHandle` true | **Yes** |
| **Retired record still in store** | `conversations` retains retired cid | `markRetired` keeps record in map | **Yes** |
| **Client invalid seq** | Any int in `0..MAX_SEQ` | `parseAdvisorySeq` rejects NaN, non-integer, OOR | **Low** — add `rejectInvalidSeq` if needed |

---

## Invariants vs implementation guarantees

| Quint invariant | Implementation enforcement |
|-----------------|---------------------------|
| `seqStrictlyIncreasesPerCid` | `compareAndBumpSeq` only increments by 1; mint always uses `latestSeq + 1` |
| `latestSeqMatchesMaxIssued` | Same — no seq decrement path in impl |
| `nextCidNotRetired` | `generateCid()` + `store.create` rejects retired keys |
| `parentLinksValid` / `forkHasFreshCid` | `createConversation` with `parentCid` |

**Not enforced in impl as a single check:** the model’s `issuedSeqs` audit map is a spec-level bookkeeping aid; the store only tracks `latestSeq`, not the full history set. The invariant is **stronger than the store API** but **implied** by monotonic mint.

---

## Scenario tests vs e2e conformance

| Quint `lifecycle_test.qnt` | Conformance e2e |
|----------------------------|-----------------|
| `establishmentMintIncreasesSeqTest` | `establishment-rotation.test.ts` §4.1 |
| `exchangeDoesNotServeTest` | `exchange.test.ts` §4.4 |
| `supersededDetectableTest` | `supersession.test.ts` (read / detect only) |
| `supersededMutateAndRotateTest` | `supersession.test.ts` (stale handle + append → mint) |
| `forgedHandleRejectedTest` | `security.test.ts` tamper cases |
| `acceptMonotonicSeqTest` | `client.test.ts`, `client-concurrency.test.ts` |

E2e coverage **without** Quint analogue: negotiation, §1.1 tool marking, retention remint/error, IFC, concurrent parallel handles, `onMissingHandle: 'none'`.

---

## Recommendations

### To tighten model ↔ impl alignment

1. ~~**`presentSupersededAndMutate` action**~~ — **done** (`presentSupersededAndMutate` + `supersededMutateAndRotateTest`)
2. ~~**`establishNone` / `rejectMissing`**~~ — **done** (`serveUnbound`, `rejectMissingHandle`)
3. ~~**`inactive` step**~~ — **done** (`inactiveServe`, `rejectPresentedWithoutCapability`)
4. **`forkBlockedByExpiry`** — assert expired presentation cannot reach fork (exchange only); covered by `exchangeDoesNotServeTest` comment + presentation order in impl.

### Implementation notes (model informed review)

- **`supersededHandlePresented` only on mint:** If handler runs without rotation (e.g. superseded read-only), response may omit the SHOULD flag from §4.3 — model does not capture this; e2e only asserts flag when append forces rotation.
- **Model is ground truth for modeled slices:** If impl diverges on seq monotonicity or exchange-not-serve, fix impl; do not weaken invariants.

---

## Multi-label IFC (`flow_facts.qnt`)

Plasm-shaped companion model for `src/fixtures/ifc-tools.ts` / `conformance/ifc-e2e.test.ts`.

| Implementation | Quint | Match |
|----------------|-------|-------|
| `TaintJournal.mark` (set union) | `markAndMint` | **Yes** |
| `TaintJournal.clearLabels` (sanitizer) | `clearAndMint` | **Yes** |
| `blocksEgress` / `EGRESS_FORBIDDEN_LABELS` | `hasForbidden` ∩ `FORBIDDEN` | **Yes** |
| Label head in state commitment | `server.snapshots: seq → Set[Label]` | **Yes** (abstract) |
| Client LWW `acceptResponseMeta` | `acceptLww` / `rejectStale` | **Yes** |
| Egress check then mint (TOCTOU) | `beginEgress` → `mutateWhilePending` → `finishMint` | **Yes** |
| Atomic egress (no interleave) | `egressAtomic` | **Yes** |

**Invariant:** `clientMonotonicSeq`, `clientCommitIsSnapshot`, `egressOutcomeConsistent` (handler-at-begin vs journal-at-mint agrees, or `sawDisagreement`).

```bash
quint test models/conversation-handle/flow_facts_test.qnt --main=flow_facts_tests
```

---

## Quick re-check command

After changing `src/presentation-resolver.ts`, `execution.ts`, `rotation.ts`,
`handle-mint.ts`, `client.ts`, or `src/fixtures/ifc-tools.ts`:

```bash
npm run quint:typecheck && npm run quint:test && npm run quint:run
```

Then update this document if presentation order, rotation triggers, exchange
semantics, or IFC journal rules change.
