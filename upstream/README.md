# Upstream packaging

- **Canonical editable SEP:** [`../conversation-identity-sep-draft.md`](../conversation-identity-sep-draft.md)
- **PR artifact:** [`seps/3318-verifiable-conversation-handles.md`](seps/3318-verifiable-conversation-handles.md) — copy of the draft for `modelcontextprotocol/modelcontextprotocol` PR #3318

Before pushing SEP edits upstream:

```bash
cp conversation-identity-sep-draft.md upstream/seps/3318-verifiable-conversation-handles.md
# then prettier + generate:seps in the fork clone
```

Do not keep a parallel `0000-*.md` copy.
