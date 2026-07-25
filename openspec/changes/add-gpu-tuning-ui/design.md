# Design: add-gpu-tuning-ui

## D1 — Client regen, not hand-authored types

Run `bun run build:llama-skein-client` after the llama-skein spec lands. The
new `getTuning`, `listTuningProfiles`, `patchTuning` SDK methods and the
`effective_flags` field come from codegen. No manual edits to
`src/local/llama-skein/gen/`.

## D2 — Dialog modeled on the existing DialogModelCtx / offload flow

The fork already has `dialog-model-ctx.tsx` (edit ctx size) and the offload
recommendation flow, both talking to llama-skein per-model endpoints. The
tuning dialog follows the same shape:

- Opened via a new `tuning.show` command (palette `/tuning`) and from a click
  on the profile indicator in the sidebar.
- Resolves the current session's provider baseURL (same helper the sidebar
  meter uses), builds a `LlamaSkeinClient`, calls `getTuning`.
- Non-llama-skein providers (no `/api/tuning`) → the command is disabled /
  the dialog shows "tuning unavailable for this provider".

**Controls (recommended, never forced — mirrors llama-skein D6):**
- **Master enable toggle**: "Auto-tune for this GPU" on/off. Off = the server
  launches the `cmd` verbatim; all controls below disabled.
- flash attention: tri-state — Recommended (from profile) / On / Off. Choosing
  On/Off writes an override; "Recommended" clears it.
- parallel slots: numeric stepper; a "recommended (1)" hint; can be set to any
  value.
- MTP: Recommended / On / Off (On disabled+hinted when profile.verified is
  false for this gfx).
- **Extra args**: a free-text field mapping to `extra_args` for flags the
  curated controls don't cover (e.g. `--cache-type-v q4_0 -ub 2048`).
- a read-only "effective flags" panel showing the launch delta, with each
  value tagged `recommended` or `override`.
- a "Reset to recommended" action clearing all overrides.

Apply → `patchTuning` (nullable fields clear an override back to recommended);
show a toast that running models pick it up on next load. Reuse the
abort/stale-guard pattern from the sidebar fix so a provider switch mid-request
can't write back stale data.

## D3 — Sidebar indicator

Extend the sidebar (same file as the VRAM meter, `feature-plugins/sidebar/
context.tsx`) with a one-line profile badge when the provider is local and
answers `/api/tuning`: e.g. `gfx1201 ✓ tuned` (accent) or `gfx1100 · default`
(muted, unverified). Polled alongside the existing hardware poll, reusing its
baseURL effect and abort guard (no new polling loop).

**Why fold into the existing poll:** the sidebar already polls the same host
every 30s; adding a second loop would double requests and re-introduce the
stale-sample class of bug we just fixed. One effect, two reads.

## D4 — Failure / degradation

- `getTuning` 404 / error → treat as "no tuning" (older llama-skein, or
  non-llama-skein backend): hide the badge, disable the command. Never error
  the sidebar.
- The whole feature is additive and gated on the endpoint existing, so a
  mixed fleet (some hosts updated, some not) works.
