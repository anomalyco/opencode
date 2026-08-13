# Links

## Related

- `add-gpu-tuning-ui` (this repo, complete) — built the tuning dialog this change
  extends. Its Non-goal explicitly excluded per-model placement editing on the
  stale premise that "ctx size / offload live there already" (and cited the wrong
  route). Task 8 corrects that note; the completed tasks are left alone.
- `ctx-display-and-overflow-correctness` (this repo) — the sibling problem for
  context: the sidebar showed a number that was not the enforced limit. Same
  shape as this change for placement, and it establishes the pattern of reading
  the enforced value rather than the advertised capacity.
- `ctx-aware-subagent-placement` (this repo) — owns the scorer whose
  `FIT_RANK`/`rank * 1_000` term (`packages/opencode/src/local/placement.ts:81-86`,
  `:189`) changes meaning once llama-skein grades placement. It also owns
  `HOST_PACED_PENALTY`. This change does not touch the scorer; see tasks 9–10.
- `model-gallery-ui` (this repo) — will surface per-model config more broadly;
  whatever surface task 1 chooses should not conflict with it.
- `provider-capacity-truth` (this repo) — same failure family: skein read
  `gpu_util_pct` instead of the `inference` block and skipped idle hosts. Another
  case of the host reporting the truth in a field no client read.

## Blocked by

- androidand/llama-skein#24

  llama-skein `declare-placement-intent` — supplies the safe write path this
  control needs. Today there is no way to *remove* `n_gpu_layers` via the patch
  contract, and the only workaround (patching the whole `cmd`) corrupts `${PORT}`.
  #24 Phase 4 makes placement a structured field, so removing a pin is deleting a
  field. Its Phase 1 `declared`/`reason` fields also let this control present
  placement as a *choice* rather than a warning — the distinction the sidebar
  indicator needs so it does not nag about correct hybrid placements.

- androidand/llama-skein#23

  llama-skein `flag-under-offloaded-models` — supplies `ModelFit.under_offloaded`
  and fixes `perf_class` for pinned placement. Partial dependency: tasks 2–4
  (the sidebar indicator) ship against today's contract using `run_mode` +
  `vram_required_mb`. Tasks 7 and 10 need it.

## Tracker note

`specsync` in this repo resolves the target to **`anomalyco/opencode`** via
`gh-set-default` — the upstream, not the fork. Always pass
`-repo androidand/opencode-skein` explicitly; without it a sync would file this
change's issue in the upstream repo.

## Sequencing notes

Do not implement a client-side workaround for the `perf_class` bug. The existing
`HOST_PACED_PENALTY` is already one workaround for the `fit_level` inversion, and
stacking a second on top of a server field that asserts something untrue is how
this class of bug became invisible in the first place. Fix it in llama-skein.

Task 1 is a genuine open question, not a formality: putting per-model placement
into the host-wide `DialogTuning` would repeat the conflation that hid this gap.
Resolve it before writing UI code.
