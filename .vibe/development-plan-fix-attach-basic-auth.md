# Development Plan: repo (fix/attach-basic-auth branch)

_Generated on 2026-05-12 by Vibe Feature MCP_
_Workflow: [minor](https://codemcp.github.io/workflows/workflows/minor)_

## Goal

Fix `opencode attach` failing with 401 Unauthorized when connecting to a router-managed session via the attach subdomain.

**Root cause**: `opencode attach <url> --password <pw>` builds `Authorization: Basic base64("opencode:<password>")` and sends it with every request. The router's `validateAttachPassword()` only checked `?password=` query param and `X-Attach-Password` header — it never parsed the `Authorization: Basic ...` header, so all CLI attach requests received 401.

## Key Decisions

- **Fix location**: `packages/opencode-router/src/index.ts` — `validateAttachPassword()` function
- **Auth priority**: Basic Auth header is checked first (primary path used by CLI), then `?password=` query param, then `X-Attach-Password` header (backward compatible)
- **Password extraction**: Split on first colon only (`indexOf(":")`) to support passwords that contain colons
- **Tests location**: Added to `packages/opencode-router/src/hostname.test.ts` — re-implements the password extraction logic inline (same pattern used by existing `getSessionInfo`/`getAttachSessionHash` tests in that file)
- **Pre-existing failures**: `pod-manager.test.ts` has 1 pre-existing failing test (`ensurePod injects OPENCODE_POD_SECRET`) and `api.test.ts` has 1 pre-existing test error — both confirmed to exist before this change
- **Pre-existing TypeScript errors**: `bun typecheck` reports 2 pre-existing errors in `src/index.ts` (wsHandler typed as `http.RequestListener` instead of upgrade handler type) and `src/pod-manager.ts` — confirmed pre-existing, not introduced by this change
- **UI session details location**: `packages/opencode-router-app/src/session-item.tsx` lines 212–284 — "Attach to session" panel with attach URL and password input fields (read-only with copy buttons); shown only when both `session.attachUrl` and `session.attachPassword` are present
- **Development placeholder comments**: Two `// Could add a toast notification here` comments remain in `session-item.tsx` copy button handlers — minor cleanup, not blocking
- **No debug artifacts introduced**: All console.log statements in `index.ts` are operational (startup, shutdown, debug-header logging gated by `config.debugHeaders` env var)

## Notes

- The CLI (`packages/opencode/src/cli/cmd/tui/attach.ts`) builds: `Authorization: Basic base64("opencode:<password>")`
- The opencode server's own `AuthMiddleware` uses Hono's `basicAuth()` with username `"opencode"` — same format
- The router fix makes the attach proxy accept the same Basic Auth format the opencode server accepts
- Both the HTTP handler and WebSocket upgrade handler call `validateAttachPassword()`, so both paths benefit from the fix

## Explore

### Tasks

_(all complete)_

### Completed

- [x] Created development plan file
- [x] Read `packages/opencode-router/src/index.ts` to understand current `validateAttachPassword()`
- [x] Read `packages/opencode/src/cli/cmd/tui/attach.ts` to confirm Basic Auth format sent by CLI
- [x] Read existing test files to understand test patterns

## Implement

### Tasks

_(all complete)_

### Completed

- [x] Updated `validateAttachPassword()` in `packages/opencode-router/src/index.ts` to parse `Authorization: Basic ...` header first, then fall back to `?password=` query param and `X-Attach-Password` header
- [x] Added 9 tests for the password extraction logic in `packages/opencode-router/src/hostname.test.ts`
- [x] Verified all 23 hostname tests pass
- [x] Verified all pre-existing test failures were pre-existing (not introduced by this change)

## Finalize

### Tasks

- [ ] Push branch and create PR targeting `dev`

### Completed

- [x] Verified working tree is clean — all changes committed (commits: `02633db01`, `022122536` on top of origin/dev)
- [x] Confirmed no debug artifacts introduced by this change
- [x] Confirmed all 23 hostname.test.ts tests pass
- [x] Confirmed TypeScript errors are pre-existing (not introduced)
- [x] Located UI attach/password fields: `packages/opencode-router-app/src/session-item.tsx` lines 212–284
- [x] Reviewed `.vibe/docs/requirements.md` and `design.md` — still template placeholders, no project-specific content to update

---

_This plan is maintained by the LLM. Tool responses provide guidance on which section to focus on and what tasks to work on._
