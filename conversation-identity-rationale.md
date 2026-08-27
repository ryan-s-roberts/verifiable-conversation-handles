# Verifiable Conversation Handles — Rationale, Threat Model, and Known Weaknesses

Companion to `0000-verifiable-conversation-handles.md`, covering the threat model, the design reasoning,
and the known weaknesses of the proposal. §6 states the objections the design is most exposed to.

Information-flow control appears in §5 as one consumer among several. It is the consumer with the
most demanding requirements and therefore the sharpest test of the primitive. Nothing in §5 is a
dependency of the design, and the normative text specifies nothing about labels or information
flow.

---

## 1. What the primitive is

A conversation handle is a compact string that a server mints, MACs with its own key, and hands back
to the client in `_meta`. The client returns it verbatim on the next request. It carries:

- a conversation identifier (`cid`), unguessable and stable;
- an expiry;
- a strictly increasing sequence number;
- an opaque, server-defined state commitment.

It carries no principal, no capability, and no policy. It is not an authorization credential.

That is the whole thing. The value is not in any one property but in the combination being
*guaranteed by the protocol* rather than reinvented per vendor.

---

## 2. Threat model

### 2.1 Trust boundaries

| Component | Trusted? | Notes |
| --------- | -------- | ----- |
| Issuing server + its MAC key | **Yes** | The TCB. Key compromise allows forging any `cid`. |
| Authorization layer | **Yes** | Assumed sound. The extension consumes nothing from it and duplicates nothing in it. |
| Transport (TLS) | **Yes** | Assumed authenticated and confidential. |
| Host application / client `_meta` construction | **Yes, reluctantly** | §6.2 — this is where trust actually lands. |
| **The model** | **No** | Assumed adversary-controlled at any turn via indirect prompt injection. |
| Tool results, fetched pages, retrieved memory, sub-agent output | **No** | Untrusted data and the injection vector. |

The single structural claim is that the *model* and the *host* are different components with
different trust levels, and that routing conversation identity through model output conflates them.
Everything else follows from separating them.

### 2.2 Adversary capabilities

From the moment injection lands, the adversary controls model output completely. They can emit any
tool call with any arguments; emit, withhold, or alter any string the model is expected to thread
forward; read everything in the context window; and persist attacker-chosen content into any memory
the agent can write.

They cannot forge a MAC, alter `_meta` the host constructs, read server-side state directly, or
authenticate as a principal they do not hold.

### 2.3 The concrete failure the primitive removes

Take a memory server, the least security-flavoured consumer. Today:

```
Turn 1  model calls memory_store(key="proj-alpha", value=...)
Turn 9  model calls memory_retrieve(key="proj-beta")
```

Nothing distinguishes a legitimate cross-project read from a mistake or an injected instruction. The
key is model output, so the model chooses the scope. The server cannot tell whether `proj-beta` is a
conversation it minted, whether the caller has any business with it, or whether the value it is
about to return belongs to this conversation at all.

With the extension the scope is `cid`, which arrives in `_meta` and which the model never sees a
reason to choose. Cross-conversation access becomes an explicit fork or an explicit server-side
sharing decision, rather than a string the model happened to emit.

This is the same defect that matters acutely for IFC (§5) and mildly for caching, and it is the same
fix in all cases.

---

## 3. Why existing mechanisms do not solve it

### 3.1 The five in-the-wild mechanisms

Foundry's `x-memory-user-id` header, mem0's scope tags, LangGraph's `thread_id`, OpenAI's
`previous_response_id`, and the caller-chosen keys of MCP memory servers are all the same shape: **an identifier the caller supplies and the server
takes on trust.**

Each works inside a deployment that controls its callers. None survives an open ecosystem, and none
gives the server ordering — no mechanism in that list lets a server tell whether the identifier it
just received is the newest one it issued. That is not an oversight; it is simply not expressible
when the identifier is a caller-chosen opaque string.

Foundry deserves specific credit because it is the most rigorous of the five: identity is a header
rather than a model-visible parameter, which is the same instinct as `_meta` carriage. The reason it
is a *private* header is that there was no protocol slot for it.

### 3.2 SEP-2567 explicit handles

Correct for their stated purpose and this SEP endorses them for it. Two gaps for conversation state:

*The handle is model output.* SEP-2567 is explicit that a handle is "a string in a tool result and a
string in a tool argument, indistinguishable from any other tool data." That indistinguishability is
a feature for baskets — the model *should* choose which basket — and a defect for conversation
scope, where the model choosing is the problem.

*There is no ordering.* Even a perfectly generated 128-bit handle validated against auth context has
no notion of version. An old handle and a new handle for the same conversation are the same string,
so there is nothing to compare and supersession is undetectable in principle, not merely
unimplemented.

SEP-2567's guidance to "validate `(handle, auth_context)` on every call" is good and this SEP keeps
it as a MUST (§2.3 of the spec). It answers *is this caller entitled to this handle?* It does not
answer *is this the current handle?* or *did the server issue this at all, without asking storage?*

### 3.3 SEP-1359 protocol-level sessions

Set aside that it was not adopted: it would not have delivered this. A session id is a bearer string
naming a scope, with no ordering and no self-describing validity. Reinstating sessions would leave
supersession undetectable and would reintroduce exactly the affinity problem SEP-2567 removed.

This matters for how the SEP should be read. It is not a stealth reintroduction of SEP-1359. The
mechanisms doing the work — the MAC and the sequence number — are orthogonal to whether sessions
exist, and would be needed in a session-bearing protocol too.

### 3.4 OAuth access tokens

Bound to a principal, integrity-protected, expiring — three of four properties. It fails on
granularity, fatally: one principal runs many concurrent conversations, so keying conversation state
on the access token merges all of them. The whole reason a *conversation* identity is needed is that
the principal is too coarse and the request too fine.

### 3.5 MRTR `requestState`

Correct shape, wrong scope. The Equixly analysis correctly identifies it as attacker-controlled input
requiring integrity protection and expiry, and that prescription is reused here. What it cannot do is
span turns; its lifetime is one request's round-trip cycle.

### 3.6 The Tasks extension

Task handles name a unit of asynchronous work, not a conversation. The mapping is many-to-many, the
handles are model-threaded, and lifetime is governed by work completion rather than conversation
continuity.

### 3.7 Roadmap work: DPoP and Workload Identity Federation

Complementary, and the SEP is deliberately a consumer rather than a competitor — it now carries no
identity at all, so there is nothing to conflict. That work answers *which principal is acting*,
including the hard cases of an absent user and delegation to sub-agents. None of it determines *which
conversation an act belongs to*.

---

## 4. The design decisions that carry the proposal

**Carriage in `_meta`, not tool arguments.** Removes the model from the choice of conversation.
Without this, everything else is defeated by the model choosing a different handle. It also makes the
handle independent of the transcript: SEP-2567's handles are prompt content and can be summarised
away, whereas a handle the client holds and attaches per request is untouched by context compaction.
SEP-2567 treats transcript residence as a resumption feature — handles persist because chats persist
— but the same property is what makes them fragile. `_meta` carriage separates the two, so
persistence becomes deliberate rather than incidental.

**A MAC rather than a random string plus a lookup table.** Both are unforgeable; only the MAC is
verifiable without storage. A random-handle design recreates, at the application layer, precisely the
affinity problem SEP-2567 removed at the transport layer — and SEP-2567 documents that the reference
TypeScript SDK "provides no public API for reconstructing a session on a different node." Proposing a
design with that property would be proposing something already rejected.

The honest boundary: the MAC makes *validity* stateless, not everything. Conversation state lives on
the server by definition; supersession detection reads the conversation record (though it adds no
round-trip, since the server loads that record anyway); and revocation genuinely regresses, because a
denylist must be consulted on every request. The specification's answer is short lifetimes plus rotation
rather than pretending revocation is free.

**A monotonic sequence, with detection normative and policy not.** Ordering is the property no
consumer can recover alone, which makes it a protocol concern. What to *do* about supersession
differs irreconcilably between a memory store (serve the snapshot) and an IFC runtime (ignore the
snapshot, apply current state). Specifying either would make the extension wrong for most of its
constituency.

**No principal in the payload.** Discussed at length in the SEP's Rationale. In short: layering
(the auth layer is already authoritative, and a second authority can disagree), delegation (a
sub-agent may legitimately authenticate as a different workload identity), privacy (a stable per-user
value in a durable string is a cross-conversation correlator), and simplicity. The cost is that the
cross-principal check becomes a server obligation rather than a structural property; §6.1 treats
this as the most serious objection to the current design.

---

## 5. IFC as a worked consumer, and its own problems

This section concerns a consumer's implementation problem, not the specification's. The IFC consumer
exercises the primitive more heavily than any other, which makes its constraints a useful test of
whether the primitive is sufficient.

### 5.1 What IFC needs from the primitive

An IFC runtime accumulates security labels across turns and refuses flows from labelled data into
guarded sinks. Soundness requires labels to be bound to something the adversary cannot choose. Under
indirect prompt injection the model is the adversary, so a model-threaded handle is unsound: the
model presents a fresh handle and the accumulated taint vanishes.

NeuroTaint (Cai et al., arXiv:2604.23374) names this as **Asynchronous Provenance Reuse**
(Definition 6) and observes it "breaks execution-trace continuity across sessions." Their system is
"a provenance-oriented **offline** auditor for completed trajectories" — the right analysis in the
wrong position, since by the time the audit runs the credential has been published.

The primitive gives the runtime three things: a `cid` the model cannot choose (`_meta` carriage), a
MAC that makes a fabricated handle detectable without a lookup, and a sequence number that makes a
replayed handle detectable. On that foundation the runtime can key a label journal, put its head in
the state commitment, and — under its own supersession policy — apply current labels rather than the
ones an old handle names.

### 5.2 Label creep — the consumer's problem, not the protocol's

**The objection:** monotone conversation-scoped labels converge to "everything tainted, nothing
permitted." Any agent that browses the web is `untrusted` within a turn or two; thereafter every
guarded write is denied or escalated, and the agent becomes useless in exactly the long-horizon
workflows that motivate agents.

**Why it is hard:** an LLM context window merges everything in it. A runtime that plans in a typed
intermediate representation can achieve field-level granularity *within* a single plan, because the
plan is a structure it can analyse. Across turns the connecting medium is the model's context, whose
transfer function is join-everything. There is no sound way to track sub-context granularity through
a component IFC cannot analyse.

**Partial mitigations:** keep the lattice narrow (two or three high-severity labels, few guarded
sinks, so most actions are unaffected); sound declassification via sanitizers with out-of-band
clearance, or explicit human approval; forking to bound future propagation. None is a solution.

**Why this does not bear on the extension.** Label creep is a property of a label lattice, not of
conversation identity. If it makes conversation-granularity IFC impractical, the IFC consumer is
impractical; the conversation handle remains equally useful to memory, caching, resumption, metering,
and audit. The extension specifies no labels, so nothing in the specification depends on the answer.

The strongest alternative for an IFC consumer is CaMeL-style structural separation
(arXiv:2503.18813) — keeping untrusted data out of the privileged path rather than labelling it — and
the best design is probably CaMeL-style separation within a turn plus verifiable conversation
identity across turns.

---

## 6. Weaknesses a reviewer will attack

### 6.1 Dropping the principal from the handle weakens the leaked-handle case

**The attack on the proposal:** a handle with no principal claim is, cryptographically, a bearer
token for the conversation it names. Anyone who obtains one presents something that verifies. The
only thing standing between a leaked handle and conversation hijack is a server-side check the spec
mandates (§2.3) but the credential does not enforce.

**Why this is serious.** This exact check is missed in practice, repeatedly. SEP-2567 itself
documents the reference Python SDK routing by `Mcp-Session-Id` alone "without verifying that the
authenticated identity on the request matches the one that created the session, so a leaked session
ID allows hijack by any other authenticated principal." A check that a reference SDK omits is a check
other implementations will omit.

**Why the decision stands.** A principal claim in the payload carries four costs: it creates a second
authority for a fact the auth layer already
owns, and the two can disagree after an account merge or subject-format change; it breaks legitimate
delegation, where a sub-agent authenticates as a different workload identity — the exact case the
roadmap's WIF and ID-JAG work exists to serve; it embeds a stable cross-conversation user correlator
into a string that persists in transcripts indefinitely, even when pseudonymous; and it adds a key,
a derivation, and a rotation concern to every implementation.

**What the specification does instead.** §2.3 makes the association check a MUST rather than
guidance; §"Security Implications" identifies it as the highest-risk requirement in the document;
the conformance targets include it; and SDKs are directed to make the check difficult to skip rather
than leaving it to each server author.

This is a trade, not a free choice. The design weighs layering, delegation, and privacy above a
structural guarantee. An assessment that weighs bearer-handle risk higher would reach the opposite
conclusion, and this is the design decision most open to revision.

A middle path exists and the SEP does not take it: bind the handle to a proof-of-possession key
(§5.2) rather than to an identity. That defeats pure bearer replay without embedding a correlator or
duplicating the auth layer. It is left as OPTIONAL only because the DPoP work it depends on has not
landed.

### 6.2 The trust merely moves to the host

`_meta` is constructed by the host. A compromised host attaches whatever handle it likes. So the
proposal relocates the trusted-component problem from the model to the host rather than eliminating
it.

This is a substantial improvement rather than an equivalence: the model is compromised routinely, by
design, by any web page it reads, whereas host compromise is a conventional supply-chain event with
conventional defences. It remains a relocation, and the specification claims no more than that. Residual risk concentrates in hosts that render `_meta` into model context or let
model output influence `_meta` construction. Neither is prohibited by the core protocol and neither is
detectable by the server.

### 6.3 "This is sessions with extra steps"

The comparison table in the SEP answers this on mechanics — no connection binding, no cardinality of
one, addressable, forkable, no affinity, no effect on list caching. The objection will nonetheless be
made on impression rather than mechanics, and the SEP will be judged partly on whether it reads as
relitigating SEP-1359.

The strongest factual rebuttal is §3.3: sessions would not have solved this, because they have no
ordering and no self-describing validity. A reviewer who follows that will not confuse the two.

### 6.4 Server-side state contradicts the point of SEP-2567

Partially conceded, and the SEP says where. The rebuttal — that SEP-2567's own `create_basket()`
pattern requires exactly this much server-side state, and that the objection was to *sessions*
(undefined lifetime, connection cardinality, list-cache invalidation) rather than to *databases* — is
correct and sufficient.

The genuinely weak spot is revocation, where the MAC design is worse than a lookup design and the
SEP's answer is "keep lifetimes short and don't need revocation." A deployment with a hard
requirement to kill a specific handle immediately gets no help, and a reviewer with that requirement
will notice.

### 6.5 Adoption: reference implementation exists

**A TypeScript reference implementation exists** in this repository
([verifiable-conversation-handles](https://github.com/ryan-s-roberts/verifiable-conversation-handles)),
including the client half (§4.2), conformance-style e2e tests, an IFC worked-example fixture, and a
Quint formal model. It covers handle construction (§6.2), server mint/rotate/verify/exchange
(§§4.1–4.4), capability advertisement (§1), and opaque per-conversation client persistence — the
full scope the SEP's Reference Implementation section requires.

Extensions Track process still requires landing an equivalent in an official SDK
(`modelcontextprotocol/typescript-sdk`) before formal review, and an associated Working or Interest
Group to sponsor the proposal. The remaining gaps are process, not design: raise the proposal in an
existing group or GitHub Discussions, seek a SEP sponsor, open the conformance scenario upstream,
and incubate as `experimental-ext-*` if useful.

The constituency is favourable. "Agent memory needs stable conversation identity" has a larger
natural audience than any security framing, and the five in-the-wild mechanisms in §3.1 are potential
allies rather than an audience that must first be convinced the problem exists.

### 6.6 Complexity relative to demonstrated demand

A maintainer applying the SEP-2084 standard — "adding a capability is effectively permanent" — will
ask why a private convention per server is not sufficient. The answer is the four incompatible
mechanisms and the fact that none of them is verifiable or ordered. This remains an argument from
principle rather than from a queue of people asking MCP for this specific mechanism.

---

## 7. Open questions

**7.1 Is proof-of-possession the right answer to §6.1, and can it land in time?** Binding to a DPoP
key defeats bearer replay without any of the costs of a principal claim, and would resolve the
proposal's weakest point. It depends on roadmap work outside the scope of this extension. If DPoP
lands, §5.2 should become a SHOULD or a MUST for servers holding sensitive conversation state.

**7.2 Multi-server conversations.** A conversation typically spans several MCP servers, each minting
its own `cid`. There is no notion of "the same conversation" across servers, and the extension does
not create one — deliberately, since the alternative is a cross-server identifier that some party
must be authoritative for, which is a much larger proposal. The practical consequence is that a
client holds N handles for what a user calls one conversation. This is the correct behaviour and a
likely source of confusion.

**7.3 Client-side persistence.** SEP-2567 notes its handles can be lost to context compaction,
because there the handle is a string in a tool result and a string in a tool argument — it lives in
the transcript, and compaction operates on the transcript. That failure mode does not apply here.
The handle is carried in `params._meta` (§5.1) and selected by the client from handles it has
received (§4.2); it is client state, not prompt content, and an operation that discards messages from
a model's context window cannot reach it.

The residual concern is different and narrower: the client MUST durably persist the handle across
its own restarts, and the extension cannot compel it to. A client that loses its handle store starts
a new conversation — exchange (§4.4) does not help, since exchange requires presenting the expired
handle. This is the same persistence obligation SEP-2567 places on clients, relocated from
"persist the transcript" to "persist one string per conversation", which is a smaller and more
explicit requirement but still one the extension can only state, not enforce.

**7.4 Retention versus ergonomics.** A conversation resumed after `conversationRetentionSeconds` gets
a new `cid` — correct, but hostile if a user returns after months and finds the agent has forgotten
them. Longer retention costs storage and extends the window in which a leaked handle is useful.
Specified safely; ergonomics unsolved.

**7.5 Should the state commitment have a size cap in the spec?** Currently a SHOULD plus the client's
`maxHandleBytes`. Servers will be tempted to put real state there, and the failure mode — handles
growing until they crowd out model context — is gradual and easy to miss. A hard cap would be
cleaner but arbitrary.

---

## 8. Conditions that would change the design

- **Evidence that bearer-handle risk dominates.** If leaked handles are the primary threat and
  server-side association checks cannot be relied on, the principal claim should return despite its
  costs, or proof-of-possession should become required rather than optional. See §6.1.
- **Evidence that supersession never occurs in practice.** If, instrumented across real traffic,
  clients essentially always present the newest handle, the sequence number is solving a theoretical
  problem and the extension could shrink to MAC plus expiry. This is directly measurable and should
  be measured before submission.
- **A cross-server conversation identifier with a credible authority.** That would supersede §7.2 and
  change the shape of the proposal considerably.
