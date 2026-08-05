# Unify the split Effect DI graphs (AppLayer vs. LayerNode)

## Why

The server has two independent, hand-maintained dependency-injection graphs for
Effect services, and nothing keeps them in sync. A service can be fully and
correctly wired into one and silently absent from the other — TypeScript
typechecks each graph independently and cannot see the gap.

**Graph A — legacy, hand-rolled, no compile-time dependency check.**
`packages/opencode/src/effect/app-runtime.ts` builds `AppLayer` via
`Layer.mergeAll(...)` over ~40 `X.defaultLayer` exports, where each
`defaultLayer` is manually written as
`layer.pipe(Layer.provide(Dep1.defaultLayer), Layer.provide(Dep2.defaultLayer), ...)`.
`packages/opencode/src/effect/bootstrap-runtime.ts` (`BootstrapLayer`) and
`packages/opencode/src/session/prompt.ts` (`SessionPrompt.defaultLayer`) follow
the same style. Nothing checks that a `.pipe(Layer.provide(...))` chain
actually lists every dependency the wrapped layer needs — a missing entry is a
silent gap, not a compile error.

**Graph B — `LayerNode`, compile-time-checked.**
`packages/core/src/effect/layer-node.ts` defines `LayerNode.make(layer, deps)`
and `LayerNode.group(nodes)`. Its `CheckDependencies` type produces an actual
TypeScript error (`{"Missing dependencies": ...}`) when a node's declared
`deps` don't cover what the wrapped layer requires. This is the graph that
matters at runtime: `packages/opencode/src/server/routes/instance/httpapi/server.ts`
builds the real HTTP API server — the one every TUI session and `opencode run`
invocation actually talks to — from `LayerNode.group([...])` /
`LayerNode.buildLayer(app)`, not from `AppLayer`.

Because the two graphs are separately maintained, a service correctly added to
Graph A gives zero signal about Graph B, and vice versa. This has caused three
independent incidents:

1. **2026-08-02 (today).** `AutoMode.Service`
   (`packages/opencode/src/auto-mode/service.ts`) was wired into `AppLayer`
   and, after a first fix attempt, into `SessionPrompt.defaultLayer` — but was
   never added to the `LayerNode.group([...])` node list in
   `server/routes/instance/httpapi/server.ts`. Since that list is what
   actually serves TUI/`opencode run` sessions, every prompt crashed at
   runtime with `Service not found: @opencode/AutoMode`, even though
   `bun run typecheck` passed cleanly on both attempts. Fixed by adding
   `AutoMode.node` to `server.ts`'s node list.
   - Side finding: `SessionPrompt.defaultLayer`'s `.pipe(Layer.provide(...))`
     chain was sitting at exactly 20 arguments — TypeScript's `pipe()`
     overload ceiling. A 21st argument produces a hard arity error
     (`TS2554: Expected 0-20 arguments, but got 21`) and the whole chain's
     inferred `R` degrades to `unknown`, breaking a dozen unrelated files that
     structurally depend on that type. The workaround (folding the new layer
     into an existing `Layer.mergeAll(...)` argument instead of adding a new
     `.pipe()` slot) works but is a trap for the next person who doesn't know
     the ceiling exists.
2. **2026-07-19** (`openspec/changes/intake-20260718-203617-8301aa/.skein/agent-notes.md`):
   identical failure mode for `PatternDetection` —
   "`PatternDetection.node` missing from `LayerNode.make` at prompt.ts:1779" →
   "typecheck error + service-not-found in tests."
3. **`openspec/changes/retire-auto-reply/`** (open, unstarted): documents the
   _inverse_ failure mode. `auto-reply`, `automation/automation-features`,
   `pattern-detection`, and `scheduler` all export `layer`/`defaultLayer` but
   were **never** given a `LayerNode` `node` and never added to `server.ts` at
   all — so instead of crashing, they are silently inert. `opencode auto-reply
--enable` reports success and does nothing, which that proposal calls out
   as "worse than not having it. It cost real debugging time to establish
   that it is inert."

Same root cause, three incidents, two opposite symptoms (silent no-op vs.
runtime crash) depending on which side of the split a service lands on. This
is a systemic gap, not a one-off mistake, and it will keep recurring for every
new service until the graphs are unified or guarded.

## What Changes

- Audit every service that exports a legacy `layer`/`defaultLayer` pair and
  determine whether it also exports and registers a `LayerNode` `.node` in
  `server/routes/instance/httpapi/server.ts`'s node list. Produce a complete
  mismatch list in both directions.
- Decide and document the canonical mechanism going forward. `LayerNode` has
  compile-time dependency checking; the legacy `.pipe(Layer.provide(...))`
  style does not and has a silent arity ceiling. Recommendation: migrate
  `app-runtime.ts`'s `AppLayer` and `bootstrap-runtime.ts`'s `BootstrapLayer`
  onto `LayerNode`, retiring the hand-rolled `defaultLayer` composition
  pattern where it duplicates what a `.node` already expresses.
- If a full migration is judged too large for one change, land a regression
  guard instead (e.g. a script/CI check that fails when a service has a
  `defaultLayer` export but no corresponding `.node` registered in
  `server.ts`, or vice versa) so this class of bug is caught before merge
  rather than at runtime.
- Flag `session/prompt.ts`'s `SessionPrompt.defaultLayer` specifically — it is
  at the `.pipe()` argument ceiling today and the next added dependency will
  hit the same trap unless the chain is restructured (e.g. via `LayerNode`,
  or by pre-emptively grouping more entries into `Layer.mergeAll(...)`).
- Cross-reference `openspec/changes/retire-auto-reply/` — its Phase 1 audit
  (auto-reply, automation-features, pattern-detection, scheduler) is the same
  "who's actually registered in the graph" question from the opposite
  direction, and should reuse this change's audit method rather than
  duplicating it.

## Non-Goals

- Not rewriting every service's DI wiring in one change — this is audit,
  canonicalization decision, and (if in scope) a regression guard, not a
  wholesale rewrite.
- Not deleting the auto-reply/automation/pattern-detection/scheduler code —
  that is `retire-auto-reply`'s job; this change only supplies the audit
  method and flags the shared root cause.

## Impact

- Affected: `packages/opencode/src/effect/app-runtime.ts`,
  `packages/opencode/src/effect/bootstrap-runtime.ts`,
  `packages/opencode/src/session/prompt.ts`,
  `packages/opencode/src/server/routes/instance/httpapi/server.ts`,
  `packages/core/src/effect/layer-node.ts`, and every service module that
  exports `defaultLayer`/`node`.
- No user-facing behavior change is intended beyond eliminating a class of
  runtime crash / silent-dead-service bug.
