# Handoff Plan: `rebase/upstream-sync`

## Current State
- Branch: `rebase/upstream-sync` (based on `upstream/dev`)
- Latest commit: `fbf48f48d` (`feat: scheduler cron heartbeat runtime`)
- Active todos:
  - `rebase-ui` — done
  - `rebase-tts` — done
  - `rebase-review` — done
  - `rebase-autopilot` — done
  - `rebase-session` — done
  - `rebase-infra` — done
  - `rebase-verify` — in progress

## Latest Update (2026-05-09)
- Rebased branch onto latest `upstream/dev` and resumed full verification.
- Fixed major post-rebase test cascade caused by unhandled async logger write failures:
  - `packages/core/src/util/log.ts`
  - logger file writes now resolve safely on stream errors (no unhandled rejections during teardown).
- Fixed shell output race causing intermittent `(no output)` regressions:
  - `packages/opencode/src/tool/shell.ts`
  - now joins output reader fiber before finalizing output.
- Current verification snapshot:
  - `packages/opencode`: `bun typecheck` ✅
  - `packages/app`: `bun run build` ✅
  - `packages/opencode`: `bun test` => `2617 pass / 11 skip / 2 todo / 6 fail`
- Remaining 6 fails are environment/baseline in this machine context:
  - `ModelsDev Service > get() returns {} when disk empty and fetch disabled` (local model snapshot state)
  - `provider HttpApi > matches legacy OAuth authorize response shapes` (`"null"` body parity)
  - `Worktree > list > uses parent folder name when worktree basename matches the primary worktree` (`/t` vs `/T` path-case mismatch)
  - three `Project.fromDirectory with bare repos` tests (`safe.bareRepository=explicit`)
- Pending user-requested publish/deploy actions:
  - tag current `origin/dev`
  - force-push rebased `rebase/upstream-sync` to `origin/dev`
  - deploy/restart VM service and re-check original session page.

## Latest Update
- Scheduler/cron heartbeat runtime committed:
  - commit `fbf48f48d`
  - includes scheduler subsystem + `cron` CLI/tool wiring + serve startup integration.
  - regression fixed while porting:
    - resolved `ToolRegistry` init cycle by lazy-loading `CronTool` in `tool/registry.ts`.
  - validation:
    - `packages/opencode`: `bun typecheck`
    - `packages/opencode`: `bun test test/scheduler/index.test.ts test/scheduler/store.test.ts test/tool/cron.test.ts`
    - `packages/opencode`: `bun test test/tool/registry.test.ts test/session/instruction.test.ts`
    - `packages/app`: `bun run build`

- Full verification snapshot after scheduler commit:
  - `packages/opencode`: `bun test` => `2590 pass / 11 skip / 2 todo / 4 fail`
  - same 4 baseline/environment failures as before (`ModelsDev` + 3 bare-repo tests), no new regressions from this branch.

- Infra memory-pressure hardening committed:
  - commit `f61a0fd33`
  - added bounded log retention/trimming in `packages/core/src/util/log.ts` (128MB cap across `.log/.ndjson` with active-log tail trim).
  - switched PTY scrollback from monolithic string buffer to bounded chunk retention in `packages/opencode/src/pty/index.ts`.
  - added snapshot memory-artifact retention helper (`packages/opencode/src/diagnostic/memory.ts`) and tests.
  - new/updated tests:
    - `packages/opencode/test/memory/retention.test.ts`
    - `packages/opencode/test/util/log.test.ts`
- Validation passed for infra port scope:
  - `packages/opencode`: `bun typecheck`
  - `packages/opencode`: `bun test test/memory/retention.test.ts test/util/log.test.ts test/pty/pty-shell.test.ts`

- Scheduler/cron heartbeat port is now integrated (uncommitted in working tree):
  - added scheduler subsystem:
    - `packages/opencode/src/scheduler/index.ts`
    - `packages/opencode/src/scheduler/store.ts`
    - `packages/opencode/src/scheduler/runner.ts`
    - `packages/opencode/src/scheduler/heartbeat.ts`
  - added CLI + tool surfaces:
    - `packages/opencode/src/cli/cmd/cron.ts`
    - `packages/opencode/src/tool/cron.ts`
    - wired in `serve.ts`, `index.ts`, config schema, and tool registry.
  - tests added:
    - `packages/opencode/test/scheduler/index.test.ts`
    - `packages/opencode/test/scheduler/store.test.ts`
    - `packages/opencode/test/tool/cron.test.ts`
  - regression caught and fixed during port:
    - `ToolRegistry` init cycle (`Cannot access 'defaultLayer' before initialization`) resolved by lazy-loading `CronTool` in `tool/registry.ts`.
  - validation:
    - `packages/opencode`: `bun typecheck`
    - `packages/opencode`: `bun test test/scheduler/index.test.ts test/scheduler/store.test.ts test/tool/cron.test.ts`
    - `packages/opencode`: `bun test test/tool/registry.test.ts test/session/instruction.test.ts`
    - `packages/app`: `bun run build`

- Autopilot+heartbeat port committed:
  - commit `343fde6a8`
- Autopilot+heartbeat port is now integrated and green on targeted tests.
- Fixed one regression introduced during autopilot test updates:
  - `test/agent/agent.test.ts` now matches actual default fallback behavior (`plan` when `build` is disabled).
- Targeted validation passed:
  - `packages/opencode`: `bun typecheck`
  - `packages/opencode`: `bun test test/agent/agent.test.ts test/tool/shell.test.ts test/session/prompt.test.ts`
- Full suite snapshot after autopilot port:
  - `packages/opencode`: `bun test` => `2583 pass / 11 skip / 2 todo / 4 fail`
  - failing 4 tests remain the known baseline/environmental set (`ModelsDev` + 3 bare-repo tests), unchanged from prior triage.
- Install gate note:
  - repo currently has no `install:local` script (`bun run install:local` not available).
- Current uncommitted scope for next commit:
  - new autopilot tool + prompt assets
  - autopilot native agent permissions
  - autopilot loop reflection injection
  - shell metadata heartbeat while quiet
  - TUI switch back to `build` after `autopilot_exit`

## Completed Since Last Update
- UI recent routing fix:
  - `sidebar-recent.tsx` now uses `base64Encode(session.directory)` for session slug.
- TTS hardening:
  - `tts.ts` validates trimmed text input (`z.string().trim().min(1)`).
  - `server.ts` mounts `/tts` for HttpApi backend requests.
  - `tts/edge.ts` now removes the temp directory via `rm(..., { recursive: true, force: true })`.
  - `test/tts/route.test.ts` includes whitespace input rejection coverage.
- Verification completed for these changes:
  - `packages/opencode`: `bun typecheck`
  - `packages/app`: `bun run build`
  - `packages/opencode`: `bun test test/tts/route.test.ts test/tts/edge.test.ts`

## In Progress
- Verification + regression cleanup (uncommitted):
  - `packages/opencode/src/server/server.ts`
    - removed `/tts` Hono bypass from `createHttpApi` (this caused HttpApi parity drift).
  - `packages/opencode/src/server/routes/instance/httpapi/groups/global.ts`
    - added `POST /tts/edge` endpoint to Effect HttpApi schema (`tts.edge`).
  - `packages/opencode/src/server/routes/instance/httpapi/handlers/global.ts`
    - added raw handler for `/tts/edge` with body validation + MP3 response.
  - `packages/opencode/src/server/routes/instance/httpapi/public.ts`
    - excluded `/tts/*` from injected instance query params to match legacy Hono OpenAPI shape.
- Validation green for current in-progress code:
  - `packages/opencode`: `bun typecheck`
  - `packages/opencode`: `bun test test/server/httpapi-bridge.test.ts test/tts/route.test.ts test/tts/edge.test.ts test/session/auto-resume.test.ts`

## Completed in This Iteration
- Committed HttpApi/TTS parity fix:
  - commit `bb95c60ee`
  - `/tts/edge` is now served from Effect HttpApi (no Hono bypass in `createHttpApi`).
  - OpenAPI parity tests for HttpApi bridge are passing again.
- Verified app-level fork ports:
  - `packages/app`: `bun test src/pages/session/auto-review.test.ts src/utils/recent-session.test.ts`

## Verification Snapshot
- Passing:
  - `packages/opencode`: `bun typecheck`
  - `packages/app`: `bun run build`
  - `bun install`
  - targeted tests for HttpApi/TTS/auto-resume and app auto-review/recent-session
- Full `packages/opencode` test suite currently reports 4 failures, all outside touched files:
  - `ModelsDev Service > get() returns {} when disk empty and fetch disabled`
  - three `Project.fromDirectory with bare repos` tests

## Failure Triage (baseline vs regression)
- Confirmed via cross-check on `upstream/dev`: all 4 failing tests reproduce as environment/baseline issues, not branch regressions.
- Details:
  - `ModelsDev Service` failure depends on local generated artifact `packages/opencode/src/provider/models-snapshot.js` (gitignored). Fresh worktree without this file passes.
  - bare-repo `Project.fromDirectory` failures are tied to local git config (`safe.bareRepository=explicit`) blocking test worktree creation.

## Execution Plan
1. **Resolve/triage remaining full-suite failures**
   - completed: confirmed as baseline/environment, not introduced by rebase branch changes.

2. **Port autopilot + infra groups (deferred heavy work)**
   - Effect-native rewrites only; avoid direct fork file copy.

3. **Port session resilience incrementally**
   - Integrate `session/auto-resume.ts` into upstream `serve` flow using Effect-compatible patterns.
   - Rework/replace fork-only tests that depend on `Instance.provide`.

4. **Defer heavy rewrites into separate commits**
   - Autopilot/heartbeat/scheduler and infra changes should be ported as explicit Effect-native rewrites, not direct file copies.
   - Keep each logical area in separate commits to simplify review/rebase.

5. **Verification gate before push**
    - `cd packages/opencode && bun typecheck`
    - `cd packages/app && bun run build`
    - `bun install` (repo has no `install:local` script)
    - `cd packages/opencode && bun test`

6. **Publish + tracking**
   - Push `rebase/upstream-sync` to fork.
   - Open/update PR against `dzianisv/opencode`.
   - Update linked issue with status and commit/PR references.

## Notes
- Subagent `port-app-ui` found a valid route bug fix in `sidebar-recent.tsx` (`slug` should be encoded directory, not `"recent"`).
- `port-tts` subagent hit rate limits; current local TTS route/module diffs should be treated as primary source.
