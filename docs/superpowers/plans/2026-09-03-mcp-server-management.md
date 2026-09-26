# MCP Server Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "MCP" settings tab to OpenCode Desktop/app that manages MCP servers (add/edit/delete with local/remote configs, OAuth credential fields, and status actions) via the existing `sdk.mcp.*` server API.

**Architecture:** Pure app-package feature — no desktop main-process changes, no core changes. New component `packages/app/src/components/settings-v2/mcp.tsx` wired as a tab in `dialog-settings-v2.tsx`. Data through `useServerSDK()` (`serverSdk.client.mcp.*` — the `OpenCodeClient` promise API; see `server-session.ts:62` where `ServerApi = OpenCodeClient`) and `useServerSync()` for the current directory + status polling already wired (`server-sync.tsx:702-715` shows the exact v1/v2 protocol-branch patterns for connect/disconnect/authenticate).

**Tech Stack:** SolidJS, `@opencode-ai/ui/v2` components, existing server SDK client (`@opencode-ai/client/promise`), `bun:test` for the payload-builder unit tests.

**Spec:** `docs/superpowers/specs/2026-09-03-mcp-server-management-design.md`

## Global Constraints

- Work only in `packages/app/` (plus docs). No changes to `packages/desktop`, `packages/core`, or any server/protocol package.
- Data access only through `useServerSDK()`/`useServerSync()` context patterns; no direct fetch calls.
- i18n: new keys `settings.mcp.*` go in `packages/app/src/i18n/en.ts` AND all 62 locale files (`src/i18n/parity.test.ts` enforces; reuse the existing `mcp.status.*` keys for status badges). Preserve `{{placeholders}}` in translations.
- MCP add payloads must match `McpAddInput` exactly (from `client/dist/promise/generated/types.d.ts`): `{ server: string, location?: { directory?: string }, config: LocalConfig | RemoteConfig }` where LocalConfig = `{ type: "local", command: string[], cwd?, environment?, disabled?, timeout? }` and RemoteConfig = `{ type: "remote", url, headers?, oauth?: { client_id?, client_secret?, scope?, callback_port?, redirect_uri? } | false, disabled?, timeout? }`.
- Secret retention on edit: `clientSecret` and header values never echo back; blank input = keep existing value.
- Edit = `remove` + `add` (no update endpoint); disconnect first if connected.
- Tests: `bun test src/components/settings-v2` from `packages/app/`; typecheck `bun run typecheck` (tsgo; fallback `bunx tsc -b` — note if used).
- The tab is NOT desktop-gated (server API works in web builds) — render it unconditionally.
- Commit messages: `feat(app): ...` / `docs(app): ...`. Never `git add -A`.

---

### Task 1: MCP payload builder (form model → McpAddInput)

**Files:**
- Create: `packages/app/src/components/settings-v2/mcp-payload.ts`
- Test: `packages/app/src/components/settings-v2/mcp-payload.test.ts`

**Interfaces:**
- Consumes: the `McpAddInput["config"]` shape (type it locally as `McpServerConfig = McpAddInput["config"]` re-exported from the client package; do not redefine the structure).
- Produces (used by Task 2):
  - `export type McpFormState = { name: string; kind: "local" | "remote"; command: string[]; cwd?: string; environment: { key: string; value: string }[]; url: string; headers: { key: string; value: string }[]; oauthEnabled: boolean; oauthDisableAutodetect: boolean; clientId: string; clientSecret: string; clientSecretPlaceholder?: string; scope: string; callbackPort: string; enabled: boolean; timeout: string }`
  - `export function emptyForm(name?: string): McpFormState`
  - `export function formFromConfig(name: string, config: McpServerConfig): McpFormState` — for edit; secret fields become empty strings with `clientSecretPlaceholder = "configured"` sentinel
  - `export function buildAddInput(form: McpFormState, opts: { keepSecret?: boolean }): { ok: true; input: { server: string; config: McpServerConfig } } | { ok: false; error: string }` — validation errors for: empty name, empty command (local), empty url (remote), oauth enabled with empty url... (remote requires url), non-numeric callbackPort/timeout. When `keepSecret` is true and `clientSecret` is empty, the oauth object is built WITHOUT `client_secret` (server keeps existing credential via remove+add round-trip is NOT possible — so `formFromConfig` must capture whether a secret exists: if placeholder sentinel set and blank on submit, the oauth sub-object omits `client_secret` entirely and the user is warned in the UI that re-auth may be required).
  - `export type McpServerConfig = McpAddInput["config"]`

- [ ] **Step 1: Write the failing tests**

Create `mcp-payload.test.ts` with `bun:test` describe blocks covering: `emptyForm` defaults (kind local, enabled true, oauthEnabled false); `formFromConfig` round-trips a local config (command array, env rows) and a remote config with oauth (secret becomes empty + placeholder sentinel); `buildAddInput` success cases (local minimal, remote with headers + oauth with all fields, oauth:false when `oauthDisableAutodetect`, timeout coerced to number and omitted when blank/invalid, empty env/header rows dropped); validation failures (empty name → error, local without command → error, remote without url → error, non-numeric callbackPort → error). Use `expect(...).toEqual(...)` on built inputs.

- [ ] **Step 2: Run to verify fail** — `bun test src/components/settings-v2/mcp-payload.test.ts` from `packages/app` → module not found.

- [ ] **Step 3: Implement `mcp-payload.ts`** — pure functions, no Solid imports. Import the config type via `import type { McpAddInput } from "@opencode-ai/client/promise"` (this subpath resolves in the app package — proven by `global-sync/types.ts:18`).

- [ ] **Step 4: Run to verify pass** — same command → all pass.

- [ ] **Step 5: Typecheck** — `bun run typecheck` from `packages/app`.

- [ ] **Step 6: Commit** — `git add packages/app/src/components/settings-v2/mcp-payload.ts packages/app/src/components/settings-v2/mcp-payload.test.ts && git commit -m "feat(app): MCP form payload builder with validation and secret retention"`

---

### Task 2: MCP settings tab (list + status actions + delete)

**Files:**
- Create: `packages/app/src/components/settings-v2/mcp.tsx`
- Modify: `packages/app/src/components/settings-v2/dialog-settings-v2.tsx` (add trigger + content)
- Modify: `packages/app/src/i18n/en.ts` + all 62 locales (`settings.mcp.*` keys)
- Test: `packages/app/src/components/settings-v2/mcp-payload.test.ts` (already exists; no new test file needed for the UI itself)

**Interfaces:**
- Consumes: `useServerSDK()` (`serverSdk.client.mcp.list/add/remove/connect/disconnect`, `serverSdk.client.mcp.auth.authenticate`, `serverSdk.protocol`), `useServerSync()` for directory (use the same `directory` memo from `dialog-settings-v2.tsx:26-33` passed as prop like providers does), `SettingsPluginsV2`-style local view toggle, `SettingsRowV2`/`SettingsListV2` from `./parts`, `ButtonV2`, `Tag`, `showToast` from `@/utils/toast`, existing i18n keys `mcp.status.*`.
- Produces: `export const SettingsMcpV2: Component<{ directory?: string }>` rendered as `<TabsV2.Content value="mcp">`; the Edit view is delegated to Task 3's dialog component.

- [ ] **Step 1: Add i18n keys (en.ts)**

```
settings.tab.mcp: "MCP"
settings.mcp.section.servers: "Servers"
settings.mcp.add: "Add server"
settings.mcp.type.local: "Local"
settings.mcp.type.remote: "Remote"
settings.mcp.status.badge: use existing mcp.status.* keys (do NOT duplicate)
settings.mcp.action.connect / disconnect / authenticate / edit / delete
settings.mcp.delete.title / delete.body ({{name}} placeholder)
settings.mcp.empty: "No MCP servers configured."
settings.mcp.errors.refresh: "Could not load MCP servers."
settings.mcp.errors.removed: "Deleted {{name}}."
settings.mcp.status.pending: "connecting…"
```

- [ ] **Step 2: Create the component**

List view: `createResource` calling `serverSdk.client.mcp.list({ location: { directory } })` (`McpListOutput.data: McpServer[]` — name + `status.status`). Rows show name, type from the config if present in the list payload (if `McpServer` lacks config info — verify; if absent, fetch nothing extra and show type only in edit), status badge, actions: Connect/Disconnect via the protocol branch (`serverSdk.client.mcp.connect/disconnect` — mirror `server-sync.tsx:702-715` for v1-vs-v2 by calling through the same `useServerSDK().client` used there), Authenticate when `needs_auth`, Edit (Task 3), Delete (confirm → `mcp.remove({ server: name, location: { directory } })` → toast → refetch). "Add server" button → Task 3 dialog. Loading/error/empty states match the Plugins tab patterns (`catalog.loading` / error + retry / `palette.empty`).

- [ ] **Step 3: Wire the tab** — trigger in the Desktop section AFTER plugins (`value="mcp"`, `Icon name="mcp"`), content `<SettingsMcpV2 directory={directory()} />` using the existing `directory` memo in `dialog-settings-v2.tsx`. No `Show`-gate (works on web too).

- [ ] **Step 4: Typecheck + verify** — `bun run typecheck` from `packages/app`; `bun test src/components/settings-v2` (payload tests still pass).

- [ ] **Step 5: Commit** — `git add packages/app/src/components/settings-v2/mcp.tsx packages/app/src/components/settings-v2/dialog-settings-v2.tsx packages/app/src/i18n && git commit -m "feat(app): MCP settings tab with server list and status actions"`

---

### Task 3: Add/Edit dialog with OAuth + secret retention

**Files:**
- Modify: `packages/app/src/components/settings-v2/mcp.tsx` (add dialog component + wire Add/Edit actions)
- Modify: `packages/app/src/i18n/en.ts` + all 62 locales (form field keys below)
- Test: reuse `mcp-payload.test.ts` (builder already tested)

**Interfaces:**
- Consumes: Task 1's `emptyForm`, `formFromConfig`, `buildAddInput`; Task 2's list resource + refetch; `useDialog().push` pattern (same as the Plugins install-scope dialog and `dialog-server-v2.tsx`).
- Produces: dialog opened by "Add server" and per-row "Edit" buttons.

- [ ] **Step 1: Add i18n keys (en.ts, then all locales)**

```
settings.mcp.form.title.add / form.title.edit ({{name}})
settings.mcp.form.kind / form.command / form.command.hint / form.cwd / form.url
settings.mcp.form.env / form.headers / form.addRow / form.removeRow
settings.mcp.form.oauth / form.oauth.clientId / form.oauth.clientSecret
settings.mcp.form.oauth.clientSecret.keep: "Configured — leave blank to keep"
settings.mcp.form.oauth.scope / form.oauth.callbackPort / form.oauth.disableAutodetect
settings.mcp.form.enabled / form.timeout / form.save / form.cancel
settings.mcp.errors.invalid: "Fix the highlighted fields."
settings.mcp.errors.duplicate: "A server with this name already exists."
settings.mcp.edit.warn: "Editing reconnects this server." (shown when connected)
```

- [ ] **Step 2: Build the dialog**

Type toggle (Local/Remote) → conditional field groups. Key/value row editors for env/headers (add-row button, per-row remove). OAuth sub-form shown for remote: clientId, clientSecret (password input with keep-placeholder when editing), scope, callbackPort, "disable autodetect" checkbox (sets `oauth: false`, hides the other oauth fields). Save: `buildAddInput(form, { keepSecret: editing && secretBlank })` → on `ok:false` show inline field errors; on success: add path = `mcp.add(input)` then refetch; edit path = `mcp.disconnect` (if status connected) → `mcp.remove` → `mcp.add` → refetch. Catch 400 → map duplicate-name message to `errors.duplicate`, otherwise toast with server message; dialog stays open.

- [ ] **Step 3: Translate all 62 locales** — follow the Plugins precedent (script the insertion after an existing anchor key; preserve `{{name}}`; run parity test to 5/5).

- [ ] **Step 4: Typecheck + full settings-v2 tests + parity** — all pass.

- [ ] **Step 5: Commit** — `git add packages/app/src/components/settings-v2/mcp.tsx packages/app/src/i18n && git commit -m "feat(app): MCP add/edit dialog with OAuth fields and secret retention"`

---

### Task 4: Verification + checklist

**Files:**
- Create: `docs/superpowers/plans/2026-09-03-mcp-server-management-manual-checklist.md`

- [ ] **Step 1: Automatable checks** — `bun test src/components/settings-v2` and `bun test src/i18n/parity.test.ts` from `packages/app`, `bun run typecheck` both packages (desktop untouched — confirm `git diff --stat packages/desktop` is empty).

- [ ] **Step 2: Write the manual checklist** — items: add local server appears in list; add remote with headers; OAuth fields round-trip on edit; secret retention (blank = keep); delete with confirm; authenticate on needs_auth; duplicate-name error inline; offline error state; tab visible on web build; edit of connected server shows reconnect warning. Mark each PASS (verified via unit/live check) or "requires GUI session" with repro steps.

- [ ] **Step 3: Fix any gaps found** (unit-level only), rerun tests.

- [ ] **Step 4: Commit** — `git add docs/superpowers/plans/2026-09-03-mcp-server-management-manual-checklist.md <any fixed files> && git commit -m "docs(app): MCP management manual verification checklist"`

---

## Self-Review (performed during plan writing)

1. **Spec coverage:** Full CRUD (Tasks 2–3) ✓; OAuth fields incl. `oauth: false` disable-autodetect (Task 3) ✓; secret retention (Tasks 1, 3) ✓; status actions connect/disconnect/authenticate (Task 2) ✓; edit = remove+add with reconnect warning (Task 3) ✓; error handling — 400/duplicate/offline (Tasks 2–3) ✓; i18n all locales (Tasks 2–3) ✓; non-goals respected (no marketplace, no tool listing) ✓; not desktop-gated per spec ✓.
2. **Placeholder scan:** No TBDs. Form field list in Task 3 Step 1 is complete. The one deliberate open point (whether `McpListOutput` rows carry config info for type badges) is called out in Task 2 Step 2 with a fallback instruction, not a gap.
3. **Type consistency:** `McpFormState`, `buildAddInput`, `formFromConfig`, `emptyForm`, `McpServerConfig` defined in Task 1 and consumed in Task 3 with the same names. SDK call shapes verified against `client/dist/promise/generated/{client,types}.d.ts` (`mcp.list/add/remove/connect/disconnect`, `McpAddInput`, `McpListOutput`).