# Retire fork compatibility shims and adopt upstream implementations

## Why

The fork carries code whose only reason for existing is that upstream moved and we
did not follow. It is not a fork feature. Nobody chose it. It accumulated because a
sync was easier to finish by re-creating the old world locally than by adapting to
the new one.

The 2026-08-11 sync to `0d927ba03f` made the cost visible. The merge resolved
`package.json` and several source files as "ours", which silently reverted upstream's
catalog (opentui 0.4.5 → 0.3.4, effect beta.83 → beta.74) and kept pre-refactor copies
of files upstream had since rewritten. The build broke in four places, the binary
crashed at schema-construction time, and none of it was a fork feature failing — it
was drift presenting as breakage.

The distinction this change enforces:

- **Fork feature** — something we added for a reason we can name (loop detection,
  llama-skein/local provider discovery, beads sync, peers tool, fork distribution
  targets, themed loading). These stay, and `fork/manifest.json` is their register.
- **Drift** — a local copy, shim, or stale pattern that exists only because upstream
  changed. These have no defenders and must be deleted in favour of upstream's version.

Drift is worse than dead code. Dead code is inert; drift compiles, runs, and quietly
diverges from upstream until a sync detonates. It also inflates the merge-conflict
surface on every future sync, which is the tax `sustainable-upstream-sync` is trying
to lower.

## What changes

Three concrete surfaces, measured on `dev` at `0d927ba03f`:

**1. The legacy logger shim.** `packages/core/src/util/log.ts` (98 lines) re-implements
a logger upstream deleted in #31310 ("replace legacy logger with Effect logging"). Its
own header documents the retirement path and admits it is a stopgap. 17 call sites
across 5 fork files (`local/sync.ts` 9, `local/placement.ts` 3, `beads/sync.ts` 3,
`provider/provider.ts` 2, `beads/beads.ts` 0). Migrate callers to Effect logging,
delete the file and its `fork/manifest.json` entry.

**2. The legacy `defaultLayer` DI pattern.** Upstream's `unify-layer-node-graph` work
replaced per-service `defaultLayer` exports with the `LayerNode` graph. The fork still
carries 167 references across 21 files (11 fork-only, 10 upstream-existing), which is
the bulk of the ~260 outstanding typecheck errors. Upstream's replacement is
`AppNodeBuilder.build(X.node)` / `LayerNode.compile(...)`.

**3. Divergence in files that should be upstream-identical.** Files carrying no fork
feature but differing from upstream — the sync already surfaced `project.ts`
(inlined duplicates of `@opencode-ai/schema/project`), `app-runtime.ts`, `layer-node.ts`
(a gutted copy, 285 lines short), `tool/registry.ts`, `session/prompt.ts` and
`installation/index.ts`. Those six are fixed; this change sweeps for the rest.

The sweep is the deliverable, not just the three known instances. Every fork-modified
file gets classified as *feature* or *drift*, and drift is reverted to upstream.

## What does not change

- No fork feature is removed. `bun run fork:verify` must report 10/10 owned and
  7/7 patched at every phase boundary.
- The fork's distribution identity (`ForkDistribution`) stays; the updater must never
  point at upstream.
- Deliberate divergence is allowed to remain **if it is recorded**. The output of the
  sweep is that every remaining difference from upstream is either in
  `fork/manifest.json` or gone.

## Impact

- Cuts the merge-conflict surface for every future sync — the motivating goal of
  `sustainable-upstream-sync`.
- Clears ~260 typecheck errors, restoring `bun run typecheck` as a usable gate. Today
  it fails on `dev`, so it catches nothing.
- Removes an entire class of sync failure: the 2026-08-11 build break was drift, not
  feature breakage, and would not have happened against an upstream-parity tree.

## Risks

- `session/prompt.ts` and `provider/provider.ts` are large, carry real fork features,
  and are manifest-patched. They need per-hunk classification, not wholesale restore.
- Test files are the largest single block of `defaultLayer` use (~90 refs). Migrating
  them changes what the suite proves; the suite must be run, not just typechecked.
