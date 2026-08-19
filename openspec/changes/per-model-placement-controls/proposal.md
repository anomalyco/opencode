# Show and edit where a local model's layers run

> **Labels.** This repo is public, so fleet hosts and installed models are named by
> capability and shape rather than by hostname or model id; the mapping lives in the
> private companion repo (`docs-skein/fleet-labels.md`). Host A is a 24 GB RDNA3
> workstation. `M1`–`M6` are that fleet's installed models. All measurements are
> verbatim.

## Why

An agent session on host A ran at **1.2 tok/s** for its whole duration
(2026-08-12). The model was serving 26 of its 66 layers from the CPU because its
`cmd` pinned `--n-gpu-layers 40`. Correcting it gave **32.4 tok/s** — 27×.

Nothing in opencode said so. The sidebar showed `1.2 t/s`, a context bar, a VRAM
bar, and `gfx1100 · default`. The operator's only signal that anything was wrong
was the speed itself, and the only available reading of that was "local models are
slow." Diagnosing it took reading the GGUF layer count on the host by hand.

The host already knew and already said so. `GET /api/fit/{model}` returned
`run_mode: "cpu_offload"` with `host_resident_mb: 7165` — the whole diagnosis, in
a field opencode fetches and drops. opencode polls `/api/fit` for `max_safe_ctx`
and `fit_level`; `run_mode` and `host_resident_mb` go unread.

**The editing surface was scoped out on a false premise.** `add-gpu-tuning-ui` is
complete, and its Non-goals say:

> Per-model flag editing beyond what `/api/config/models/:id` PATCH already
> supports (ctx size / offload live there already).

Two problems. The route is `/api/models/config/{id}`, not
`/api/config/models/:id` — the note is stale. And "live there already" describes
the *server* API, not any client surface: `ctx_size` did get one
(`DialogModelCtx`, reachable by clicking Context), `n_gpu_layers` never did. So the
tuning dialog offers auto-tune, flash attention, parallel slots, and MTP — four
host-wide knobs — and no way to change the per-model setting that cost 27×. Its own
footer even warns *"explicit cmd flags always win"*, so no amount of correct tuning
can rescue a bad `-ngl`.

This is a repeating pattern rather than an oversight. llama-skein's
`add-auto-hybrid-placement` records it: offload auto-application "was deliberately
deferred to clients (`add-model-offload-tuning` tasks 9–10, both `[D]`), and no
client ever shipped it." The server computes the right answer, the client surface is
deferred, and the deferral is never picked up.

It is also not one bad model. Read the same evening, three of five remaining host A
models were `run_mode: cpu_offload` with VRAM to spare, and the worst of them
graded `fit_level: "perfect"` — see llama-skein `flag-under-offloaded-models`,
which fixes the server-side grading and adds the `under_offloaded` flag this change
displays.

**A routing guard this repo already ships is silently disabled by the same
cause.** `isHostPaced()` (`packages/opencode/src/local/placement.ts:104-107`)
applies a 200,000-point `HOST_PACED_PENALTY` to keep sub-agents off host-paced
models, keyed on `placement.perf_class` being `cpu-bound-hybrid` or `cpu-only`.
llama-skein returns `perf_class: "native-gpu"` unconditionally for *any* model with
pinned placement flags (`internal/placement/placement.go:153`). Verified on host A:
`native-gpu` reported alongside `run_mode: "cpu_offload"`, 7165 MB host-resident,
1.2 tok/s. So the penalty never fires for pinned models — the guard is defeated by
exactly the configuration that produces the models it guards against, and the
sub-agent routing this repo's own comment warns about ("a subagent silently lands
on a model ~90x slower") happens anyway. The fix belongs in llama-skein
(`flag-under-offloaded-models` task 16), not in a client-side workaround on top of
the existing one.

## What Changes

- **Surface `run_mode` in the sidebar.** When a local model is not fully
  GPU-resident, say so where the speed is already shown, with the host-resident
  amount. A `cpu_offload` verdict on a model whose weights would fit VRAM is a
  mechanical red flag and needs no new server work to detect — `run_mode` and
  `host_resident_mb` are already on `/api/fit`.
- **Consume `under_offloaded` when the host offers it.** Prefer the server's flag
  over a client-side inference, and degrade to the `run_mode` +
  `host_resident_mb` heuristic against hosts that predate it.
- **A per-model placement control**, modelled on the existing `DialogModelCtx`
  rather than a new pattern: view the current placement and edit
  `n_gpu_layers` via `PATCH /api/models/config/{id}`, which already accepts it.
- **Offer "remove the pin" as the primary action.** Where the host reports that
  the counterfactual plan is full GPU residency, clearing the flag so llama-skein
  computes placement is the durable fix; a raised number goes stale on the next
  model or card. Setting an explicit value stays available for deliberate pins.
- **Correct the stale Non-goal** in `add-gpu-tuning-ui` so the wrong route and
  the "offload lives there already" claim stop being cited as settled.

## Capabilities

### Modified Capabilities

- `local-providers`: placement is visible in the sidebar and editable per model.

## Non-Goals

- **Not** client-side placement maths. llama-skein owns the decision and the
  counterfactual; opencode displays what `/api/fit` reports and writes back what
  the operator chooses. Reimplementing capacity arithmetic client-side is the
  failure `add-model-offload-tuning` already warned against.
- **Not** automatic correction. opencode SHALL NOT silently rewrite a placement
  flag on a working model. This mirrors llama-skein's non-goal.
- **Not** MoE offload tuning (`--n-cpu-moe` / `--cpu-moe`). The contract accepts
  those, but the host A failure is dense-layer placement; MoE controls are a
  follow-up once this pattern is proven.
- **Not** a change to placement-based routing. `ctx-aware-subagent-placement`
  owns the scorer; note that its `fit_level×1000` term is affected by the
  llama-skein grading fix and needs its own follow-up.

## Open Questions

- **Where the control lives.** Folding placement into `DialogTuning` mixes
  host-wide tuning with per-model settings, and that conflation is part of why
  this was missed. Extending `DialogModelCtx` into a per-model dialog covering
  both ctx and placement is likelier right — but "Context" is a poor name for it,
  and renaming a surface operators know has its own cost.
- **How loud the warning should be.** A genuinely hybrid model on a small card is
  correct and must not nag. The signal should key on `under_offloaded`
  (avoidable) rather than `run_mode` (which is also true for correct hybrids).
- **Restart cost.** A placement patch reloads the model and drops the session's
  loaded state. `DialogModelCtx` already faces this; whatever it does should be
  matched, and the cost stated before the write, not after.

## Impact

- `packages/tui/src/local/llama-skein/gen/`, `packages/opencode/src/local/llama-skein/gen/`
  — regenerated for `under_offloaded`.
- `packages/tui/src/feature-plugins/sidebar/context.tsx` — placement indicator.
- `packages/tui/src/component/dialog-model-ctx.tsx` or a sibling — the control.
- `openspec/changes/add-gpu-tuning-ui/proposal.md` — corrected Non-goal.
- Depends on llama-skein `flag-under-offloaded-models` for `under_offloaded`;
  the `run_mode` fallback ships without it.
