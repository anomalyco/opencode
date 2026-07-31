# Proposal: Make local context-overflow recovery actually reachable

## Why

The 413 auto-recovery for local llama-skein providers has **never executed**.
Diagnosed live on `proxmox` / `qwopus3.6-27b-v2-mtp-q8-0` (2026-07-27) after the
model repeatedly appeared "stuck" in a Build session while `z4` was unaffected.

1. **The handler gates on the wrong error type for this failure mode.**
   `adjustLocalContextOnOverflow` (`packages/opencode/src/provider/provider.ts:1379`)
   returns early unless `error.type === "context_too_large"`. For a prompt
   that overflows an already-loaded, correctly-configured model, llama-skein
   actually emits `type: "exceed_context_size_error"`, `code:
   "prompt_over_max_safe_ctx"` (`internal/server/promptguard.go:103-104`).
   **Correction to an earlier draft of this proposal**: `context_too_large`
   is not dead code and does not "appear nowhere" — it is real and still
   fires, from a different component for a different failure mode:
   `proxy/proxymanager.go:1095` sends it when a model **fails to load**
   because its configured ctx doesn't fit available memory, distinct from a
   prompt being too large for an already-loaded model. Every prior task that
   hardened this function (`ctx-display-and-overflow-correctness` tasks 1–3,
   all marked complete) refined code that was unreachable **for the
   prompt-overflow class specifically** — the model-misconfigured class it
   already handled correctly and continues to.

2. **The remedy is wrong for this error class.** `prompt_over_max_safe_ctx`
   means *the prompt is too large for the host*, not *the model's ctx-size is
   misconfigured*. The handler responds by PATCHing the backend to a larger
   `ctx_size`. On the observed host that is impossible: the model already needs
   32078 MB of a 32624 MB card (98.3%, 546 MB headroom). Growing ctx would
   OOM, not recover.

3. **The ceiling it reads is legitimately absent.** The handler takes
   `max_fit_ctx` and bails on `<= 0`. For this model llama-skein omits
   `max_fit_ctx` because its KV budget is negative
   (`32624 × 0.92 × 0.85 − 27701 × 1.05 = −3574 MB`), so recovery would fail even
   if reached. Meanwhile `max_safe_ctx: 74711` **is** present and is the value
   the backend actually enforces — and `fetchLocalModelFit` in the same file
   already documents `max_safe_ctx` as "the authoritative prompt ceiling".
   The two functions disagree about which field is authoritative.

4. **A single failed fit probe wedges the whole session.** Discovery sets
   `limit.context = fit.max_safe_ctx ?? reported context_length`. Fit and
   `/v1/models` share **one 2s AbortController**, and discovery runs **once at
   startup**. When the fit probe loses that race, the model silently keeps
   `90112` instead of `74711` — 21% over the enforced wall — for the entire
   process lifetime. Compaction then sizes its budget from the wrong number,
   never trims, and every request 413s with recovery dead. This is why the
   symptom is intermittent ("stuck *again*") and why restarting clears it.

`z4` is unaffected only because its gap is proportionally small and rarely
reached (`max_safe_ctx 237076` vs reported `262144`); `proxmox` sits at
`74711` vs `90112`, which a Build session crosses routinely.

## What

- **Match the real contract.** Recovery MUST trigger on llama-skein's actual
  overflow signal (`type: "exceed_context_size_error"` / `code:
  "prompt_over_max_safe_ctx"`, HTTP 413), not on `context_too_large`. The
  matcher MUST be driven by the published contract, not a hand-copied string.
- **Trim, do not grow.** A prompt-overflow 413 MUST be handled by reducing the
  outgoing prompt to the advertised ceiling (triggering compaction), never by
  PATCHing the backend to a larger `ctx_size`. Backend ctx-patching remains
  valid only for a genuine *model-misconfigured* overflow.
- **Use the advertised ceiling.** The limit MUST be read from the machine-
  readable `X-Skein-Max-Safe-Ctx` response header (falling back to `/api/fit`
  `max_safe_ctx`), never parsed out of the human-readable message, and never
  gated on `max_fit_ctx`, which is legitimately absent for a VRAM-tight model.
- **Self-heal the stale limit.** On a prompt-overflow 413 opencode MUST correct
  the in-memory `limit.context` for that model from the authoritative value in
  the response, so the session recovers without a restart.
- **Never silently over-estimate.** When the `/api/fit` probe fails, discovery
  MUST NOT fall back to a `context_length` that exceeds the enforced budget
  without marking the model as unverified; a too-large budget is worse than a
  conservative one. Give fit its own timeout rather than sharing the models
  fetch's 2s budget.

## Non-goals

- No change to llama-skein's fit math or its VRAM safety fractions
  (companion change `report-achievable-ctx-for-configured-models`).
- No re-litigation of the display denominator
  (`ctx-display-and-overflow-correctness` owns that and is complete).
- Capacity remediation for the proxmox host (lowering `--ctx-size` to ~74k or
  relocating the model) is an ops action tracked separately, not a code change.

## Impact

- `packages/opencode/src/provider/provider.ts`: `adjustLocalContextOnOverflow`
  trigger condition, remedy, and ceiling source; the 413 retry site (~:2126);
  `discoverOpenAICompatibleModels` fit timeout isolation and fallback policy.
- `packages/opencode/src/provider/error.ts`: overflow classification already
  catches 413 — must stay consistent with the new handler.
- `packages/opencode/src/session/compaction.ts`: consumes `limit.context`;
  benefits from the corrected value, no signature change expected.
- Regression risk is low and well-bounded: the code path being changed is
  currently dead, so behaviour can only improve from "no recovery".
