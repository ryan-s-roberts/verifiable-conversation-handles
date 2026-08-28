// Multi-label FlowFacts × conversation-handle LWW
// Plasm-shaped journal (join + clear) against opaque commitment LWW.
// Egress is two-phase: beginEgress (handler check) → finishMint (commitment snapshot),
// with mutateWhilePending modeling TOCTOU between the phases.
//
// TypeScript: src/fixtures/ifc-tools.ts, conformance/ifc-e2e.test.ts
//
// Run:
//   quint typecheck models/conversation-handle/flow_facts.qnt
//   quint test models/conversation-handle/flow_facts_test.qnt --main=flow_facts_tests
//   quint run models/conversation-handle/flow_facts.qnt --main=flow_facts_small \
//     --invariant='clientMonotonicSeq and clientCommitIsSnapshot' --max-steps=20 --n-traces=200

module flow_facts {
  const MAX_SEQ: int

  type Label = str

  pure val ALL_LABELS: Set[Label] = Set("pii", "credentials", "untrusted")
  /// Confidentiality labels that block the egress sink (integrity `untrusted` does not).
  pure val FORBIDDEN: Set[Label] = Set("pii", "credentials")

  type Server = {
    journal: Set[Label],
    principal: Set[Label],
    latestSeq: int,
    snapshots: int -> Set[Label],
  }

  type Client = {
    seq: int,
    commit: Set[Label],
  }

  type EgressPending =
    | Idle
    | Pending({ handlerAllowed: bool })

  type EgressOutcome =
    | None
    | Done({
        handlerAllowed: bool,
        blockedByJournal: bool,
        commitmentWouldBlock: bool,
      })

  var server: Server
  var client: Client
  var pending: EgressPending
  var lastEgress: EgressOutcome
  var sawDisagreement: bool

  pure def emptyServer: Server = {
    journal: Set(),
    principal: Set(),
    latestSeq: 0,
    snapshots: Map(),
  }

  pure def emptyClient: Client = { seq: 0, commit: Set() }

  pure def hasForbidden(labels: Set[Label]): bool =
    labels.intersect(FORBIDDEN).size() > 0

  pure def authority(s: Server): Set[Label] =
    s.journal.union(s.principal)

  pure def canAccept(curSeq: int, seq: int): bool =
    seq >= curSeq

  pure def mint(s: Server, headLabels: Set[Label]): Server = {
    journal: s.journal,
    principal: s.principal,
    latestSeq: s.latestSeq + 1,
    snapshots: s.snapshots.put(s.latestSeq + 1, headLabels),
  }

  pure def joinLabel(s: Server, label: Label): Server = {
    journal: s.journal.union(Set(label)),
    principal: s.principal.union(Set(label)),
    latestSeq: s.latestSeq,
    snapshots: s.snapshots,
  }

  pure def excludeLabel(s: Server, label: Label): Server = {
    journal: s.journal.exclude(Set(label)),
    principal: s.principal.exclude(Set(label)),
    latestSeq: s.latestSeq,
    snapshots: s.snapshots,
  }

  val clientMonotonicSeq: bool =
    client.seq <= server.latestSeq and client.seq >= 0

  val clientCommitIsSnapshot: bool =
    if (client.seq == 0) {
      client.commit == Set()
    } else {
      server.snapshots.keys().contains(client.seq) and
        client.commit == server.snapshots.get(client.seq)
    }

  /// finishMint records handler-at-begin vs journal-at-mint; disagreement is witnessed.
  val egressOutcomeConsistent: bool =
    match lastEgress {
      | None => true
      | Done(o) =>
          (o.handlerAllowed == not(o.blockedByJournal)) or sawDisagreement
    }

  val witnessedMark: bool = server.journal.size() > 0 or server.principal.size() > 0
  val witnessedDisagreement: bool = sawDisagreement
  val witnessedPending: bool = pending != Idle

  action init: bool = all {
    server' = emptyServer,
    client' = emptyClient,
    pending' = Idle,
    lastEgress' = None,
    sawDisagreement' = false,
  }

  /// Scenario seed: set journal+principal without minting.
  action seed: bool = {
    nondet labels = FORBIDDEN.powerset().oneOf()
    all {
      pending == Idle,
      server' = {
        journal: labels,
        principal: labels,
        latestSeq: server.latestSeq,
        snapshots: server.snapshots,
      },
      client' = client,
      pending' = pending,
      lastEgress' = lastEgress,
      sawDisagreement' = sawDisagreement,
    }
  }

  /// Join a label and mint (mark tool).
  action markAndMint: bool = {
    nondet label = ALL_LABELS.oneOf()
    val nxt = joinLabel(server, label)
    all {
      pending == Idle,
      server.latestSeq + 1 <= MAX_SEQ,
      server' = mint(nxt, nxt.journal),
      client' = client,
      pending' = pending,
      lastEgress' = lastEgress,
      sawDisagreement' = sawDisagreement,
    }
  }

  /// Clear a forbidden label and mint (sanitizer tool).
  action clearAndMint: bool = {
    nondet label = FORBIDDEN.oneOf()
    val nxt = excludeLabel(server, label)
    all {
      pending == Idle,
      server.latestSeq + 1 <= MAX_SEQ,
      label.in(authority(server)),
      server' = mint(nxt, nxt.journal),
      client' = client,
      pending' = pending,
      lastEgress' = lastEgress,
      sawDisagreement' = sawDisagreement,
    }
  }

  /// Phase 1: egress policy check (handler decision) against current journal.
  action beginEgress: bool = all {
    pending == Idle,
    pending' = Pending({ handlerAllowed: not(hasForbidden(authority(server))) }),
    server' = server,
    client' = client,
    lastEgress' = lastEgress,
    sawDisagreement' = sawDisagreement,
  }

  /// Sibling mutation in the TOCTOU window between beginEgress and finishMint.
  action mutateWhilePending: bool = {
    nondet label = FORBIDDEN.oneOf()
    val nxt = joinLabel(server, label)
    all {
      pending != Idle,
      server.latestSeq + 1 <= MAX_SEQ,
      server' = mint(nxt, nxt.journal),
      client' = client,
      pending' = pending,
      lastEgress' = lastEgress,
      sawDisagreement' = true,
    }
  }

  /// Phase 2: mint commitment from current journal; compare to beginEgress decision.
  action finishMint: bool = {
    nondet handlerAllowed = Set(true, false).oneOf()
    val blockedNow = hasForbidden(authority(server))
    val disagree =
      (handlerAllowed != not(blockedNow)) or
      (blockedNow != hasForbidden(client.commit))
    all {
      pending == Pending({ handlerAllowed: handlerAllowed }),
      server.latestSeq + 1 <= MAX_SEQ,
      server' = mint(server, server.journal),
      client' = client,
      pending' = Idle,
      lastEgress' = Done({
        handlerAllowed: handlerAllowed,
        blockedByJournal: blockedNow,
        commitmentWouldBlock: hasForbidden(client.commit),
      }),
      sawDisagreement' = sawDisagreement or disagree,
    }
  }

  /// Atomic egress (no interleaving): begin+finish in one step.
  action egressAtomic: bool = {
    val blockedNow = hasForbidden(authority(server))
    val commitBlocks = hasForbidden(client.commit)
    all {
      pending == Idle,
      server.latestSeq + 1 <= MAX_SEQ,
      server' = mint(server, server.journal),
      client' = client,
      pending' = Idle,
      lastEgress' = Done({
        handlerAllowed: not(blockedNow),
        blockedByJournal: blockedNow,
        commitmentWouldBlock: commitBlocks,
      }),
      sawDisagreement' = sawDisagreement or (blockedNow != commitBlocks),
    }
  }

  action acceptLww: bool = {
    nondet seq = 1.to(MAX_SEQ).oneOf()
    val commitLabels = server.snapshots.get(seq)
    val disagree = hasForbidden(commitLabels) != hasForbidden(authority(server))
    all {
      server.snapshots.keys().contains(seq),
      canAccept(client.seq, seq),
      client' = { seq: seq, commit: commitLabels },
      server' = server,
      pending' = pending,
      lastEgress' = lastEgress,
      sawDisagreement' = sawDisagreement or disagree,
    }
  }

  action rejectStale: bool = {
    nondet seq = 0.to(MAX_SEQ).oneOf()
    all {
      seq < client.seq,
      server' = server,
      client' = client,
      pending' = pending,
      lastEgress' = lastEgress,
      sawDisagreement' = sawDisagreement,
    }
  }

  action step: bool = any {
    markAndMint,
    clearAndMint,
    beginEgress,
    mutateWhilePending,
    finishMint,
    egressAtomic,
    acceptLww,
    rejectStale,
    seed,
  }
}

module flow_facts_small {
  import flow_facts(MAX_SEQ = 8).*
}
