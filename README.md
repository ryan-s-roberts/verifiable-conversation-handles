# Verifiable Conversation Handles — TypeScript Reference

> **Experimental extension** — Reference implementation of the draft SEP
> `io.modelcontextprotocol/conversation-handle`. Not an official MCP extension. API and wire
> format may change before review.

Implements the RECOMMENDED §6.2 symmetric encoding, server mint/rotate/verify,
opaque client persistence, and a conformance-style e2e suite with `sep-0000.yaml`
traceability.

## Quick start

```bash
npm install
npm test
pnpm run example:server
```

## Packages

| Path | Role |
|------|------|
| `src/schema/draft/schema.ts` | Wire types + settings (ext-tasks style) |
| `src/codec.ts` | HMAC-SHA256 handle construction and verification |
| `src/extension.ts` | `conversationHandlePlugin()` — presentation union + `invokeToolHandler()` |
| `src/integrate.ts` | `registerConversationTools()` for MCP servers |
| `src/fixtures/` | Memory + IFC fixtures, `createConversationFixtureApp()` / `createIfcFixtureApp()` |
| `src/fixtures/label-head.ts` | Versioned label-journal encoding for §3 state commitment |
| `src/http-server.ts` | `serveMcp()` / `serveMcpEphemeral()` helpers |
| `src/client.ts` | Opaque per-conversation handle persistence with seq-aware concurrent merge |
| `examples/reference-server/` | Streamable HTTP fixture (shared manager lifetime) |
| `conformance/` | SEP-0000 e2e scenarios + `sep-0000.yaml` traceability |
| `conformance/ifc-e2e.test.ts` | Information-flow use case: taint journal keyed on `cid`, egress blocked after PII |

## Extension identifier

`io.modelcontextprotocol/conversation-handle`

## State commitment hook

Servers supply `stateCommitment(record)` when creating `conversationHandlePlugin()`. The returned
bytes are embedded in every minted handle (§6.2 `state` field). Rotation is triggered when:

- `stateCommitment(record)` differs from the presented handle's commitment bytes (§4.2 MUST), or
- the handle is near expiry (SHOULD).

Memory fixtures encode the memory-store head; IFC fixtures encode the label-journal head. Use
`resolveOnMissingHandle` returning `reject` for fail-closed policy after principal-level taint.

## Exchange (§4.4)

Expired-handle exchange mints fresh `_meta` only; the presenting tool handler is **not** invoked.

## Client concurrency (§4.2)

Parallel in-flight tool calls may send the same handle. Within an issuer-scoped client, sequence state
is keyed by `conversationId`: only a higher-sequence handle for the same conversation replaces the
stored handle. Accept a fork response under a new session key so the child does not replace its
parent. Read-only server responses do not rotate the handle unless state changes or expiry policy
applies.

Only the **Specification** section of [conversation-identity-sep-draft.md](./conversation-identity-sep-draft.md) is tested. This is an opt-in extension on MCP 2026-07-28; non-participating peers are unaffected.
