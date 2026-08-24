# Design: per-model-placement-controls

Resolves the three Open Questions in `proposal.md`. Decided 2026-08-14.

## D1. Extend `DialogModelCtx`, do not add rows to `DialogTuning`

**Decision:** placement lives in `DialogModelCtx`, retitled. `DialogTuning` is not
touched.

**Why the signatures already decide this.**

```
DialogTuning(props:   { providerID: string })
DialogModelCtx(props: { providerID: string; modelID: string })
```

Placement is per-model. `DialogTuning` has no `modelID` and would have to acquire one
from session state to patch anything — which is not a missing parameter, it is a
category error. It edits `PATCH /api/tuning`, a host-wide endpoint whose settings
apply to every llamacpp launch on the box. Putting a per-model write behind a
host-wide surface is how an operator ends up believing they changed one model and
changed all of them, or the reverse.

The conflation is also the proximate cause of this gap. `add-gpu-tuning-ui` shipped
four host-wide knobs, an operator went looking for a per-model setting in the place
that said "GPU tuning", and concluded none existed. Adding placement rows there would
make that dialog *more* right-looking and *no* more correct.

**What `DialogModelCtx` already provides**, so this is extension rather than
construction:

- `providerID` **and** `modelID` — the exact scope a placement patch needs.
- A `getModelFit` read at line 60 whose response already carries `run_mode`,
  `host_resident_mb`, and the whole `placement` object. The data is already in hand;
  today only `configured_ctx` is used.
- A patch path (`setCtxSize`, line 142) with the abort/stale guard already solved.
- The reload-cost problem already confronted — ctx changes reload the model too, so
  there is one answer to give, not two.

**Naming.** The title is `` `Context — ${modelName()}` `` (line 172) and the sidebar
click target is the word "Context". Both become wrong once the dialog also does
placement.

Retitle to `` `${modelName()}` `` with the section headings inside carrying "Context"
and "Placement". The model name is the honest title: this is the per-model settings
dialog, and it always was — "Context" described its only row, not its subject.

The sidebar keeps **two** click targets, both opening this one dialog: the Context
label and bar (as today), and the VRAM/placement area. Operators who learned "click
Context" lose nothing, and the placement reading becomes clickable where it is read.
`DialogTuning` keeps the `gfx… · tuned` badge, which is genuinely host-wide.

**Rejected: a third dialog.** A separate `DialogModelPlacement` would duplicate the
fit read, the patch plumbing, and the abort guard, and would force an operator to
know in advance whether their problem was "context" or "placement" — which is
precisely what they cannot know, since a marginal fit is a *joint* property of both.

## D2. The indicator keys on `under_offloaded`, never on `run_mode` alone

**Decision:** warn only on avoidable offload. `run_mode: "cpu_offload"` alone is not
a warning condition.

A correct hybrid placement on a card too small for the model is not a fault, and a UI
that flags it teaches operators to ignore it. Until llama-skein ships
`under_offloaded` (#23), the fallback is the mechanical pair —
`run_mode == "cpu_offload"` **and** `vram_required_mb <= vram_total_mb` — which
approximates "avoidable" from fields that exist today.

**Known limit, accepted deliberately.** Neither signal can see an engine-side `--fit`
split. Measured on host A: `host_resident_mb` stayed `0` and `fit_level` stayed
`marginal` at both 32.6 tok/s and 14.7 tok/s. So the indicator will miss exactly the
offload the planner itself causes. That is llama-skein's blind spot (#23 tasks
12c/12d) and must not be papered over here with client-side inference — the client
guessing at a split the server cannot see is how the `HOST_PACED_PENALTY` workaround
came to exist, and that workaround is now itself defeated.

## D3. Reload cost is stated before the write, matching ctx

**Decision:** reuse whatever `DialogModelCtx` already does for ctx changes; do not
invent a second convention.

Both writes reload the model and drop its loaded state. One dialog making the same
promise twice in two different ways would be worse than either. If the existing ctx
flow states the cost inadequately, fix it once for both rather than adding a
placement-specific warning.

## Consequence for the tasks

Task 1 is answered; task 5 builds inside `dialog-model-ctx.tsx` rather than choosing
a home first. The retitle and the second sidebar click target are small additions to
task 3 rather than a separate workstream. Nothing here depends on llama-skein landing
first — the indicator ships on today's contract, and only the `under_offloaded`
preference and the "remove the pin" wording wait on #23/#24.
