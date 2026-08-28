# GitHub Discussion draft (optional durable record)

**Title:** Proposal: Verifiable Conversation Handles (SEP-3318) — Transports WG + Security IG + Agents WG

**Body:**

## Summary

Standards Track SEP (Awaiting Sponsor) proposing `io.modelcontextprotocol/conversation-handle`: a server-minted, sequenced, integrity-protected conversation identity carried in client `_meta` (not tool arguments). Opt-in via SEP-2133 extensions capability map; no new RPC methods.

Headline contribution is **ordering (`seq`)** — ACLs alone cannot recover “is this the current handle?”. MAC enables lookup-free rejection of fabricated tokens; §2.3 association remains the cross-principal hard stop.

## Why / venue

Answers [transports-wg#36](https://github.com/modelcontextprotocol/transports-wg/issues/36) (lifecycle + list-scope). Related prior art: SEP-1655 (cookies — not the same), SEP-1685, discussion #2894, SEP-2822 → #36.

Also co-routed to Security IG (threat model) and Agents WG (memory/orchestration; orthogonal to Tasks).

## Evidence of work

- Quint model of §4 lifecycle
- Conformance traceability + e2e suite
- TypeScript reference implementation

## Links

- SEP PR: https://github.com/modelcontextprotocol/modelcontextprotocol/pull/3318
- Reference implementation: https://github.com/ryan-s-roberts/verifiable-conversation-handles
- transports-wg#36: https://github.com/modelcontextprotocol/transports-wg/issues/36

## Ask

Async review; agenda slots welcome; seeking a Core Maintainer / Maintainer sponsor.
