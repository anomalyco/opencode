# Handoff: honor `skein_loading` — don't persist llama-skein loading themes

**Repo:** opencode (this fork) · **Pairs with:** llama-skein (shipped) · **Why:** the bloat that filled the disk

## The problem (root-caused 2026-06-20)

opencode's SQLite session store ballooned to **~16 GB across its DBs** (one was 9.1 GB),
filling the disk → `SqlError: Failed to execute statement` → the TUI disintegrated.

Cause: while a model loads, **llama-skein streams its loading-state themes as
`reasoning_content` SSE deltas** ("Filling the key-value cache with the ghost of prompts
past…", etc.). opencode persists all reasoning, so thousands of these (especially during
load churn) get written to the session DB forever. They are **pure UI flavor** — they
should be shown live and then forgotten.

## What llama-skein now sends (shipped, deployed M3/M5/proxmox)

Every loading-state chunk now carries a top-level `skein_loading: true` marker:

```json
{"choices":[{"delta":{"reasoning_content":"Filling the key-value cache…"}}],"skein_loading":true}
```

Real model output never has this field. Backward-compatible: a client that ignores the
field still renders the text as reasoning (today's behavior).

## What to do in opencode-skein

**Render `skein_loading` chunks live (keep the nice loading UX) but DO NOT persist them.**

### The catch: the ai-sdk likely drops the top-level field
opencode parses the stream via the Vercel ai-sdk, which maps `chat.completion.chunk` to
its own delta types and **discards unknown top-level fields** like `skein_loading`. So you
can't read it from the parsed delta downstream — you must inspect the **raw SSE chunk**.

The fork already has a custom local provider for llama-skein
(`packages/opencode/src/local/llama-skein/` + the provider wiring). The clean insertion
point is a **fetch/transform wrapper on that provider's stream** that sees raw chunks
before the ai-sdk:

1. Parse each raw `data:` line's JSON.
2. If `chunk.skein_loading === true`:
   - forward it to the UI for live display (the loading indicator), AND
   - **mark it ephemeral** so it never reaches the persistence path.
3. Otherwise pass through unchanged.

How to "mark ephemeral" depends on the cleanest hook:
- **Option A (preferred):** strip `skein_loading` chunks from the stream the ai-sdk/
  persistence sees, and drive the loading UI from a side channel (you already show
  "llama-skein loading model: X" — feed these themes into that same transient view).
- **Option B:** let them flow as reasoning for display, but in the persistence path
  (`packages/opencode/src/session/processor.ts` — the `reasoningMap` / `finishReasoning`
  accumulation, ~L248) skip text that came from a `skein_loading` chunk. This needs the
  marker threaded from the raw chunk down to processor — more plumbing than A.

### Acceptance test
1. Point opencode at a local model that needs loading (M3/M5 MLX, or proxmox after idle).
2. Send a prompt that triggers a cold load; confirm the loading themes still display.
3. After the response, inspect the session DB (`~/.local/share/opencode/opencode-*.db`):
   the loading themes must **not** be present in the stored message/reasoning rows.
4. The DB should grow only by the real prompt+response, not by the loading flavor.

## Notes
- This is the disk-bloat fix; it pairs with the context-trim handoff
  (`HANDOFF-fit-context-trim.md`) — both are "opencode-skein stores too much."
- Also worth a one-time cleanup + retention policy: opencode keeps one SQLite DB per
  build/instance with no pruning; old builds' DBs (`opencode-.db`, `opencode.db`, PR-temp
  DBs) accumulated to gigabytes. Consider VACUUM-on-startup and dropping orphaned DBs.
