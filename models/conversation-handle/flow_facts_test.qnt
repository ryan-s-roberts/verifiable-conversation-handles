// Scenario tests for multi-label FlowFacts × LWW (two-phase egress).
//
//   quint test models/conversation-handle/flow_facts_test.qnt --main=flow_facts_tests

module flow_facts_tests {
  import flow_facts(MAX_SEQ = 8).* from "./flow_facts"

  run parallelDistinctMarksJournalIsJoinTest = {
    init
      .then(markAndMint)
      .then(markAndMint)
      .then(acceptLww)
      .then(acceptLww)
      .expect(server.latestSeq == 2)
      .expect(client.seq >= 1)
      .expect(clientMonotonicSeq)
      .expect(clientCommitIsSnapshot)
  }

  run sanitizeResidualStillBlocksTest = {
    init
      .then(all {
        server' = {
          journal: Set("pii", "credentials"),
          principal: Set("pii", "credentials"),
          latestSeq: 0,
          snapshots: Map(),
        },
        client' = emptyClient,
        pending' = Idle,
        lastEgress' = None,
        sawDisagreement' = false,
      })
      .then(clearAndMint)
      .then(egressAtomic)
      .expect(match lastEgress {
        | Done(o) => o.blockedByJournal
        | None => false
      })
      .expect(egressOutcomeConsistent)
  }

  run sanitizeReopensEgressTest = {
    init
      .then(all {
        server' = {
          journal: Set("credentials"),
          principal: Set("credentials"),
          latestSeq: 0,
          snapshots: Map(),
        },
        client' = emptyClient,
        pending' = Idle,
        lastEgress' = None,
        sawDisagreement' = false,
      })
      .then(clearAndMint)
      .then(egressAtomic)
      .expect(match lastEgress {
        | Done(o) => not(o.blockedByJournal)
        | None => false
      })
      .expect(not(hasForbidden(authority(server))))
      .expect(egressOutcomeConsistent)
  }

  run lwwStaleCannotRollBackJournalTest = {
    init
      .then(markAndMint)
      .then(acceptLww)
      .then(markAndMint)
      .then(acceptLww)
      .then(rejectStale)
      .then(egressAtomic)
      .expect(clientMonotonicSeq)
      .expect(clientCommitIsSnapshot)
      .expect(egressOutcomeConsistent)
  }

  /// Two-phase TOCTOU: clean beginEgress → mark in window → finishMint disagrees.
  run toctouBeginEgressThenMarkTest = {
    init
      .then(beginEgress)
      .then(mutateWhilePending)
      .then(finishMint)
      .expect(sawDisagreement)
      .expect(match lastEgress {
        | Done(o) => o.handlerAllowed and o.blockedByJournal
        | None => false
      })
      .expect(egressOutcomeConsistent)
      .expect(pending == Idle)
  }

  /// Atomic egress on clean journal: allowed, no disagreement required.
  run atomicCleanEgressTest = {
    init
      .then(egressAtomic)
      .expect(match lastEgress {
        | Done(o) => o.handlerAllowed and not(o.blockedByJournal)
        | None => false
      })
      .expect(egressOutcomeConsistent)
  }
}
