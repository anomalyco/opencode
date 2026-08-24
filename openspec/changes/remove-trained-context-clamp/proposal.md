# remove-trained-context-clamp

## Problem

A hard clamp on `--ctx-size` was added in both llama-skein and opencode that
limits context window to the model's **trained context** (from GGUF `n_ctx_train`
or `max_position_embeddings`). The clamp is applied in three places:

- `llama-skein/internal/fit/fit.go` — `MaxFitCtx = min(vramMaxCtx, trainedCtx)`
- `llama-skein/internal/server/apiconfig.go` — PATCH clamps user ctx to `MaxFitCtx`
- `opencode-skein` reads `max_fit_ctx` from llama-skein's fit API and uses it
  for VRAM-based clamping in the TUI and overflow recovery

The justification was that above the trained context "RoPE extrapolation degrades
quality." While extrapolation behavior is worth knowing about as **guidance**, a
hard clamp is overkill. Models are not "totally unable" to use larger contexts —
they extrapolate with varying quality. The user should decide.

## Solution

Remove the trained-context clamp from all three locations. VRAM limits remain
enforced (they are physical constraints). The user's context choice is respected.

### Changes

**llama-skein (Go)**
- `internal/fit/fit.go` — `MaxFitCtx` is now VRAM-only, no `min(vram, trainedCtx)`.
- `internal/server/apiconfig.go` — PATCH writes `--ctx-size` verbatim, no clamp.
- `contracts/llama-skein.openapi.json` + `pkg/apicontract/llama_skein.gen.go` —
  Updated `max_fit_ctx` description.

**opencode-skein (TypeScript)**
- `packages/tui/src/local/model-fit.ts` — Updated comment.
- `packages/tui/test/model-fit.test.ts` — Updated test comments.
- `packages/opencode/src/server/routes/instance/httpapi/handlers/local.ts` —
  Updated comment.

opencode-skein had no independent trained-context clamp — it flows through
llama-skein's fit data.

## Impact

- Users can set `--ctx-size` above the model's trained context.
- The inference engine (llama.cpp) still enforces VRAM limits at load time.
- Quality degradation above trained context is the user's call.
