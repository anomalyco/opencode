# Tasks: retire-legacy-compat-shims

Phase order matters. Each phase ends with `bun run fork:verify` (10/10 owned, 7/7
patched) and a build smoke test. Do not start a phase until the previous one is green.

## Phase 0: Baseline (done during the 2026-08-11 sync)

- [x] 0.1 Restore upstream catalog in `package.json`; keep only the 5 fork scripts
- [x] 0.2 Restore `patches/solid-js@1.9.10.patch`; drop 3 orphaned downgrade-era patches
- [x] 0.3 Revert drift in `project.ts`, `app-runtime.ts`, `layer-node.ts`, `tool/registry.ts`
- [x] 0.4 Repoint phantom imports (`max-steps.txt` → core `max-steps`, `withStatics` → `statics`)
- [x] 0.5 Re-apply `ForkDistribution` onto upstream's `installation/index.ts` (21 sites)
- [x] 0.6 Fix `Schema.Defect` → `Schema.Defect()` (beta.83 made it a function)
- [x] 0.7 Delete junk file `packages/core/src/effect/dfdf`
- [x] 0.8 Confirm green: build + smoke test + `fork:verify`

## Phase 1: Classify the divergence surface

- [ ] 1.1 Enumerate every file differing from `upstream/dev` under `packages/*/src`
      and `packages/*/test`, excluding generated `gen/` trees
- [ ] 1.2 Classify each as **feature** (named fork capability) or **drift** (local copy,
      shim, or stale pattern). Record the verdict and a one-line reason per file
- [ ] 1.3 Cross-check every *feature* verdict against `fork/manifest.json`; anything
      claiming feature status but absent from the manifest is drift until argued otherwise
- [ ] 1.4 Publish the classification table in this change directory as `inventory.md`

## Phase 2: Retire the legacy logger shim

- [x] 2.1 Migrate `packages/opencode/src/local/sync.ts` (9 call sites) to Effect logging
- [x] 2.2 Migrate `packages/opencode/src/local/placement.ts` (3 call sites)
  - `pick()` kept plain deliberately: it documents a synchronous slot reservation
    ("before any await"), and an `Effect.gen` yield boundary through that would be a
    real concurrency bug. It now returns a `PickOutcome` discriminated union and
    `tool/task.ts` logs in Effect context.
- [x] 2.3 Migrate `packages/opencode/src/beads/sync.ts` (3 call sites)
- [x] 2.4 Migrate `packages/opencode/src/provider/provider.ts` (2 call sites) — manifest-patched,
      keep the `mergeDiscoveredModel` marker intact
  - Plain promise chain, so `discoverOpenAICompatibleModels` now returns
    `{ models, warnings }` and the Effect caller logs. Same shape as `pick` below.
- [x] 2.5 Drop the unused import in `packages/opencode/src/beads/beads.ts` (0 call sites)
- [x] 2.6 Delete `packages/core/src/util/log.ts` and its `fork/manifest.json` `owned` entry
- [x] 2.7 Confirm no importer of `@opencode-ai/core/util/log` remains
      (note: `packages/console/core/src/util/log.ts` is a different, upstream file — leave it)

## Phase 3: Retire the legacy `defaultLayer` DI pattern

- [ ] 3.1 Revert the 10 upstream-existing files that use `defaultLayer` to upstream,
      re-applying fork features per the Phase 1 classification
- [ ] 3.2 Migrate the 11 fork-only files to `LayerNode` — delete `export const defaultLayer`,
      keep `export const node`
- [ ] 3.3 Migrate remaining call sites: `Effect.provide(X.defaultLayer)` →
      `Effect.provide(AppNodeBuilder.build(X.node))`
- [ ] 3.4 Migrate the test block (~90 refs, largest single group), incl. fork-only
      `test/loop/loop.test.ts` and `test/loop/queue-mode.test.ts`
- [ ] 3.5 Run the suite — not just typecheck — and confirm no test silently weakened

## Phase 4: Regenerate the SDK

- [ ] 4.1 Establish why `sdk.gen.ts` references symbols absent from `types.gen.ts`
      (both generated, both fork-modified — determine which is stale)
- [ ] 4.2 Regenerate via `script/generate.ts`; confirm the fork's llama-skein client
      additions survive regeneration
- [ ] 4.3 Confirm downstream consumers typecheck (`packages/plugin`, `packages/tui`)
- [ ] 4.4 Coordinate with the in-flight llama-skein client work before landing

## Phase 5: Make the gate real

- [ ] 5.1 `bun run typecheck` passes clean at the root
- [ ] 5.2 Extend `script/fork-verify.ts` to fail when a file differs from upstream
      without a `fork/manifest.json` entry — drift becomes a build error, not a discovery
- [ ] 5.3 Document the feature-vs-drift rule in `FORK_WORKFLOW.md`
- [ ] 5.4 Add the classification step to the sync runbook so the next sync starts here
