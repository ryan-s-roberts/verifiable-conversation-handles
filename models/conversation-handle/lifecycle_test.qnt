// Scenario tests for the conversation-handle Quint model.
//
// Run:
//   quint test lifecycle_test.qnt --main=lifecycle_tests
//   quint test lifecycle_test.qnt --main=client_tests
//
// Names must end in "Test" or quint test silently skips them.
// Full spec mapping: models/conversation-handle/README.md

// =============================================================================
// Server lifecycle scenarios (§4)
// =============================================================================

module lifecycle_tests {
  import lifecycle(
    HANDLE_LIFETIME = 10,
    RETENTION_SECONDS = 50,
    ON_MISSING = "new",
    MAX_TIME = 30,
    MAX_STATE = 5,
  ).* from "./lifecycle"

  // §4.1 establishment + §2.2 first seq: missing handle → new cid, seq=1, minted.
  run establishmentMintIncreasesSeqTest = {
    init
      .then(establish)
      .expect(conversations.keys().size() == 1)
      .expect(conversations.get(1).latestSeq == 1)
      .expect(issuedSeqs.get(1) == Set(1))
      .expect(outcomeMinted(lastOutcome))
  }

  // §4.4 exchange: expired authentic handle returns ExchangeOnly (no serve).
  run exchangeDoesNotServeTest = {
    init
      .then(establish)
      .then(exchangeExpired)
      .expect(lastOutcome == ExchangeOnly)
  }

  // §4.3 supersession detectable only (read path, no mint).
  run supersededDetectableTest = {
    init
      .then(establish)
      .then(mutateAndRotate)           // latestSeq becomes 2
      .then(presentSupersededHandle)   // present seq=1, no handler mutation
      .expect(outcomeIsSuperseded(lastOutcome))
  }

  // §4.3 + §4.2: stale handle + mutation → superseded + mint (supersession e2e append path).
  run supersededMutateAndRotateTest = {
    init
      .then(establish)
      .then(mutateAndRotate)              // latestSeq=2, stateCommit=1
      .then(presentSupersededAndMutate)   // stale seq=1, mutate, rotate
      .expect(outcomeIsSuperseded(lastOutcome))
      .expect(outcomeMinted(lastOutcome))
      .expect(conversations.get(1).latestSeq == 3)
  }

  // §2.2 authenticity: forged handle → Rejected.
  run forgedHandleRejectedTest = {
    init
      .then(establish)
      .then(rejectForged)
      .expect(outcomeIsRejected(lastOutcome))
  }
}

// =============================================================================
// Client seq merge (§4.2)
// =============================================================================

module client_tests {
  import client(MAX_SEQ = 10).* from "./lifecycle"

  // §4.2: accepting a response with seq >= highestSeq preserves monotonic ordering.
  run acceptMonotonicSeqTest = {
    init
      .then(acceptResponse)
      .expect(witnessedAccept)
      .expect(clientMonotonic)
  }
}
