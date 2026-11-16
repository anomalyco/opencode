---
title: Optional per-call Code Mode timeouts
description: Let agents bound an individual tool invocation without changing provider defaults.
status: in-progress
date: 2026-11-15
size: bounded
specs:
  - ../../specs/v2/tools.md
---

## Intent

Issue #64165 observed three parallel MCP searches keeping an execute call busy while a steer remained pending; #54220 tracks missing execution budgets. The user selected optional agent-chosen per-call timeouts, with no new default deadline or provider-specific rules. Implement this for Code Mode calls, the path used in the report. Native model tool input schemas and HTTP endpoints remain unchanged.

## Acceptance criteria

- `tools.example(input, { timeoutMs: 120000 })` rejects only that invocation when its budget expires; two successful siblings remain available through `Promise.allSettled`.
- Tool implementations receive their original input without timeout control fields. Invalid options fail before execution.
- Calls without a timeout retain existing behavior, including the MCP execution configuration and existing interpreter limits.
- Timeout becomes an ordinary catchable tool failure and invokes the after hook once with failure; caller interruption remains interruption. Pending Promise tool work receives cancellation through its existing scope.
- A real session can admit a steer during the pending call, settle execute after the per-call timeout, and deliver that steer exactly once.
- Release exposure follows the `codemode_tool_timeouts` feature flag. Disabled exposure neither advertises nor accepts call options; local/dev enable the capability without enabling any deadline by default.

## Design

Add opt-in `toolTimeouts?: boolean` host capability to CodeMode options, default false. With it enabled, ordinary and idempotent tool calls accept a second options object containing optional positive safe-integer `timeoutMs`. Decode that object once at the tool bridge. Wrap that invocation's executable effect with Effect.timeoutOrElse inside existing lifecycle hooks. Expiry fails with a ToolError naming the tool and budget, so existing promise rejection and Core nested-call status handling remain responsible for settlement. Existing shorter leaf or interpreter deadlines still win. The timeout covers the opted-in invocation, including any approval waits its implementation performs; no automatic retry is added.

Core resolves Flag.enabled("codemode_tool_timeouts") when building a snapshot, includes capability state in inventory/cache identity, passes it to CodeMode.make, and advertises syntax and cancellation semantics in execute guidance only when enabled. No MCP/provider detection or timeout defaults change. Durable library tools retain their single-argument contract; their cross-suspension budgets are outside this change. All production Core inventory entries are ordinary Code Mode tools.

The alternative, a generic default timer around every tool, was rejected because it changes unrelated long-running tools and approval waits. A second overall execute timer was rejected because the user requested per-call control only.

## Non-goals

No new default or maximum timeout policy; no provider/search classification; no change to the session drain, durable events, direct native model call schemas, MCP timeout configuration, or background jobs; no retries, progress UI, or durable-tool snapshot format changes.

## Spec delta

- D1 ADDED to specs/v2/tools.md: Experimental Code Mode per-call options are distinct from tool input, are explicitly requested, reject only the expired call, preserve existing earlier deadlines, request cancellation without guaranteeing remote rollback, and do not alter omitted-call behavior.
- D2 ADDED to packages/codemode/README.md: host capability and program syntax, option validation, hook/error behavior, and plain/idempotent scope.

## Docs impact

Update the library README, current tool semantic overview, and an Unreleased changelog entry. Keep actionable task details out of specs/v2 per its README.

## Decisions

- [Call timeout boundary](../../specs/v2/codemode-call-timeouts.md)

## Rulings

- [scope] Implement Code Mode calls only — this is the reported path and avoids changing native model tool input schemas — cost if wrong: medium, direct-only tools need a separate interface.
- [compatibility] No new timer unless the agent supplies timeoutMs — explicit user requirement — cost if wrong: low, omitted calls may still hang under existing limits.
- [timing] Existing earlier producer/interpreter limits remain authoritative — per-call control bounds waiting without bypassing producer policy — cost if wrong: low, a longer requested budget cannot extend a shorter leaf limit.
- [approval] Opted-in deadline includes tool-owned approval waits — no hidden pause policy or permission-service redesign — cost if wrong: medium, the explicitly bounded call may expire while awaiting a user.
- [library] Durable tools reject a second argument — Core's reported path uses plain tools and durable suspension needs its own contract — cost if wrong: low, reusable-library durable callers cannot use this feature yet.
- [isolation] Native worktree status returned thread_credential_required — created ignored .worktrees/per-call-timeouts from origin/dev with Git — cost if wrong: low, checkout remains separate.
- [docs] Use existing specs/v2 for current behavior and decision record, docs/plans for temporary execution plan — repository has no plans directory and forbids checklists in specs/v2 — cost if wrong: low, plan can be removed after work.
- [verification] Baseline Code Mode focused tests 185 pass, Core Code Mode 3 pass; root bun run check exits 0 with existing lint warnings — cost if wrong: low, rerun after changes.
- [delivery] Keep implementation local for review; no GitHub publication requested — cost if wrong: low, branch can be pushed later.
- [generation] The experimental flag expands the existing public Config schema; ran the official client generator and retained its one-line optional flag type addition — cost if wrong: low, no endpoint or native tool-input change.

## Verification so far

- T1 RED: new library suite had 4 passes and 29 expected failures before implementation. GREEN: 33 passes; 10 repeats produced 330 passes. Coordinator independently ran the focused library/promise/suspend/call-timeout suites: 254 passes, 0 failures.
- T2 RED: Core suite had 5 passes and 2 expected failures before wiring. GREEN: focused Core/flag/catalog/tool suites had 129 passes, 0 failures. Coordinator independently ran Code Mode and flag/catalog subset: 43 passes, 0 failures.
- Baseline real SessionRunner and MCP suites: 366 passes, 0 failures. Full root check passed before changes, with existing lint warnings.
- T3 sensitivity: disabling the feature only in the new test fixtures made both regressions fail immediately; restoring it produced 20 passes across 10 repeats. Coordinator independently ran the complete runner and MCP files: 368 passes, 0 failures, 1,801 assertions.
- The MCP integration uses the real registration, client, in-memory protocol transport, and server. Only the blocked request receives protocol cancellation; completed siblings remain successful, and a later call succeeds on the same connection.
- Full Code Mode suite: 1,674 passes, 0 failures across 44 files. Root bun run check: 35 successful tasks, exit 0, with pre-existing lint warnings. Official TypeScript checks through package typecheck:tsc pass for Code Mode and Core. Windows and the original authenticated Z.ai connection were not available for reproduction.

## Deferred

Direct native-tool call controls, durable-tool budgets across suspend/resume, provider-specific defaults, overall execute budgets, and root-cause diagnosis of the original Z.ai transport failure.

## Tasks

**Goal:** Give Code Mode agents optional per-invocation deadlines without changing omitted-call behavior.
**Architecture:** Library owns argument decoding and effect deadlines; Core owns experimental exposure; real session runner tests own steer-delivery proof.
**Tech stack:** Bun 1.4.4, TypeScript, Effect 4.1.0, existing TestClock and Core fixtures.
**Detail:** contracts
**Verify:** fast `bun test test/call-timeout.test.ts` in packages/codemode and `bun run script/test.ts test/codemode.test.ts` in packages/core; full `bun run check` at root, `bun test` in packages/codemode, focused runner/MCP suites in Core. Existing fast/full baseline commands passed before planning.
**Global constraints:** No dependencies, no default deadline changes, no new HTTP surface, no generated client edits. Use repository instructions and .opencode/skills/unit-tests. Each test must fail before implementation; tests exercise real boundaries with virtual time where possible. Coordinator commits; implementers do not run Git mutations. Flag `codemode_tool_timeouts`; library capability `toolTimeouts`; program option `timeoutMs`.

### T1: Library per-call control · design · standard model

**Owns:** packages/codemode/src/codemode.ts, packages/codemode/src/runtime/execute.ts, packages/codemode/src/tool-runtime.ts, packages/codemode/test/call-timeout.test.ts, packages/codemode/README.md.
**Depends on:** none.
**Consumes:** existing tool runtime, hooks, Effect cancellation, schemas.
**Produces:** CodeMode.make({toolTimeouts: true, tools}).execute(code) accepting ordinary/idempotent tool calls with second `{timeoutMs?: number}` argument.
Example: two echo calls and one pending call with timeoutMs 100 return fulfilled/fulfilled/rejected after TestClock.adjust(100); original tool input remains unchanged.
**Tests:** fast; new test file covers enabled/disabled options, omitted timeout, validation before side effects, empty and freeform input, scoped cancellation and hook settlement, partial success and ordinary catch, caller interruption; preserve durable single-argument behavior.
**Review:** yes — timeout must be catchable while interruption remains interruption.
**Docs:** D2 in owned README.
**Decision:** specs/v2/codemode-call-timeouts.md.
**Commit:** feat(codemode): support optional per-call timeouts.

### T2: Core exposure and guidance · design · standard model

**Owns:** packages/core/src/tool.ts, packages/core/src/codemode/tool.ts, packages/schema/src/config/flag.ts, packages/core/test/codemode.test.ts.
**Depends on:** T1.
**Consumes:** CodeMode.Options.toolTimeouts.
**Produces:** flag-controlled optional call options and model guidance in real Tool.Service snapshots; cache changes reflect the flag state.
**Tests:** fast; existing Core test harness proves two successes plus one timeout, original input preservation and nested row errors, flag-disabled rejection and no guidance, calls without timeout unchanged, flag-state cache refresh.
**Review:** yes — fresh config/flag state must not reuse incompatible cached runtimes or definitions.
**Docs:** coordinator applies D1 to specs/v2/tools.md and Unreleased entry `Experimental Code Mode tool calls can request a per-call timeout with { timeoutMs }, behind codemode_tool_timeouts; calls without it retain existing limits.`
**Decision:** specs/v2/codemode-call-timeouts.md.
**Commit:** feat(core): expose per-call Code Mode timeouts.

### T3: Session recovery proof · design · standard model

**Owns:** packages/core/test/session-runner.test.ts; packages/core/test/mcp.test.ts only if a real MCP transport integration test is needed beyond existing fixtures.
**Depends on:** T2.
**Consumes:** real Code Mode invocation support via Tool.Service and existing SessionRunner test fixtures.
**Produces:** regression proving pending steer is delivered exactly once after one parallel tool times out, preserving successful siblings and letting the next step continue; MCP abort propagation proof where practical using in-process server fixture.
**Tests:** fast TestClock session tests; live loopback MCP test when needed. Queue a model execute call containing three parallel calls; admit steer after the blocked call has actually started; assert pending before expiry, child failure and completed siblings after expiry, exactly one promotion, no remaining inbox item, continued model response.
**Review:** yes — verify real runner and actual tool execution, not a mocked drain or recreated scheduling algorithm.
**Docs:** coordinator records exact proof scope and unavailable Windows coverage in plan verification.
**Decision:** specs/v2/codemode-call-timeouts.md.
**Commit:** test(core): verify steering after tool timeout.
