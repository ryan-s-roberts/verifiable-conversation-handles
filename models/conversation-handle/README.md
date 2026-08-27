# SEP-0000 Conversation Handle — Quint Model

Executable Quint specification of `conversation-identity-sep-draft.md`, focused on
**§4 Lifecycle** (server) and **§4.2 client ordering**. Source:
[`lifecycle.qnt`](./lifecycle.qnt), tests in [`lifecycle_test.qnt`](./lifecycle_test.qnt).

Normative keywords in the SEP are quoted below. The model checks **behavioral
properties** the reference implementation must preserve; it does not re-prove
cryptographic theorems from §6.

**Implementation cross-check:** [`IMPLEMENTATION-ALIGNMENT.md`](./IMPLEMENTATION-ALIGNMENT.md)

---

## Quick start

```bash
npm run quint:typecheck
npm run quint:test
npm run quint:run
```

See [Verification](#verification) for full commands.

---

## System model

| Assumption | Encoding | SEP basis |
|------------|----------|-----------|
| Single issuing server | One `conversations` map; no multi-deployment routing | §2.4 audience |
| Client presents handles nondeterministically | `step` picks any enabled action | §5.1 client-authored `_meta` |
| Authenticity without MAC | `Handle.forged: bool`; `isAuthentic` ≡ `not forged` | §2.2 authenticity (abstracted) |
| State commitment | Integer `stateCommit` per conversation | §3 state commitment |
| Time | Integer `now`; `exp` compared directly | §2.2 expiry |
| Principal association | `Conversation.principal`; mismatch → `Rejected` | §2.3 server-side policy |
| Async, crash-stop | Interleaved `step`; no Byzantine server | implicit |
| Two principals | `PRINCIPALS = Set("alice", "bob")` | bounded exploration |

**Not modeled:** §1 negotiation, §5.2 DPoP, §6 encoding, §6.3 asymmetric profile,
`maxHandleBytes`, tool handlers, IFC, concurrent CAS mint retries.

---

## Modules

| Module | Role |
|--------|------|
| `lifecycle` | Parametric server lifecycle (`const` parameters) |
| `lifecycle_small` | Runnable instance: `HANDLE_LIFETIME=10`, `RETENTION=50`, `MAX_TIME=30`, `ON_MISSING="new"` |
| `client` | Client `highestSeq` merge for concurrent responses |
| `client_small` | Runnable client instance (`MAX_SEQ=10`) |

---

## State

### Server (`lifecycle`)

| Variable | Meaning | Spec |
|----------|---------|------|
| `conversations: Cid -> Conversation` | Server conversation store | §4.3 lookup for supersession |
| `Conversation.latestSeq` | Highest `seq` issued for `cid` | §2.2 seq; §4.2 rotation |
| `Conversation.stateCommit` | Current commitment bytes (abstracted) | §3 |
| `Conversation.parentCid` | Fork parent; `-1` = none | §4.5 |
| `Conversation.createdAt` | Creation time for retention | §4.6 |
| `issuedSeqs: Cid -> Set[int]` | Audit trail of every issued `seq` | §4.2 strictly increasing |
| `retiredCids: Set[Cid]` | Cids past retention | §4.6 |
| `nextCid` | Monotonic allocator for fresh cids | §4.5 fresh cid; §4.6 no reuse |
| `lastOutcome` | Result of last request resolution | test/witness hook |

### Handle (abstract wire token)

```quint
type Handle = {
  cid: Cid,
  seq: int,
  exp: int,
  stateCommit: int,
  forged: bool,
}
```

Maps to §2.2 fields embedded in a real handle (§6.2): `cid`, `exp`, `seq`, `state`.
`forged` stands in for tag verification failure (§6.2 “verifier MUST reject”).

### Client (`client`)

| Variable | Meaning | Spec |
|----------|---------|------|
| `sessions: Principal -> ClientSession` | Per-principal stored handle metadata | §4.1 client persistence |
| `ClientSession.highestSeq` | Highest advisory `seq` accepted | §4.2 ordering |

---

## Pure functions (protocol logic)

| Function | Spec clause | Behavior |
|----------|-------------|----------|
| `isExpired(h, t)` | §2.2 expiry; §4.4 | `h.exp <= t` |
| `isAuthentic(h)` | §2.2 authenticity | `not h.forged` |
| `isSuperseded(h, conv)` | §4.3 | `h.seq < conv.latestSeq` |
| `stateCommitmentChanged(h, conv)` | §4.2 MUST rotate | `h.stateCommit != conv.stateCommit` |
| `isNearExpiry(h, t)` | §4.2 SHOULD rotate | remaining lifetime `< HANDLE_LIFETIME / 2` |
| `shouldRotate(pres, h, conv, t)` | §4.2 | `true` on establishment/fork, commitment drift, or near-expiry |
| `mintHandle(conv, nextSeq, t)` | §2.2; §4.2 | Issues `{cid, seq, exp, stateCommit}` with `exp = t + lifetime` |
| `resolvePresented(...)` | §2.2; §4.3–4.4 | Forged/retired/unknown → `Rejected`; expired authentic → `ExchangeOnly`; else `Ok` with superseded flag |

`resolvePresented` encodes the presentation pipeline in `src/presentation-resolver.ts`:
verify → retired check → ownership → expiry branches.

---

## Actions (state transitions)

Each action is a **guarded** transition: disabled when preconditions fail (no silent no-op).

| Action | Models | Spec |
|--------|--------|------|
| `establish` | Request with no handle; mint `seq=1`, fresh `cid` | §4.1: “mint a new conversation and return a handle” when `onMissingHandle=new` |
| `mutateAndRotate` | Valid handle; state mutation; mint `seq+1` | §4.2 MUST rotate when commitment differs; serves tool-equivalent mutation |
| `serveWithoutRotation` | Valid handle; no mutation; no mint when rotation not required | §4.2 discretionary rotation |
| `presentSupersededHandle` | Authentic, unexpired handle with `seq < latestSeq` (read-only) | §4.3 supersession detectable; §4.3 MUST NOT reject solely for supersession |
| `presentSupersededAndMutate` | Stale handle + state mutation + rotate/mint | §4.3 + §4.2; mirrors `executePlan` with superseded presentation |
| `exchangeExpired` | Expired authentic handle → fresh handle, `ExchangeOnly` | §4.4 MUST exchange; MUST NOT treat expired as satisfying §2.2 for the request |
| `forkConversation` | New `cid`, `parentCid` set, `seq=1` | §4.5 MUST mint fresh cid; MUST record parent |
| `rejectForged` | `forged=true` → `Rejected` | §2.2 MUST reject modified/unissued handles |
| `rejectRetired` | Handle for retired `cid` → `Rejected` | §4.6 authentic but names nothing |
| `expireRetention` | Move `cid` to `retiredCids` after `RETENTION_SECONDS` | §4.6 retention expiry |
| `tick` | Advance `now` | time progression for expiry/retention |

Client actions:

| Action | Spec |
|--------|------|
| `acceptResponse` | §4.2: client stores handle when `seq >= highestSeq` |
| `rejectStale` | §4.2 SHOULD discard lower-`seq` responses |

---

## Safety invariants

Checked with `quint run --invariant=...`. A counterexample is a **spec violation**
in the modeled slice.

| Invariant | Property | Spec |
|-----------|----------|------|
| `seqStrictlyIncreasesPerCid` | For each `cid`, issued seqs are exactly `{1..latestSeq}` with no gaps or duplicates | §2.2 “`seq` strictly increases with each handle … for a given `cid`”; §4.2 “strictly greater than every `seq` … previously issued” |
| `latestSeqMatchesMaxIssued` | `latestSeq` equals max issued seq (or 0 / empty) | consistency of §2.2 seq with server store |
| `nextCidNotRetired` | Next allocated cid is never in `retiredCids` | §4.6 “MUST NOT reuse a retired `cid`” |
| `parentLinksValid` | Every `parentCid` references an existing conversation or `NO_PARENT` | §4.5 parent recording |
| `forkHasFreshCid` | Fork child `cid ≠ parentCid` | §4.5 fresh cid |
| `clientMonotonic` | `highestSeq` never decreases per principal | §4.2 client ordering invariant |

---

## Witnesses (reachability)

Checked with `quint run --witnesses=...`. **0%** means the action path is dead in
the model (over-constrained or bug).

| Witness | Reachability target | Spec |
|---------|---------------------|------|
| `witnessedEstablishment` | At least one conversation exists | §4.1 establishment |
| `witnessedExchange` | `lastOutcome == ExchangeOnly` | §4.4 exchange |
| `witnessedSuperseded` | `Ok` with `superseded=true` | §4.3 supersession detectable |
| `witnessedFork` | Some conversation has `parentCid ≠ NO_PARENT` | §4.5 fork |
| `witnessedRotation` | Some `latestSeq > 1` | §4.2 rotation / seq advance |
| `witnessedRejection` | `lastOutcome == Rejected` | §2.2 reject unauthentic; §8 failure paths |
| `witnessedAccept` (client) | Client accepted a response | §4.2 client stores higher seq |

Sampled results (Quint 0.32, `lifecycle_small`, 500–10k traces): establishment
100%, exchange ~97%, fork ~97%, rotation ~100%, rejection 100%, supersession ~92%.

---

## Scenario tests

Deterministic traces in `lifecycle_test.qnt` (suffix `Test` required by `quint test`).

| Test | Trace | Asserts | Spec |
|------|-------|---------|------|
| `establishmentMintIncreasesSeqTest` | `init → establish` | `latestSeq==1`, `issuedSeqs=={1}`, minted | §4.1; §2.2 first seq |
| `exchangeDoesNotServeTest` | `init → establish → exchangeExpired` | `ExchangeOnly` | §4.4 exchange without serving expired handle |
| `supersededDetectableTest` | `init → establish → mutateAndRotate → presentSupersededHandle` | `superseded=true`, no mint | §4.3 detectable; not rejected |
| `supersededMutateAndRotateTest` | `… → presentSupersededAndMutate` | `superseded=true`, `minted=true`, `latestSeq=3` | §4.3 + §4.2 stale append path |
| `forgedHandleRejectedTest` | `init → establish → rejectForged` | `Rejected` | §2.2 authenticity |
| `acceptMonotonicSeqTest` (client) | `init → acceptResponse` | monotonic `highestSeq` | §4.2 concurrent merge |

---

## Spec coverage matrix

| § | Requirement (summary) | Modeled? | Artifact |
|---|----------------------|----------|----------|
| **2.2** | Authenticity | partial | `isAuthentic`, `rejectForged`, `resolvePresented` |
| **2.2** | Stable `cid` per conversation | yes | `Conversation.cid` constant; `mintHandle` |
| **2.2** | Expiry | yes | `isExpired`, `exchangeExpired` |
| **2.2** | Strictly increasing `seq` | yes | `seqStrictlyIncreasesPerCid`, `mutateAndRotate`, `exchangeExpired` |
| **2.2** | State commitment in handle | partial | `stateCommit` field; rotation on drift |
| **2.3** | No principal in handle | n/a | not encoded in abstract handle |
| **2.3** | Server-side principal policy | partial | `resolvePresented` principal check |
| **3** | Commitment advisory | implicit | rotation only; no auth from commitment |
| **4.1** | No dedicated establishment method | yes | `establish` on missing handle |
| **4.1** | `onMissingHandle` policy | partial | `ON_MISSING` const; only `"new"` exercised |
| **4.2** | MUST rotate on commitment change | yes | `shouldRotate`, `mutateAndRotate` |
| **4.2** | SHOULD rotate near expiry | yes | `isNearExpiry` |
| **4.2** | Client sends highest `seq` | partial | `client` module merge policy |
| **4.2** | Client SHOULD discard lower `seq` | yes | `rejectStale`, `canAccept` |
| **4.3** | Supersession detectable | yes | `isSuperseded`, `presentSupersededHandle` |
| **4.3** | MUST NOT reject solely for supersession | yes | `presentSupersededHandle` → `Ok` |
| **4.3** | `supersededHandlePresented` mirror | no | not modeled (response meta) |
| **4.4** | MUST exchange expired authentic | yes | `exchangeExpired`, `resolvePresented` |
| **4.4** | Expired does not satisfy §2.2 for request | yes | `ExchangeOnly` (no serve path) |
| **4.5** | Fork fresh `cid` + parent | yes | `forkConversation`, invariants |
| **4.6** | Retention | partial | `expireRetention`, `rejectRetired` |
| **4.6** | MUST NOT reuse retired `cid` | yes | `nextCidNotRetired` |
| **4.6** | Mint new cid or error after retention | partial | retirement only; no remint path |
| **5.1** | Handle only in `_meta` | no | presentation abstracted |
| **6** | MAC encoding | no | `forged` flag |
| **8** | Error shapes | partial | `Rejected` / `ExchangeOnly` outcomes |

**partial** = behavioral core modeled; wire format, metadata mirrors, or policy
variants omitted.

---

## Reference implementation correspondence

| Quint | TypeScript |
|-------|------------|
| `resolvePresented` | `presentHandle()` in `src/presentation-resolver.ts` |
| `shouldRotate` | `shouldRotateHandle()` in `src/rotation.ts` |
| `mintHandle` + seq bump | `mintResponseMeta()` in `src/handle-mint.ts` |
| `establish` / `fork` | `buildExecutionPlan()` absent/fork branches in `src/execution.ts` |
| `exchangeExpired` | `executePlan()` exchange mode |
| `mutateAndRotate` | handler + `shouldRotateHandle` + mint |
| `client.canAccept` | `ConversationHandleClient.acceptResponseMeta()` in `src/client.ts` |

**The Quint spec is ground truth for modeled properties.** If the implementation
disagrees, fix the implementation or deliberate on a spec change — do not weaken
invariants to match code.

---

## Verification

```bash
# Typecheck all modules
quint typecheck models/conversation-handle/lifecycle.qnt

# Deterministic scenario tests
quint test models/conversation-handle/lifecycle_test.qnt --main=lifecycle_tests
quint test models/conversation-handle/lifecycle_test.qnt --main=client_tests

# Sampled safety + reachability (server)
quint run models/conversation-handle/lifecycle.qnt --main=lifecycle_small \
  --invariant='seqStrictlyIncreasesPerCid and latestSeqMatchesMaxIssued and nextCidNotRetired and parentLinksValid and forkHasFreshCid' \
  --max-steps=25 --n-traces=300

# Per-witness spot checks
quint run models/conversation-handle/lifecycle.qnt --main=lifecycle_small \
  --witnesses=witnessedSuperseded --max-steps=25 --n-traces=500

# Client
quint run models/conversation-handle/lifecycle.qnt --main=client_small \
  --invariant=clientMonotonic --witnesses=witnessedAccept --max-steps=15
```

`quint verify` (exhaustive Apalache) is supported but **slow** on this state space;
use for targeted single-invariant runs, not routine CI.

---

## When to update

Update `lifecycle.qnt` **before** changing:

- `src/presentation-resolver.ts` — presentation / exchange / rejection
- `src/rotation.ts` — rotation triggers
- `src/handle-mint.ts` — seq allocation / mint ordering
- `src/execution.ts` — establishment, fork, exchange execution
- `src/client.ts` — seq merge policy

Re-run `npm run quint:test` and `npm run quint:run` after any change.
