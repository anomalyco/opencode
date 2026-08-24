# Spec delta: local-providers (ctx-aware-subagent-placement)

## MODIFIED

### Local sub-agent placement is context-aware

- Sub-agent placement MUST exclude any candidate provider/model whose usable
  context cannot serve the sub-agent's estimated prompt size. Usable context is
  `max_safe_ctx` (or a per-model `/api/fit` probe at the estimated size), never
  `fit_level` alone. Context adequacy is a hard eligibility filter applied
  before scoring — a model that cannot fit the prompt is never selected, no
  matter how well it fits VRAM or how fast it is.

### Local sub-agent placement is slot-aware

- Placement MUST honor a provider's inference slot capacity
  (`slots_total` vs live in-flight) via an in-process reservation keyed by
  provider, held for the sub-agent's lifetime and released on completion.
- A provider with no free slot MUST NOT be selected, including on the
  inherit-parent fallback path. Two concurrent sub-agents within one turn MUST
  NOT both be placed on the same single-slot (`--parallel 1`) provider;
  concurrent placement decisions MUST serialize their reservations rather than
  relying on a soft after-the-fact penalty.

## ADDED

### Bounded local sub-agent wait

- A sub-agent request dispatched to a local provider MUST have a wall-clock
  ceiling. A request that remains queued (e.g. behind a busy single slot) past
  the ceiling MUST be re-placed or fall back, so it cannot hang indefinitely
  waiting on a silently-queued llama-skein request.
