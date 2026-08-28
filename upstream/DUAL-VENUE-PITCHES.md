# Dual-venue Discord pitches (copy into Discord)

SEP PR: https://github.com/modelcontextprotocol/modelcontextprotocol/pull/3318 (SEP-3318, Awaiting Sponsor).
Canonical WG thread: https://github.com/modelcontextprotocol/transports-wg/issues/36
Prefer one GitHub Discussion as the durable cross-venue record; link all channels to it and to #36.

---

## `#transports-wg`

**Title / first line:** SEP-3318 — answering transports-wg#36 (Conversation / Thread IDs)

Responding to [#36](https://github.com/modelcontextprotocol/transports-wg/issues/36) with a Standards Track draft (negotiated via SEP-2133 extensions map; not restoring core sessions).

**Lifecycle (#36 Q1):** establishment on first participating request (or refuse), rotation, supersession via monotonic `seq`, exchange of expired-but-authentic handles for §2.3-associated principals while retained, fork, retention. Details in SEP §4.

**Scope of impact (#36 Q2):** conversation handles MUST NOT vary `tools/list` / `resources/list` / `prompts/list`. ERP dynamic tool activation / Progressive Discovery need a separate catalog-versioning mechanism — deliberately out of scope here (caching / SEP-2549).

**Differentiator:** client-carried `_meta` (not model-threaded args); ordered (`seq`); integrity-protected for edge rejection of garbage. Association stays server-side (§2.3), same as SEP-2567 ACL guidance.

**Links:** PR https://github.com/modelcontextprotocol/modelcontextprotocol/pull/3318 · ref impl https://github.com/ryan-s-roberts/verifiable-conversation-handles · also Security IG + Agents WG

Ask: async review / agenda; seeking Core Maintainer sponsor. Comment also landing on #36.

---

## `#security-ig`

**Title / first line:** SEP-3318 verifiable conversation handles — Security IG review (Awaiting Sponsor)

Post-SEP-2567, MCP has no standard for durable conversation identity. Unverifiable `thread_id` / headers / model-selectable tool args are an integrity and misattribution hazard (see also transports-wg#36 evidence).

Standards Track: server-minted sequenced handle in client `_meta`; MAC for lookup-free reject of fabricated tokens; §2.3 association is the cross-principal hard stop; exchange gated on association + retention.

**Asks:** §2.3, model-vs-host `_meta`, exchange/expiry story, IFC worked example, Security Implications.

**Links:** PR https://github.com/modelcontextprotocol/modelcontextprotocol/pull/3318 · #36 · ref impl https://github.com/ryan-s-roberts/verifiable-conversation-handles

---

## `#agents-wg`

**Title / first line:** SEP-3318 conversation handles — Agents WG (not Tasks; composes with Tasks)

Agent memory / personalization / multi-conversation hosts need a stable client-carried conversation primitive. Orthogonal to Tasks (identity+ordering vs async job polling).

Handles in `_meta`: establishment, rotation, supersession, fork, §1.1 tool marks. List endpoints invariant across conversations.

**Links:** PR https://github.com/modelcontextprotocol/modelcontextprotocol/pull/3318 · transports-wg#36 · ref impl https://github.com/ryan-s-roberts/verifiable-conversation-handles
