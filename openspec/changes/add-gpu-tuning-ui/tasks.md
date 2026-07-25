# Tasks: add-gpu-tuning-ui

Depends on llama-skein `add-gpu-tuning-profiles` being merged + spec published.

- [x] 1. Regenerate the llama-skein TS client: `bun run build:llama-skein-client`
       from `packages/opencode`; verify `getTuning`, `listTuningProfiles`,
       `patchTuning`, and `effective_flags` appear in
       `src/local/llama-skein/gen/`. Commit the regen.
       Validation: `grep -r "getTuning\|effective_flags" packages/opencode/src/local/llama-skein/gen packages/tui/src/local/llama-skein/gen`

- [x] 2. Tuning dialog (`packages/tui/src/component/dialog-tuning.tsx`, new):
       resolve provider baseURL, `getTuning`, render detected gfx + verified
       badge + effective-flags panel (each value tagged recommended/override);
       controls per design D2 — master enable toggle, tri-state flash-attn
       (Recommended/On/Off), parallel stepper, MTP tri-state (On
       disabled+hinted when unverified), free-text extra_args, and a
       "Reset to recommended" action; Apply → `patchTuning` (null clears an
       override) with the sidebar's abort/stale guard; toast that reload is
       needed. Model on `dialog-model-ctx.tsx`.
       Validation: `cd packages/tui && bun run typecheck`

- [x] 3. Command + keybind: register `tuning.show` (palette `/tuning`) in
       `app.tsx` opening the dialog; add to `config/keybind.ts` command map.
       Disabled when the current provider has no `/api/tuning`.
       Validation: `cd packages/tui && bun run typecheck`

- [x] 4. Sidebar profile badge (`packages/tui/src/feature-plugins/sidebar/
       context.tsx`): fold a `getTuning` read into the EXISTING hardware poll
       effect (no new loop), render `gfx… ✓ tuned` / `gfx… · default` when
       local + available; clickable → opens the tuning dialog. Reuse the
       existing cancelled-flag/abort guard.
       Validation: `cd packages/tui && bun run typecheck`

- [x] 5. Repo validation: `bun run typecheck` in `packages/opencode` and
       `packages/tui`; `cd packages/opencode && bun test test/local`.
