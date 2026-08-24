# Tasks: per-model-placement-controls

The sidebar indicator (tasks 2–4) ships without any llama-skein change, using
`run_mode` + `vram_required_mb`. Only the `under_offloaded` preference and the
"remove the pin" wording depend on llama-skein `flag-under-offloaded-models`.

- [x] 1. Resolve the "Where the control lives" Open Question. **Decided 2026-08-14,
       see `design.md`.** D1: extend `DialogModelCtx`; do not touch `DialogTuning`.
       The signatures decide it — `DialogTuning(props: {providerID})` has no
       `modelID` and patches the host-wide `/api/tuning`, so a per-model write there
       is a category error, not a missing parameter. `DialogModelCtx(props:
       {providerID, modelID})` already reads `getModelFit` (line 60, whose response
       already carries `run_mode`/`host_resident_mb`/`placement`), already patches
       with an abort/stale guard (line 142), and already faces the same reload cost.
       Retitle from `Context — ${modelName()}` to `${modelName()}` with "Context"
       and "Placement" as sections. D2: the indicator keys on `under_offloaded`,
       never `run_mode` alone. D3: reuse the existing reload-cost convention.

- [ ] 2. Read `run_mode`, `host_resident_mb`, and `vram_required_mb` from the
       existing `/api/fit` poll in `packages/tui/src/feature-plugins/sidebar/context.tsx`.
       Fold into the current hardware/tuning poll — no new loop — reusing the
       existing cancelled-flag/abort guard.
       Validation: `cd packages/tui && bun run typecheck`

- [ ] 3. Render the placement indicator per the spec: fire only on avoidable
       offload, name the host-resident amount, stay silent for genuine hybrids and
       fully-resident models. Also per D1: retitle `DialogModelCtx` from
       `Context — ${modelName()}` to `${modelName()}` with "Context" and "Placement"
       sections, and make the sidebar VRAM/placement area a second click target
       opening the same dialog (the Context label keeps working, so nobody
       relearns anything).
       Validation: `cd packages/tui && bun run typecheck`; manual check against
       host A `M2` (must warn) and `M4`
       (must stay silent).

- [ ] 4. Verify the indicator against all five host A models recorded in
       llama-skein `flag-under-offloaded-models`: warn on
       `M2` and `M3`;
       stay silent on `M4`, `M5`, and
       `M6` — the last two are pinned at `-ngl 40` yet fully resident,
       so a check keyed on the pinned number rather than the outcome fails here.
       Validation: recorded per-model verdict; two warn, three silent.

- [ ] 5. Build the placement control on the surface chosen in task 1: show current
       placement, offer "remove the pin" as primary where the host reports full
       residency is achievable, allow an explicit value, and state the reload cost
       before the write. Reuse `DialogModelCtx`'s patch + abort/stale handling
       rather than a new pattern.
       **Blocked on two llama-skein API defects found 2026-08-12 while fixing host A
       by hand** — do not work around either client-side:
       (a) there is no way to *remove* `n_gpu_layers` via
       `ConfigModelPatchRequest`; every value overwrites, and `0` writes
       `--n-gpu-layers 0` (all layers on CPU). So the primary action is not
       expressible yet. llama-skein `flag-under-offloaded-models` task 17.
       (b) `GET /api/models/config/{id}` returns `--port` **resolved** (`5803`)
       where the config stores `${PORT}`, so the read-modify-write cycle this
       control depends on would hardcode a dynamically allocated port and silently
       break the model later. llama-skein task 18. Patching the full `cmd` string is
       the only current removal route and is unsafe for this reason.
       Validation: `cd packages/tui && bun run typecheck`; a round-trip test proving
       `${PORT}` survives an edit.

- [ ] 6. Confirm the patch path end to end against a live host: clearing the pin
       removes `--n-gpu-layers` from the model's `cmd` and the model returns
       `run_mode: "gpu"` on reload. `PATCH /api/models/config/{id}` scopes to a
       single model — verify no sibling entry changed, by diffing the host's
       config-history snapshot.
       Validation: config-history diff shows exactly one changed line.

- [ ] 7. Regenerate the llama-skein TS client once `under_offloaded` is in the
       published spec, and prefer it over the fallback heuristic. Commit the regen
       separately. Generated clients are never hand-edited.
       Validation: `grep -r "under_offloaded" packages/opencode/src/local/llama-skein/gen packages/tui/src/local/llama-skein/gen`

- [ ] 8. Correct the stale Non-goal in `openspec/changes/add-gpu-tuning-ui/proposal.md`:
       the route is `/api/models/config/{id}`, and "ctx size / offload live there
       already" described the server API, not a client surface — `ctx_size` got one,
       `n_gpu_layers` did not. Leave the completed tasks alone; annotate the Non-goal
       as superseded by this change.
       Validation: the Non-goal names the correct route and points here.

- [ ] 9. Open a follow-up for `ctx-aware-subagent-placement`: its scorer's dominant
       `fit_level×1000` term (`packages/opencode/src/local/placement.ts:81-86`,
       `:189`) changes meaning once llama-skein stops grading wasted VRAM
       favourably. Do not change the scorer here.
       Validation: `specsync note -change ctx-aware-subagent-placement "<finding>"`

- [ ] 10. Record the `HOST_PACED_PENALTY` interaction, which this investigation
       exposed as a live routing bug rather than a future concern.
       `isHostPaced()` (`placement.ts:104-107`) keys on
       `placement.perf_class ∈ {cpu-bound-hybrid, cpu-only}`, but llama-skein
       returns `native-gpu` unconditionally for any pinned-placement model
       (`internal/placement/placement.go:153`). Verified on host A:
       `perf_class: "native-gpu"` alongside `run_mode: "cpu_offload"`, 7165 MB
       host-resident, 1.2 tok/s. **The 200,000-point penalty never fires for pinned
       models — the guard is disabled by exactly the configuration that produces the
       models it guards against.** The fix is llama-skein
       `flag-under-offloaded-models` task 16; this repo must not paper over it
       client-side.
       Validation: once that lands, a pinned host-paced model on host A is penalised;
       confirm no double penalty against the placement-aware `fit_level` (its task 17).

- [ ] 11. Repo validation: `bun run typecheck` in `packages/opencode` and
       `packages/tui`; `cd packages/opencode && bun test test/local`.
       Validation: both typechecks and the local test suite pass.

- [ ] 12. Low-confidence follow-up, investigate before speccing: the sidebar VRAM
       readout was observed reading `0.1 / 24.0 GB` against a `91%` bar. The
       `/api/hardware` contract is intact (`vram.used_mb` is present and matched
       `rocm-smi` exactly), so the likely cause is a torn render across the 30 s
       poll — `MemBreakdown` taking the `modelMb == 0` branch while the bar kept a
       stale percent. Reproduce before deciding whether it is a real defect.
       Validation: reproduced or ruled out, with the finding recorded.
