# OAuth Multi-Account Rewrite — Plan

**Goal:** Port `feat/oauth-multi-account` branch onto `dev` branch architecture.

## Branch Comparison Summary

| Aspect | `feat/oauth-multi-account` (source) | `dev` (target) |
|--------|--------------------------------------|----------------|
| Auth store | Zod + 799-line `auth/index.ts`, multi-account v2 | Effect Schema + 96-line simple Service |
| Server layer | Hono HTTP + `src/server/routes/` files | Effect HttpApi + `src/server/routes/instance/httpapi/` |
| Auth aux files | `context.ts`, `rotating-fetch.ts`, `browser.ts`, `credential-manager.ts` | None |
| CLI auth | `auth.ts` with browser + rename cmds | No `auth.ts` at all (`providers.ts`, `account.ts`) |
| Config | `config.ts` has `oauth.*` per-provider fields | `config/provider.ts` has no `oauth` field |
| UI | 960-line multi-account `settings-providers.tsx` | 251-line simple list |

## Phases

| # | Phase | Status | Key files |
|---|-------|--------|-----------|
| 1 | Auth store rewrite | DONE | `auth/index.ts` + 4 new auth files |
| 2 | Server routes | DONE | `httpapi/groups/provider.ts` + `httpapi/handlers/provider.ts` |
| 3 | Provider + Config integration | DONE | `provider/provider.ts`, `config/provider.ts` |
| 4 | CLI commands | DONE | Extended `providers`/`auth` CLI alias |
| 5 | UI rewrite | DONE | `app/src/components/settings-providers.tsx` |
| 6 | SDK regen + tests | DONE* | `packages/sdk/`, `test/auth/` |

## Key Dependency Order

```
Phase 1 (auth store) → Phase 2 (routes need Auth.OAuthPool)
Phase 1 → Phase 3 (rotating-fetch needs Auth.OAuthPool)
Phase 2 → Phase 6 (SDK regen needs finalized routes)
Phase 1,2 → Phase 5 (UI needs APIs + SDK types)
Phases 1,3 → Phase 4 (CLI uses auth store + browser)
```

## Related Source Files (feature branch)

- `packages/opencode/src/auth/index.ts` — complete multi-account store (799 lines)
- `packages/opencode/src/auth/context.ts` — AsyncLocalStorage
- `packages/opencode/src/auth/credential-manager.ts` — Bus events + TUI toasts
- `packages/opencode/src/auth/rotating-fetch.ts` — fetch rotation logic
- `packages/opencode/src/auth/browser.ts` — Puppeteer auto-relogin
- `packages/opencode/src/cli/cmd/auth.ts` — CLI commands (753 lines)
- `packages/opencode/src/server/routes/provider.ts` — Hono routes (555 lines)
- `packages/opencode/src/config/config.ts` — oauth config fields
- `packages/app/src/components/settings-providers.tsx` — UI (960 lines)

## Notes

- The feature branch code is **complete and tested** — the task is porting architecture, not designing new logic
- Effect HttpApi pattern requires Schema classes (not Zod), and `HttpApiBuilder.group` handlers
- `Auth.OAuthPool.*` functions are plain async (not Effect) — keep this pattern on dev too
- `Auth.Service` interface must still satisfy the Effect layer (`get/all/set/remove` as Effects)
- No breaking changes to existing `Auth.Service` layer callers on dev

## Implementation Status

Implemented on 2026-05-16. Package typechecks passed for `packages/opencode`, `packages/app`, and `packages/sdk/js`; focused auth tests passed. Full `packages/opencode` test run was attempted but blocked by environment-level watcher/server failures (`FSEvents stream`, `port 0 in use`) after unrelated suites had already started failing.
