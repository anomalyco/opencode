# Handoff Plan: `rebase/upstream-sync`

## Current State
- Branch: `rebase/upstream-sync` (based on `upstream/dev`)
- Latest commit: `243ffdb7b` (`fix: stabilize recent session routing and TTS handling`)
- Active todos:
  - `rebase-ui` — in progress
  - `rebase-tts` — in progress
  - `rebase-review` — pending
  - `rebase-autopilot` — pending
  - `rebase-session` — pending
  - `rebase-infra` — pending
  - `rebase-verify` — pending

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
- Session resilience MVP wiring (uncommitted):
  - `packages/opencode/src/cli/cmd/serve-autoresume.ts` (new)
    - scans recent sessions globally
    - picks `unanswered` / `interrupted` actions via `pickAction`
    - resumes inside `InstanceStore.provide({ directory })`
    - provides `WorkspaceRef` and skips busy sessions
  - `packages/opencode/src/cli/cmd/serve.ts`
    - starts auto-resume worker in background (`Effect.scoped(...forkScoped...)`)
- Validation already green for current in-progress code:
  - `packages/opencode`: `bun typecheck`
  - `packages/opencode`: `bun test test/session/auto-resume.test.ts test/tts/route.test.ts test/tts/edge.test.ts`

## Execution Plan
1. **Commit session resilience MVP**
   - Commit `serve-autoresume.ts` + `serve.ts` once final review is complete.

2. **Port auto-review group cleanly**
   - Confirm auto-review files already included in commit `38405e57a` still match upstream model/session APIs.
   - Add only missing wiring points if needed; avoid broad layout rewrites.

3. **Port session resilience incrementally**
   - Integrate `session/auto-resume.ts` into upstream `serve` flow using Effect-compatible patterns.
   - Rework/replace fork-only tests that depend on `Instance.provide`.

4. **Defer heavy rewrites into separate commits**
   - Autopilot/heartbeat/scheduler and infra changes should be ported as explicit Effect-native rewrites, not direct file copies.
   - Keep each logical area in separate commits to simplify review/rebase.

5. **Verification gate before push**
   - `cd packages/opencode && bun typecheck`
   - `cd packages/app && bun run build`
   - `bun run install:local`
   - `cd packages/opencode && bun test`

6. **Publish + tracking**
   - Push `rebase/upstream-sync` to fork.
   - Open/update PR against `dzianisv/opencode`.
   - Update linked issue with status and commit/PR references.

## Notes
- Subagent `port-app-ui` found a valid route bug fix in `sidebar-recent.tsx` (`slug` should be encoded directory, not `"recent"`).
- `port-tts` subagent hit rate limits; current local TTS route/module diffs should be treated as primary source.
