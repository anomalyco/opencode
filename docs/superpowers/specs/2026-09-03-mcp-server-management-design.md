# MCP Server Management for OpenCode Desktop — Design

**Date:** 2026-09-03
**Status:** Approved (design), pending spec review
**Repo:** `/home/yeager1977/GitHub/opencode` (clone of `anomalyco/opencode`, branch `feat/desktop-plugin-manager`)

## Problem

MCP servers can only be managed by hand-editing `opencode.json` or using the CLI.
The app already shows MCP status (a read-only picker dialog with connect/auth
toggles), but there is no UI to add, edit, or delete servers with their full
configuration (command/URL, env vars, headers, OAuth credentials, timeouts).

## Goal

A "MCP" tab in the desktop app's settings dialog providing full CRUD over MCP
server configuration, including OAuth credential fields, backed entirely by the
existing opencode server API (`sdk.mcp.*`).

## Scope decisions (user-approved)

- **Full CRUD + OAuth fields**: add/edit/delete with type, command/url, env
  vars, headers, OAuth client id/secret/scope, timeout, enabled.
- **Placement**: a new settings tab ("MCP", Desktop section, after Plugins).
  The existing quick MCP picker dialog stays read-only.

## Architecture

Pure app-package feature. No main-process/desktop changes, no core changes,
no new IPC — MCP CRUD goes through the opencode server HTTP API, so the tab
also works in web builds (no desktop-only gate).

New component `packages/app/src/components/settings-v2/mcp.tsx`, wired as an
"MCP" tab in `dialog-settings-v2.tsx`. Data via the existing server SDK:

- `sdk.mcp.list` → names + status + config (already polled by server-sync)
- `sdk.mcp.add({ server, config, location })` → add
- `sdk.mcp.remove({ server, location })` → delete
- `sdk.mcp.connect / disconnect / auth.authenticate` → status actions
- `sdk.mcp.auth.start` (OAuth start) is invoked by the existing auth flow —
  the tab only triggers `auth.authenticate` when status is `needs_auth`

Protocol branching follows the v1/v2 pattern already demonstrated in
`server-sync.tsx` (`sdk.mcp.connect` on v1 vs `serverSDK.api.mcp.connect` on
v2). The tab obtains the SDK through the same `useServerSync` / `useServerSDK`
context pattern used by `providers.tsx` and `servers.tsx`.

## UI

Three views in one tab, local toggle (same structure as the Plugins tab):

### List (default)

Each row: server name, type badge (Local/Remote), status badge (reusing
existing `mcp.status.*` i18n keys), per-row actions:

- Connect / Disconnect (status-dependent)
- Authenticate (only when status is `needs_auth`)
- Edit
- Delete (confirm dialog)

An "Add server" button opens the add dialog.

### Add/Edit dialog

Form with a Local/Remote type toggle:

- **Local**: command (argument list editor), cwd, environment variables
  (key/value row editor)
- **Remote**: URL, headers (key/value row editor), OAuth sub-form (client ID,
  client secret, scope, callback port) plus a "disable OAuth auto-detection"
  checkbox (config `oauth: false`)
- **Shared**: enabled toggle, timeout (ms)

Secret-field semantics: `clientSecret` and header values render as password
inputs. On **edit**, secret fields show placeholder "configured — leave blank
to keep" and only overwrite when non-empty. Secrets are never echoed back.

Edit semantics: the API has no update endpoint. Edit = `remove` + `add` with
the new config; if the server is currently connected, disconnect first. The
dialog warns that a connected server will be reconnected.

### Delete

Confirm dialog → `mcp.remove({ server, location })` → refetch list.

## Data flow

```
List:   createResource → sdk.mcp.list → rows with status badges
Add:    form → build McpAddInput → sdk.mcp.add → refetch list
Edit:   form → (disconnect if connected) → mcp.remove + mcp.add → refetch
Auth:   needs_auth → sdk.mcp.auth.authenticate({ name }) → existing OAuth flow
```

Location (`directory`) comes from the same `projectDir` memo pattern the
Plugins tab uses (route-based), so server configs are written to the correct
workspace scope.

## Error handling

- `mcp.add` validation failures (HTTP 400) → error toast with the server's
  message; dialog stays open for correction.
- Duplicate server name → surfaced as an inline form error (server 400).
- Offline / no server connection → tab-level error state with retry button
  (same pattern as the Plugins catalog failure state).
- Config parse issues are server-side; nothing is written by the app directly.

## Testing

- Unit (colocated, `packages/app/src/components/settings-v2/mcp.test.ts`):
  form → `McpAddInput` payload builder covering local and remote shapes,
  secret-retention-on-edit semantics, oauth-false handling, timeout coercion.
- Storybook story skipped (app preview lacks Platform/Language providers —
  same escape hatch as Plugins).
- Manual checklist: add local server, add remote with OAuth creds, edit with
  secret retention, delete, authenticate flow, duplicate-name error, offline
  error state.

## Non-goals (v1)

- No MCP marketplace/catalog browsing (the server has an McpCatalog; UI for
  it is a future feature).
- No per-server tool/resource listing UI.
- No config-file import/export.
- No SSE-vs-streamable transport picker (server auto-detects).

## i18n

New keys `settings.mcp.*` in `packages/app/src/i18n/en.ts` + all 62 locale
files (repo parity convention; machine-assisted translations with preserved
`{{placeholders}}`, following the Plugins-tab precedent). Existing
`mcp.status.*` keys are reused for status badges.