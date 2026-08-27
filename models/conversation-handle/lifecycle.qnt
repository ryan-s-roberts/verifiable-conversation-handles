// SEP-0000 Verifiable Conversation Handles — Quint model
//
// Spec: conversation-identity-sep-draft.md
// Traceability: models/conversation-handle/README.md
//
// This file models:
//   - lifecycle  — server conversation store, presentation, mint, rotation (§4)
//   - client     — client highestSeq merge for concurrent responses (§4.2)
//
// Abstracted away: §6 MAC encoding (authenticity → forged flag), transport,
// tool handlers, response _meta mirrors, maxHandleBytes, DPoP.

// =============================================================================
// Server lifecycle (§4)
// =============================================================================

module lifecycle {
  // --- parameters (instantiate in lifecycle_small or test modules) ---

  const HANDLE_LIFETIME: int       // §7 handleLifetimeSeconds
  const RETENTION_SECONDS: int     // §7 conversationRetentionSeconds; §4.6
  const ON_MISSING: str              // §7 onMissingHandle: "new" | "none"
  const MAX_TIME: int                // exploration bound for tick()
  const MAX_STATE: int             // bounds stateCommit mutations

  assume _ = HANDLE_LIFETIME > 0
  assume _ = RETENTION_SECONDS > 0
  assume _ = MAX_TIME >= HANDLE_LIFETIME
  assume _ = ON_MISSING == "new" or ON_MISSING == "none"

  // --- types ---

  type Cid = int
  type Principal = str

  // Server-side conversation record (store analogue in src/store.ts).
  type Conversation = {
    cid: Cid,                // §2.2 stable conversation identifier
    latestSeq: int,           // §2.2 / §4.2 highest seq issued for this cid
    stateCommit: int,         // §3 opaque commitment (abstracted as version int)
    principal: Principal,     // §2.3 server-side association (not in handle)
    parentCid: int,           // §4.5 fork parent; NO_PARENT when root
    createdAt: int,             // §4.6 retention clock start
  }

  // Abstract wire handle. Real encoding is §6.2; tag failure → forged=true.
  type Handle = {
    cid: Cid,
    seq: int,                 // §2.2 monotonic per cid
    exp: int,                 // §2.2 absolute expiry (Unix seconds)
    stateCommit: int,         // §3 commitment bytes at mint time
    forged: bool,             // §2.2 authenticity (inverse of valid MAC)
  }

  type PresentedReq = { handle: Handle, fork: bool }

  // What the client sends on the wire (simplified).
  type Presentation =
    | NoHandle(Principal)      // §4.1 no handle in _meta
    | Presented(PresentedReq)  // §4.1 / §4.5 optional fork flag

  type OkOutcome = {
    superseded: bool,          // §4.3 presented seq < latestSeq
    minted: bool,              // whether response includes a new handle
  }

  type Outcome =
    | Ok(OkOutcome)            // request accepted (may or may not mint)
    | ExchangeOnly             // §4.4 expired authentic → fresh handle only
    | Rejected                 // §2.2 / §8 presentation failure

  pure val NO_PARENT: int = -1
  pure val PRINCIPALS: Set[Principal] = Set("alice", "bob")

  // --- state ---

  var now: int
  var nextCid: Cid                          // monotonic cid allocator (§4.5, §4.6)
  var conversations: Cid -> Conversation    // authoritative server store
  var retiredCids: Set[Cid]                 // §4.6 past retention; must not be reissued
  var issuedSeqs: Cid -> Set[int]           // audit: every seq ever minted per cid
  var lastOutcome: Outcome                  // hook for witnesses and scenario tests

  // ===========================================================================
  // Pure logic — mirrors src/presentation-resolver.ts, rotation.ts, handle-mint.ts
  // ===========================================================================

  // §2.2 expiry; §4.4 expired handles remain authentic but cannot serve.
  pure def isExpired(h: Handle, t: int): bool = h.exp <= t

  pure def isRetired(retired: Set[Cid], cid: Cid): bool = retired.contains(cid)

  // §2.2 authenticity (MAC verify success in real implementation).
  pure def isAuthentic(h: Handle): bool = not(h.forged)

  // §4.3: server can tell presented handle is not the most recent for cid.
  pure def isSuperseded(h: Handle, conv: Conversation): bool = h.seq < conv.latestSeq

  // §4.2 MUST rotate when commitment in handle differs from server requirement.
  pure def stateCommitmentChanged(h: Handle, conv: Conversation): bool =
    h.stateCommit != conv.stateCommit

  // §4.2 SHOULD rotate when remaining lifetime < half of handleLifetimeSeconds.
  pure def isNearExpiry(h: Handle, t: int): bool = (h.exp - t) < (HANDLE_LIFETIME / 2)

  // Rotation policy (src/rotation.ts shouldRotateHandle).
  pure def shouldRotate(pres: Presentation, h: Handle, conv: Conversation, t: int): bool =
    match pres {
      | NoHandle(_) => true
      | Presented(req) =>
        if (req.fork) {
          true
        } else if (stateCommitmentChanged(h, conv)) {
          true
        } else if (isNearExpiry(h, t)) {
          true
        } else {
          false
        }
    }

  // Mint a handle token (src/handle-mint.ts encodeHandle + seq bump).
  pure def mintHandle(conv: Conversation, nextSeq: int, t: int): Handle = {
    cid: conv.cid,
    seq: nextSeq,
    exp: t + HANDLE_LIFETIME,
    stateCommit: conv.stateCommit,
    forged: false,
  }

  pure def freshConversation(cid: Cid, principal: Principal, parent: int, t: int): Conversation = {
    cid: cid,
    latestSeq: 0,
    stateCommit: 0,
    principal: principal,
    parentCid: parent,
    createdAt: t,
  }

  pure def applyMint(conv: Conversation, nextSeq: int): Conversation = {
    ...conv,
    latestSeq: nextSeq,
  }

  // Stand-in for a tool handler that mutates conversation-scoped state (§3).
  pure def applyStateMutation(conv: Conversation): Conversation = {
    ...conv,
    stateCommit: conv.stateCommit + 1,
  }

  // Presentation resolution (src/presentation-resolver.ts presentHandle).
  // Order: authenticity → retired → known cid → principal → expiry branch.
  pure def resolvePresented(
    cids: Cid -> Conversation,
    retired: Set[Cid],
    t: int,
    h: Handle,
    principal: Principal,
  ): Outcome =
    if (not(isAuthentic(h))) {
      Rejected
    } else if (isRetired(retired, h.cid)) {
      Rejected
    } else if (not(cids.keys().contains(h.cid))) {
      Rejected
    } else {
      val conv = cids.get(h.cid)
      if (conv.principal != principal) {
        Rejected
      } else if (isExpired(h, t)) {
        ExchangeOnly
      } else {
        Ok({ superseded: isSuperseded(h, conv), minted: false })
      }
    }

  // --- outcome predicates (for invariants, witnesses, tests) ---

  pure def outcomeIsExchange(o: Outcome): bool =
    match o {
      | ExchangeOnly => true
      | _ => false
    }

  pure def outcomeIsRejected(o: Outcome): bool =
    match o {
      | Rejected => true
      | _ => false
    }

  pure def outcomeIsSuperseded(o: Outcome): bool =
    match o {
      | Ok(r) => r.superseded
      | _ => false
    }

  pure def outcomeMinted(o: Outcome): bool =
    match o {
      | Ok(r) => r.minted
      | _ => false
    }

  // ===========================================================================
  // Safety invariants — checked with quint run --invariant=...
  // ===========================================================================

  // §4.6: next allocation must never reuse a retired cid.
  val nextCidNotRetired: bool = not(retiredCids.contains(nextCid))

  // §2.2 / §4.2: seq strictly increases; issued set is exactly 1..latestSeq.
  val seqStrictlyIncreasesPerCid: bool =
    conversations.keys().forall(cid =>
      issuedSeqs.keys().contains(cid)
        and issuedSeqs.get(cid).size() == conversations.get(cid).latestSeq
        and issuedSeqs.get(cid).forall(s => s > 0 and s <= conversations.get(cid).latestSeq)
    )

  // Store latestSeq is consistent with issuedSeqs audit trail.
  val latestSeqMatchesMaxIssued: bool =
    conversations.keys().forall(cid =>
      if (not(issuedSeqs.keys().contains(cid))) {
        conversations.get(cid).latestSeq == 0
      } else if (conversations.get(cid).latestSeq == 0) {
        issuedSeqs.get(cid) == Set()
      } else {
        issuedSeqs.get(cid).contains(conversations.get(cid).latestSeq)
      }
    )

  // §4.5: fork parent must reference an existing conversation.
  val parentLinksValid: bool =
    conversations.keys().forall(cid => {
      val p = conversations.get(cid).parentCid
      p == NO_PARENT or conversations.keys().contains(p)
    })

  // §4.5: child cid must differ from parent.
  val forkHasFreshCid: bool =
    conversations.keys().forall(cid => {
      val c = conversations.get(cid)
      c.parentCid == NO_PARENT or c.cid != c.parentCid
    })

  // ===========================================================================
  // Witnesses — checked with quint run --witnesses=... (reachability, not safety)
  // ===========================================================================

  val witnessedEstablishment: bool = conversations.keys().size() > 0
  val witnessedExchange: bool = outcomeIsExchange(lastOutcome)
  val witnessedSuperseded: bool = outcomeIsSuperseded(lastOutcome)
  val witnessedFork: bool =
    conversations.keys().exists(cid => conversations.get(cid).parentCid != NO_PARENT)
  val witnessedRotation: bool =
    conversations.keys().exists(cid => conversations.get(cid).latestSeq > 1)
  val witnessedRejection: bool = outcomeIsRejected(lastOutcome)

  // ===========================================================================
  // Actions — guarded transitions (disabled when guard false, no silent no-op)
  // ===========================================================================

  action init: bool = all {
    now' = 0,
    nextCid' = 1,
    conversations' = Map(),
    retiredCids' = Set(),
    issuedSeqs' = Map(),
    lastOutcome' = Rejected,
  }

  // Advance wall clock for expiry and retention exploration.
  action tick: bool = all {
    now < MAX_TIME,
    now' = now + 1,
    nextCid' = nextCid,
    conversations' = conversations,
    retiredCids' = retiredCids,
    issuedSeqs' = issuedSeqs,
    lastOutcome' = lastOutcome,
  }

  // §4.1 establishment: client advertises extension, carries no handle, onMissing=new.
  action establish: bool = {
    nondet principal = PRINCIPALS.oneOf()
    val cid = nextCid
    val conv = freshConversation(cid, principal, NO_PARENT, now)
    val nextSeq = 1
    all {
      ON_MISSING == "new",
      not(retiredCids.contains(cid)),
      now' = now,
      nextCid' = nextCid + 1,
      conversations' = conversations.put(cid, applyMint(conv, nextSeq)),
      retiredCids' = retiredCids,
      issuedSeqs' = issuedSeqs.put(cid, Set(nextSeq)),
      lastOutcome' = Ok({ superseded: false, minted: true }),
    }
  }

  // Valid handle + state mutation → §4.2 MUST rotate (commitment changed) + mint seq+1.
  action mutateAndRotate: bool = {
    nondet cid = conversations.keys().oneOf()
    val conv = conversations.get(cid)
    val presented = mintHandle(conv, conv.latestSeq, now)
    val mutated = applyStateMutation(conv)
    val nextSeq = mutated.latestSeq + 1
    all {
      conv.latestSeq > 0,
      conv.stateCommit < MAX_STATE,
      not(isRetired(retiredCids, cid)),
      not(isExpired(presented, now)),
      shouldRotate(Presented({ handle: presented, fork: false }), presented, mutated, now),
      not(issuedSeqs.get(cid).contains(nextSeq)),
      now' = now,
      nextCid' = nextCid,
      conversations' = conversations.put(cid, applyMint(mutated, nextSeq)),
      retiredCids' = retiredCids,
      issuedSeqs' = issuedSeqs.set(cid, issuedSeqs.get(cid).union(Set(nextSeq))),
      lastOutcome' = Ok({ superseded: isSuperseded(presented, conv), minted: true }),
    }
  }

  // §4.2 discretionary path: valid handle, no rotation trigger, handler runs, no mint.
  action serveWithoutRotation: bool = {
    nondet cid = conversations.keys().oneOf()
    val conv = conversations.get(cid)
    val presented = {
      cid: cid,
      seq: conv.latestSeq,
      exp: now + HANDLE_LIFETIME,
      stateCommit: conv.stateCommit,
      forged: false,
    }
    all {
      conv.latestSeq > 0,
      not(isRetired(retiredCids, cid)),
      not(isExpired(presented, now)),
      not(shouldRotate(Presented({ handle: presented, fork: false }), presented, conv, now)),
      now' = now,
      nextCid' = nextCid,
      conversations' = conversations,
      retiredCids' = retiredCids,
      issuedSeqs' = issuedSeqs,
      lastOutcome' = Ok({ superseded: false, minted: false }),
    }
  }

  // §4.4 exchange: expired but authentic → mint fresh handle, do not serve request.
  action exchangeExpired: bool = {
    nondet cid = conversations.keys().oneOf()
    val conv = conversations.get(cid)
    val presented = {
      cid: cid,
      seq: conv.latestSeq,
      exp: now,                 // expired at presentation time
      stateCommit: conv.stateCommit,
      forged: false,
    }
    val nextSeq = conv.latestSeq + 1
    all {
      conv.latestSeq > 0,
      isExpired(presented, now),
      not(isRetired(retiredCids, cid)),
      not(issuedSeqs.get(cid).contains(nextSeq)),
      now' = now,
      nextCid' = nextCid,
      conversations' = conversations.put(cid, applyMint(conv, nextSeq)),
      retiredCids' = retiredCids,
      issuedSeqs' = issuedSeqs.set(cid, issuedSeqs.get(cid).union(Set(nextSeq))),
      lastOutcome' = ExchangeOnly,
    }
  }

  // §4.5 fork: fresh cid, record parent, mint seq=1 for child.
  action forkConversation: bool = {
    nondet parentCid = conversations.keys().oneOf()
    val parent = conversations.get(parentCid)
    val childCid = nextCid
    val child = freshConversation(childCid, parent.principal, parentCid, now)
    val nextSeq = 1
    all {
      parent.latestSeq > 0,
      not(isRetired(retiredCids, parentCid)),
      not(retiredCids.contains(childCid)),
      now' = now,
      nextCid' = nextCid + 1,
      conversations' = conversations.put(childCid, applyMint(child, nextSeq)),
      retiredCids' = retiredCids,
      issuedSeqs' = issuedSeqs.put(childCid, Set(nextSeq)),
      lastOutcome' = Ok({ superseded: false, minted: true }),
    }
  }

  // §2.2: reject modified / unissued handle (MAC failure abstracted).
  action rejectForged: bool = {
    nondet cid = conversations.keys().oneOf()
    val conv = conversations.get(cid)
    val forged = {
      cid: cid,
      seq: conv.latestSeq,
      exp: now + HANDLE_LIFETIME,
      stateCommit: conv.stateCommit,
      forged: true,
    }
    val outcome = resolvePresented(conversations, retiredCids, now, forged, conv.principal)
    all {
      outcomeIsRejected(outcome),
      now' = now,
      nextCid' = nextCid,
      conversations' = conversations,
      retiredCids' = retiredCids,
      issuedSeqs' = issuedSeqs,
      lastOutcome' = outcome,
    }
  }

  // §4.6: authentic handle for retired cid → reject (names nothing).
  action rejectRetired: bool = {
    nondet cid = retiredCids.oneOf()
    val conv = conversations.get(cid)
    val presented = mintHandle(conv, conv.latestSeq, now)
    val outcome = resolvePresented(conversations, retiredCids, now, presented, conv.principal)
    all {
      retiredCids.contains(cid),
      conversations.keys().contains(cid),
      outcomeIsRejected(outcome),
      now' = now,
      nextCid' = nextCid,
      conversations' = conversations,
      retiredCids' = retiredCids,
      issuedSeqs' = issuedSeqs,
      lastOutcome' = outcome,
    }
  }

  // §4.6: mark cid retired after conversationRetentionSeconds.
  action expireRetention: bool = {
    nondet cid = conversations.keys().oneOf()
    val conv = conversations.get(cid)
    all {
      not(retiredCids.contains(cid)),
      now >= conv.createdAt + RETENTION_SECONDS,
      now' = now,
      nextCid' = nextCid,
      conversations' = conversations,
      retiredCids' = retiredCids.union(Set(cid)),
      issuedSeqs' = issuedSeqs,
      lastOutcome' = lastOutcome,
    }
  }

  // §4.3: authentic unexpired handle with seq < latestSeq → Ok(superseded), not Rejected.
  // Models in-flight rotation: client still holds an older but valid handle.
  // Read-only path (e.g. memory_read): handler runs, no mint when rotation not required.
  action presentSupersededHandle: bool = {
    nondet cid = conversations.keys().oneOf()
    val conv = conversations.get(cid)
    val oldSeq = conv.latestSeq - 1
    val presented = {
      cid: cid,
      seq: oldSeq,
      exp: now + HANDLE_LIFETIME,
      stateCommit: conv.stateCommit,
      forged: false,
    }
    all {
      conv.latestSeq > 1,
      issuedSeqs.get(cid).contains(oldSeq),
      not(isRetired(retiredCids, cid)),
      not(isExpired(presented, now)),
      now' = now,
      nextCid' = nextCid,
      conversations' = conversations,
      retiredCids' = retiredCids,
      issuedSeqs' = issuedSeqs,
      lastOutcome' = Ok({ superseded: true, minted: false }),
    }
  }

  // §4.3 + §4.2: stale handle + handler mutation → serve, rotate, mint (executePlan path).
  // Mirrors conformance/e2e/supersession.test.ts: stale handle + memory_append.
  // Matches src/execution.ts: handler runs with superseded=true, then shouldRotateHandle
  // compares active.decoded (stale commitment) against post-mutation record.
  action presentSupersededAndMutate: bool = {
    nondet cid = conversations.keys().oneOf()
    val conv = conversations.get(cid)
    val oldSeq = conv.latestSeq - 1
    // Stale handle carries an older state commitment (issued at previous seq).
    val staleCommit = if (conv.stateCommit > 0) conv.stateCommit - 1 else 0
    val presented = {
      cid: cid,
      seq: oldSeq,
      exp: now + HANDLE_LIFETIME,
      stateCommit: staleCommit,
      forged: false,
    }
    val mutated = applyStateMutation(conv)
    val nextSeq = mutated.latestSeq + 1
    all {
      conv.latestSeq > 1,
      issuedSeqs.get(cid).contains(oldSeq),
      not(isRetired(retiredCids, cid)),
      not(isExpired(presented, now)),
      isSuperseded(presented, conv),
      conv.stateCommit < MAX_STATE,
      shouldRotate(Presented({ handle: presented, fork: false }), presented, mutated, now),
      not(issuedSeqs.get(cid).contains(nextSeq)),
      now' = now,
      nextCid' = nextCid,
      conversations' = conversations.put(cid, applyMint(mutated, nextSeq)),
      retiredCids' = retiredCids,
      issuedSeqs' = issuedSeqs.set(cid, issuedSeqs.get(cid).union(Set(nextSeq))),
      lastOutcome' = Ok({ superseded: true, minted: true }),
    }
  }

  action step: bool = any {
    establish,
    mutateAndRotate,
    serveWithoutRotation,
    presentSupersededHandle,
    presentSupersededAndMutate,
    exchangeExpired,
    forkConversation,
    rejectForged,
    rejectRetired,
    expireRetention,
    tick,
  }
}

// Runnable instance for quint run / CI (small bounds → fast simulation).
module lifecycle_small {
  import lifecycle(
    HANDLE_LIFETIME = 10,
    RETENTION_SECONDS = 50,
    ON_MISSING = "new",
    MAX_TIME = 30,
    MAX_STATE = 5,
  ).*
}

// =============================================================================
// Client seq merge (§4.2)
// =============================================================================

module client {
  const MAX_SEQ: int

  type Principal = str
  type Cid = int

  // Mirrors ConversationHandleClient session state (src/client.ts).
  type ClientSession = {
    cid: Cid,
    highestSeq: int,           // §4.2 advisory seq mirror for ordering only
  }

  pure val PRINCIPALS: Set[Principal] = Set("alice", "bob")

  var sessions: Principal -> ClientSession
  var lastAccepted: bool

  // §4.2: accept when seq >= stored highest (concurrent response merge).
  pure def canAccept(session: ClientSession, seq: int): bool = seq >= session.highestSeq

  pure def applyAccept(session: ClientSession, cid: Cid, seq: int): ClientSession = {
    cid: cid,
    highestSeq: seq,
  }

  val clientMonotonic: bool = monotonicPerPrincipal(sessions)

  pure def monotonicPerPrincipal(sessions: Principal -> ClientSession): bool =
    sessions.keys().forall(p => sessions.get(p).highestSeq >= 0)

  val witnessedAccept: bool = lastAccepted

  action init: bool = all {
    sessions' = PRINCIPALS.mapBy(_ => { cid: 0, highestSeq: 0 }),
    lastAccepted' = false,
  }

  // acceptResponseMeta: store handle when advisory seq is not lower than highest.
  action acceptResponse: bool = {
    nondet principal = PRINCIPALS.oneOf()
    nondet cid = 1.to(3).oneOf()
    nondet seq = 0.to(MAX_SEQ).oneOf()
    val session = sessions.get(principal)
    all {
      canAccept(session, seq),
      sessions' = sessions.set(principal, applyAccept(session, cid, seq)),
      lastAccepted' = true,
    }
  }

  // §4.2 SHOULD discard lower-seq responses (out-of-order concurrent delivery).
  action rejectStale: bool = {
    nondet principal = PRINCIPALS.oneOf()
    nondet seq = 0.to(MAX_SEQ).oneOf()
    val session = sessions.get(principal)
    all {
      seq < session.highestSeq,
      sessions' = sessions,
      lastAccepted' = false,
    }
  }

  action step: bool = any {
    acceptResponse,
    rejectStale,
  }
}

module client_small {
  import client(MAX_SEQ = 10).*
}
