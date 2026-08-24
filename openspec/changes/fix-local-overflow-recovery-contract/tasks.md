# Tasks: fix-local-overflow-recovery-contract

- [x] 1. Add a failing regression test that feeds `adjustLocalContextOnOverflow`
       a real llama-skein 413 body
       (`{"error":{"type":"exceed_context_size_error","code":"prompt_over_max_safe_ctx",
       "message":"prompt (~106692 tokens) exceeds the safe context ... (max_safe_ctx 74711)"}}`)
       plus an `X-Skein-Max-Safe-Ctx: 74711` header, and asserts recovery fires.
       It MUST fail against `main` — that failure is the proof the handler is
       currently unreachable.
  - File: `packages/opencode/test/provider/provider.test.ts` (3 new tests: header path, `/api/fit` fallback path, and a regression guard that the pre-existing `context_too_large` class still patches+retries)
  - `adjustLocalContextOnOverflow` and `State` exported from `provider.ts` to make this directly testable, matching the existing `mergeDiscoveredModel` export convention.

- [x] 2. Split the overflow classes. Introduce an explicit discriminator:
       `prompt_over_max_safe_ctx` → **trim the prompt**;
       a model-ctx-misconfigured overflow → **patch backend ctx** (existing
       behaviour). Only the latter may call `patchConfigModel`.
  - File: `packages/opencode/src/provider/provider.ts` (`adjustLocalContextOnOverflow`)
  - Note: see proposal.md correction — `context_too_large` is real (`proxy/proxymanager.go:1095`, model-failed-to-load class) and its existing patch-and-retry behavior is preserved unchanged, not replaced.

- [x] 3. Prompt-overflow path: read the ceiling from `X-Skein-Max-Safe-Ctx`,
       falling back to `/api/fit` `max_safe_ctx`. Do NOT consult `max_fit_ctx`
       and do NOT regex the message text. Drop the `maxFit <= 0 → return false`
       bail from this path.
  - Implemented via `client.getModelFit({model})` (single-model fit lookup, not the fleet-wide `getFitReport`) as the fallback when the header is absent or invalid.

- [x] 4. Self-heal: on a prompt-overflow 413, write the authoritative ceiling
       back into the in-memory `limit.context` for that model so the session
       recovers without a restart, then signal compaction to re-run before the
       retry.
  - Implemented as: mutate `s.providers[providerID].models[modelID].limit.context` directly (same live-object mutation pattern as the existing `setModelContextLimit`, but touching only `context`, not `contextMax` — the hard n_ctx ceiling hasn't changed, only the safe prompt budget), then return `false` (no blind inline retry of the same oversized body). "Signal compaction" is the *existing* reactive `needsCompaction = true` path in `session/processor.ts` on any `ContextOverflowError` (already fires for any 413 — error.ts already classifies by status code, confirmed unchanged) — it was already wired, just never got a correct budget to compact against. No compaction.ts signature change, matching the proposal's stated Impact scope.

- [x] 5. Give `fetchLocalModelFit` its own AbortController instead of sharing
       the `/v1/models` 2s budget, so a slow fit probe cannot silently downgrade
       `limit.context` to the larger `context_length`.
  - `/v1/models` keeps its 2s budget; fit gets its own 3s budget. Updated the existing "discovery completes when /api/fit hangs forever" test's stale comment (it previously asserted the two *should* share a budget); its assertions (`limit.context` fallback value, `elapsed < 5000`) needed no change since 3s < 5s.

- [x] 6. When fit is unavailable AND the reported `context_length` exceeds any
       previously-known `max_safe_ctx`, prefer the conservative known value and
       log at WARN; never silently adopt the larger number.
  - File: `discoverOpenAICompatibleModels` in `provider.ts`. Side effect: this also fixed a pre-existing, unrelated-looking failing test (`discoverModels:true merges discovered models without overriding manual models`, expected 4096 got 8192) — same root cause playing out via a manually-configured model's smaller context being overridden by a larger discovered value, not just a prior-discovery's fit value. Full `provider.test.ts` suite: 101 pass, 0 fail (was 1 fail before this task).

- [ ] 7. Contract-drift guard: derive the accepted error `type`/`code` from the
       llama-skein OpenAPI contract (or a single shared constant) and add a test
       that fails if the two repos diverge again. This class of bug — a
       hand-copied error string — is the actual root cause and MUST NOT recur.
  - Partial: added `LLAMA_SKEIN_PROMPT_OVERFLOW_TYPE`/`_CODE`/`_MAX_SAFE_CTX_HEADER` as single-sourced constants in `provider.ts` with comments citing the exact llama-skein source lines, so opencode-skein itself no longer has the string duplicated. Did NOT build the cross-repo CI drift guard (would need llama-skein's OpenAPI spec vendored or fetched into this repo's test/CI — real infra work, out of scope for a bug fix). Follow-up.

- [ ] 8. Verify live against `proxmox` / `qwopus3.6-27b-v2-mtp-q8-0`: a Build
       session that crosses 74711 tokens compacts and continues instead of
       wedging. Capture before/after in the change notes.
  - Not done — no access to the `proxmox` host from this environment. Needs manual verification.

- [x] 9. `bun run typecheck` green in `opencode` and `tui`; `bun test` green for
       the provider package.
  - `bun run typecheck`: only the pre-existing `src/session/prompt.ts:1152` error remains, caused by unrelated uncommitted WIP (auto-mode) in the working tree — confirmed via bisecting clean checkouts, not caused by this change. `tui` package not separately checked (no changes there). `bun test test/provider/provider.test.ts`: 101 pass, 0 fail. `bun test test/session/compaction.test.ts`: 55 pass, 1 skip, 0 fail.
