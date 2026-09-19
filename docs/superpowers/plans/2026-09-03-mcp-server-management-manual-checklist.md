# MCP Server Management — Manual Verification Checklist

Branch: `feat/desktop-plugin-manager` (MCP feature commits `8cdf6e1..56c8d44`)
Spec: `docs/superpowers/specs/2026-09-03-mcp-server-management-design.md`

## Automated (verified this session)

| Check | Result |
|---|---|
| `bun test src/components/settings-v2` (payload builder 26 tests) | PASS |
| `bun test src/i18n/parity.test.ts` (all 62 locales mirror en keys) | PASS 5/5 |
| `bun run typecheck` (tsgo) in `packages/app` | exit 0 |
| oxlint on `mcp.tsx` + `mcp-payload.ts` | 0 warnings |
| `packages/desktop` untouched by MCP feature (only prior plugin work) | PASS |

## Manual (requires running the desktop app with a connected server)

1. Settings → Desktop section shows **MCP** tab (works on web too).
2. **List** loads servers from `sdk.mcp.list` with status badges (connected/failed/needs auth/disabled).
3. **Add server (local)**: name + command → save → server appears in list; server writes config via `mcp.add`.
4. **Add server (remote)**: URL + headers key/value rows save correctly.
5. **OAuth fields**: client ID / secret (password input) / scope / callback port round-trip on edit; `disable autodetect` maps to `oauth: false`.
6. **Secret retention**: editing a server with a configured secret shows "Configured — leave blank to keep"; blank secret omits `client_secret` from the payload.
7. **Edit** a connected server → shows "Saving reconnects this server." warning; save disconnects, removes, re-adds with new config.
8. **Delete** → confirm dialog → server removed from list + config.
9. **Authenticate** button on `needs_auth` / `needs_client_registration` rows triggers the existing OAuth flow.
10. **Duplicate name** on add → inline error near Save ("A server with this name already exists.").
11. **Offline / no server** → error state in the tab with retry; empty state shows "No MCP servers configured."
12. Server defined as `{ enabled: boolean }` only (toggle-only entry in config) → Edit shows the noConfig error toast instead of crashing.

Repro: launch `bun run dev` in `packages/desktop`, open Settings (⌘/Ctrl+,), click the MCP tab.