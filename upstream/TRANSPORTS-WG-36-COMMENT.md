# Draft comment for transports-wg#36

Post manually to: https://github.com/modelcontextprotocol/transports-wg/issues/36

Do **not** paste the full SEP.

---

Thanks for collecting use cases here — this is the right venue.

I've opened **SEP-3318** (Awaiting Sponsor, Standards Track, negotiated via the SEP-2133 extensions map) as one concrete answer to the two questions in the OP:

1. **Lifecycle** — establishment without a dedicated RPC, rotation, supersession via monotonic `seq`, exchange of expired-but-authentic handles only for §2.3-associated principals while the conversation is retained, fork, and retention. Spec §4.
2. **Scope of impact** — conversation identity MUST NOT mutate `tools/list` / `resources/list` / `prompts/list`. Cases like ERP dynamic tool activation / Progressive Discovery need a separate catalog-versioning (or similar) mechanism; this SEP deliberately declines list mutation so list caching stays sound.

Carriage is client `_meta` (not model-threaded tool args), which matches several comments here about correlation IDs in the untrusted channel and silent misattribution when the model relays the wrong id.

Reference implementation + Quint model of the lifecycle: https://github.com/ryan-s-roberts/verifiable-conversation-handles  
SEP PR: https://github.com/modelcontextprotocol/modelcontextprotocol/pull/3318

Happy to adjust based on WG feedback; seeking a Core Maintainer sponsor after discussion here / Discord.
