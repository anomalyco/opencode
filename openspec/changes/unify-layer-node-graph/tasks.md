# Tasks: unify-layer-node-graph

## Phase 1: Audit the split

- [ ] 1.1 List every service module that exports `defaultLayer` (the legacy
      `layer.pipe(Layer.provide(...))` style) across `packages/opencode/src`
      and `packages/core/src`. - `grep -rln "export const defaultLayer" packages/opencode/src packages/core/src` - Validation: complete file list recorded in `.skein/agent-notes.md`.
- [ ] 1.2 For each file from 1.1, check whether it also exports `node` (a
      `LayerNode.make(...)` / `LayerNode.group(...)` call) and whether that
      `node` is actually present in the `LayerNode.group([...])` list in
      `packages/opencode/src/server/routes/instance/httpapi/server.ts`. - Validation: table of `{service, has defaultLayer, has node, node
      registered in server.ts}` recorded in `.skein/agent-notes.md`.
- [ ] 1.3 Flag every row where `defaultLayer` exists but the `node` is missing
      or unregistered — these are live crash risks (the `AutoMode` /
      `PatternDetection` failure mode: reachable via `AppLayer`/direct calls,
      absent from the graph that actually serves requests). - Validation: list of mismatches, each with the call site(s) that would
      trigger a runtime `Service not found` if exercised.
- [ ] 1.4 Flag every row where a `node` exists but is only reachable through
      `LayerNode.group([...])` in server.ts and never through `AppLayer`/
      `BootstrapLayer` — confirm whether anything outside the HTTP server path
      (CLI-only commands, `bootstrap-runtime.ts` consumers) needs that service
      and would break. - Validation: list of any such gaps, or explicit note that none exist.

## Phase 2: Canonicalize

- [ ] 2.1 Decide the canonical DI mechanism (recommendation: `LayerNode`,
      since `CheckDependencies` gives compile-time missing-dependency errors
      that the legacy `.pipe(Layer.provide(...))` style cannot). Record the
      decision and rationale in `design.md`.
- [ ] 2.2 If migrating: port `app-runtime.ts`'s `AppLayer` and
      `bootstrap-runtime.ts`'s `BootstrapLayer` onto `LayerNode.group(...)` /
      `LayerNode.buildLayer(...)`, reusing each service's existing `.node`
      export instead of re-deriving dependencies by hand. - Validation: `bun run typecheck` and `bun test` green in
      `packages/opencode` after the port; `opencode run` and TUI session
      smoke-tested manually per `[[run]]`-style verification (see
      `AGENTS.md` / project conventions for how this repo verifies CLI
      changes).
- [ ] 2.3 If a full migration is descoped: implement a regression guard
      instead — a script (invoked from CI or `bun run typecheck`) that fails
      when a service exporting `defaultLayer` has no corresponding `.node`
      registered in `server.ts`'s node list, and vice versa. - Validation: guard fails on a deliberately-reintroduced version of
      today's bug (temporarily remove `AutoMode.node` from server.ts and
      confirm the guard catches it), then passes with the fix restored.

## Phase 3: Fix the `.pipe()` arity trap

- [ ] 3.1 Confirm the current argument count of every hand-rolled
      `.pipe(Layer.provide(...), ...)` chain in the codebase (`app-runtime.ts`,
      `bootstrap-runtime.ts`, `session/prompt.ts`, and any others found in
      Phase 1). Flag any chain at or near TypeScript's `pipe()` overload
      ceiling (20 arguments) as fragile. - Validation: list of chains with their current argument counts.
- [ ] 3.2 Restructure `SessionPrompt.defaultLayer`
      (`packages/opencode/src/session/prompt.ts`) so it is not sitting at the
      ceiling — either by migrating it to `LayerNode` (if 2.2 is in scope) or
      by pre-emptively grouping more of its dependencies into the existing
      `Layer.mergeAll(...)` argument so future additions don't require a new
      top-level `.pipe()` slot. - Validation: `bun run typecheck` passes; adding a throwaway extra
      `Layer.provide(SomeExisting.defaultLayer)` no longer produces
      `TS2554`.

## Phase 4: Reconcile with retire-auto-reply

- [ ] 4.1 Once `openspec/changes/retire-auto-reply/` Phase 1 (its own audit of
      auto-reply/automation-features/pattern-detection/scheduler) lands,
      cross-check its findings against this change's Phase 1 table — both are
      answering "is this service actually registered in the graph that
      matters" and should agree. - Validation: no contradictions between the two audits; any found are
      resolved and noted in both changes.

## Phase 5: Verification

- [ ] 5.1 Full build and test pass. - Validation: `bun run typecheck` (root, all packages) and
      `bun test packages/opencode --timeout 60000` green.
- [ ] 5.2 Manual smoke test: start a TUI session and send a real prompt that
      exercises tool permission checks (confirms the actual HTTP API graph,
      not just `AppLayer`, is exercised). - Validation: no `Service not found` errors in server logs.
