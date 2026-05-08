# Handoff Plan: `rebase/upstream-sync`

## Current State
- Branch: `rebase/upstream-sync` (based on `upstream/dev`)
- Latest commit: `d6b648157` (`feat: add serve auto-resume worker`)
- Active todos:
  - `rebase-ui` — done
  - `rebase-tts` — done
  - `rebase-review` — pending
  - `rebase-autopilot` — pending
  - `rebase-session` — done
  - `rebase-infra` — pending
  - `rebase-verify` — in progress

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

## Execution Plan
1. **Commit HttpApi/TTS parity fix**
   - Commit the 4 files listed above once final smoke verification is complete.

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
    - `bun install` (repo has no `install:local` script)
    - `cd packages/opencode && bun test`

6. **Publish + tracking**
   - Push `rebase/upstream-sync` to fork.
   - Open/update PR against `dzianisv/opencode`.
   - Update linked issue with status and commit/PR references.

## Notes
- Subagent `port-app-ui` found a valid route bug fix in `sidebar-recent.tsx` (`slug` should be encoded directory, not `"recent"`).
- `port-tts` subagent hit rate limits; current local TTS route/module diffs should be treated as primary source.
