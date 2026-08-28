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
| `src/tool-meta.ts` | §1.1 `tools/list` mark helpers (`buildToolHandleMeta`, `readToolHandleMeta`) |
| `examples/reference-server/` | Streamable HTTP fixture (shared manager lifetime) |
| `conformance/` | SEP-0000 e2e scenarios + `sep-0000.yaml` traceability |
| `models/conversation-handle/` | Quint spec of §4 lifecycle + client seq merge — see [`README`](models/conversation-handle/README.md) for spec traceability |
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

Parallel in-flight tool calls may send the same handle. Within an issuer-scoped
`ConversationHandleClient`, sequence state is keyed by host **`sessionKey`**: only a
higher-sequence handle for the **same** session key replaces the stored handle.
Response `_meta` does not mirror `conversationId` (§4.1); hosts use their own
thread/UI keys.

### Session keys (`sessionKey`)

The client API accepts an optional `sessionKey` on `acceptResponseMeta`,
`buildRequestMeta`, `getHandle`, `getSession`, and `clear`. Keys are **library-local
routing labels**, not wire fields.

Use separate session keys when tracking multiple conversations on one MCP client
instance — especially **fork** (§4.5):

```typescript
// Parent conversation on the default key
await tool(client, handleClient, { fork: false });
const forked = await client.callTool({
  name: 'memory_read',
  arguments: {},
  _meta: handleClient.buildRequestMeta('default', { fork: true }),
});
// Accept the child under a distinct key so the parent handle is preserved
handleClient.acceptResponseMeta(forked._meta, 'fork');
```

`clear(sessionKey)` drops that key's state and bumps a generation counter so
late in-flight responses cannot re-bind after an intentional reset.

Read-only server responses do not rotate the handle unless state changes or expiry
policy applies.

Only the **Specification** section of [conversation-identity-sep-draft.md](./conversation-identity-sep-draft.md) is tested. This is an opt-in extension on MCP 2026-07-28; non-participating peers are unaffected.
