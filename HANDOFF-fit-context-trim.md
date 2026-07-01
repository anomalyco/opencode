# Handoff: consume llama-skein `/api/fit` `max_safe_ctx` to stop context-overflow 413s

**Repo:** opencode (this fork) · **Related:** llama-skein epic `skein-uyyu`, bug `skein-v9bf`
**Status:** llama-skein side shipped + deployed (M3/M5/proxmox). This is the downstream consumer — not started.

## The bug (proven, not theorized)

A coding session against a local model fails with **"Context size has been exceeded"** while the
sidebar shows only ~33% used (e.g. `28,168 / 84k`).

Proven mechanism (reproduced on proxmox, read off the backend 413 body):
- llama.cpp returns `exceed_context_size_error` **only when `n_prompt_tokens > n_ctx`**.
  `max_tokens` over n_ctx is fine (it's a cap, not a reservation). Body:
  `request (110010 tokens) exceeds the available context size (86016 tokens)`.
- So the failing request's **assembled prompt genuinely exceeded the model's `n_ctx`**.
- The sidebar meter and the compaction trigger both read the **last completed assistant turn's**
  reported usage (`tokens.input+output+reasoning+cache`) — a **lagging indicator**. The request
  that 413s is a *new, larger* prompt (grown by tool results, file reads, history since that turn)
  that was **never measured before being sent**. That's why the meter said 28k while the wire
  prompt was >86k. It is NOT primarily a tokenizer undercount.

Two compounding factors:
1. opencode doesn't size/guard the **next** request against the limit before sending.
2. The limit it uses (`84k` ≈ 86016) is the model's raw `n_ctx`, with no margin — so even an
   accurate estimate at the edge can tip over (tokenizer differs from the model's; MTP/reserve).

## What llama-skein now provides

`GET /api/fit` and `GET /api/fit/{model}` return `ModelFit` with **`max_safe_ctx`** — the
prompt budget a caller must trim to so it never exceeds the backend's hard `n_ctx`. It already
reserves an output budget + a tokenizer-mismatch margin (~8%) below `configured_ctx`. This is the
**single authoritative number to trim to** — use it instead of `limit.context` (the raw n_ctx).

```
GET /api/fit/{model}  ->  { "model","backend","fit_level","configured_ctx","max_safe_ctx", ... }
GET /api/fit          ->  { "vram_total_mb","vram_free_mb","models":[ModelFit,...] }
```

Validated live on standard GGUF models (M3 qwen3-35b: fit=perfect, coherent max_safe_ctx).
Caveat: a non-standard merge (qwopus MTP) returns `fit_level:"no"` because its GGUF exposes no
arch metadata — tracked as a separate pkg/gguf bug. Treat a missing/`no` fit as "unknown, fall
back to current behaviour", don't hard-fail.

## Work to do (opencode)

### 0. Regenerate the llama-skein TS client (prerequisite)
The generated client at `packages/opencode/src/local/llama-skein/gen/` predates the fit contract
(no `getFitReport`/`max_safe_ctx` yet). Regenerate from the updated spec:
```
cd packages/opencode && bun run build:llama-skein-client
```
Confirm `max_safe_ctx` / `getModelFit` appear in `gen/`.

### 1. Source the context limit from `max_safe_ctx`
Where opencode resolves a local model's context window:
- `packages/opencode/src/provider/provider.ts:1348` — the fallback chain
  `context_length ?? max_context_length ?? existingModel.limit.context ?? 0`. For llama-skein
  providers, prefer the model's `/api/fit` `max_safe_ctx` over `context_length`.
- `provider.ts:1192`, `:1311` — other `limit.context` assignments to keep consistent.
- Keep `configured_ctx` available too (the hard n_ctx) — useful for display ("safe X of N").

Decide the data path (opencode → skein → llama-skein today; the 413 came from skein at
192.168.2.2):
- **Option A (recommended):** opencode calls each local provider's `/api/fit` directly — it
  already has the llama-skein client and discovers providers. Cleanest; no skein change.
- **Option B:** skein aggregates `/api/fit` and includes `max_safe_ctx` in the model list it
  serves opencode. Needs a skein change but centralizes it.

### 2. Guard/compact the NEXT request, not the last turn
- Sidebar meter: `packages/tui/src/feature-plugins/sidebar/context.tsx:151-167` reads the last
  assistant turn's tokens vs `limit.context`. At minimum, switch the denominator to
  `max_safe_ctx` so the meter reflects the real headroom.
- The real fix is the **compaction trigger**: `packages/opencode/src/session/overflow.ts:32`
  (uses `input.tokens.total`) and `packages/opencode/src/session/compaction.ts`. Trigger
  compaction when the **estimated assembled prompt for the next request** approaches
  `max_safe_ctx` — not when the last turn's reported usage does. A pre-send estimate of the
  outgoing prompt is what's missing.

### 3. Safety net: handle the 413 and retry
`packages/opencode/src/provider/error.ts:111,168` already maps statusCode 413 /
`context_length_exceeded` to a context-overflow error. Instead of surfacing it as a hard failure,
**compact (or trim oldest turns) and retry once**. This catches the case where the pre-send
estimate is still slightly off.

## Acceptance test

Use a **standard** model where `/api/fit` works (NOT qwopus until its pkg/gguf bug is fixed):
proxmox `qwen3.6-35b-a3b`, or M3/M5 models. Steps:
1. `curl <provider>/api/fit/<model>` → confirm a sane `max_safe_ctx`.
2. In opencode, confirm the sidebar denominator is `max_safe_ctx` and the meter tracks the
   in-flight prompt, not just the last turn.
3. Drive a long agentic session (large file reads) until context fills. **Expect**: opencode
   compacts before the prompt reaches `n_ctx` — no "Context size exceeded" 413. If a 413 still
   slips through, it compacts-and-retries rather than erroring.

## Gotchas
- opencode-skein is a fork; rebases on upstream opencode are routine — keep the change localized
  and well-commented so it survives rebases (see the fork's AGENTS.md conventions).
- `max_safe_ctx` is **memory/n_ctx-safe**, not quality-at-length — it can be large (e.g. 224k on a
  36GB unified Mac with q4_0 KV). That's fine; it's the ceiling, not a recommendation.
- A model with `fit_level:"no"` or no `max_safe_ctx` → fall back to existing `context_length`
  behaviour; never block a model because fit is unavailable.
