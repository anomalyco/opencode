# Desktop Plugin Manager — Manual Verification Checklist

Plan: `docs/superpowers/plans/2026-09-03-desktop-plugin-manager.md`, Task 6
Branch: `feat/desktop-plugin-manager`
Date: 2026-09-03

Automated verification (this task) ran on a Linux machine with an X11 display; the
Electron app launches and reaches "server ready" in `bun run dev`, but interactive
in-app clicks are not automatable from this harness. Items marked **requires GUI
session** include exact repro steps for a human to run.

## Automated verification results

| Check | Result |
|---|---|
| `bun test src/main/` (packages/desktop) | 81 pass / 1 fail — the only failure is the pre-existing `draft-store.test.ts` error: `No such built-in module: node:sqlite` (bun 1.3.14 lacks node:sqlite). All plugin tests pass. |
| `bun test src/i18n/parity.test.ts` (packages/app) | 5 pass / 0 fail |
| `bun run typecheck` (packages/desktop) | clean (tsgo, no errors) |
| `bun run typecheck` (packages/app) | clean (tsgo, no errors) |
| Live catalog fetch | `createCatalogFetcher({ cacheDir: "/tmp/opencode-live-catalog" }).fetchCatalog()` → 185 entries, `stale: false`; sample entries carry npm metadata (`onNpm`, `version`, `updatedAt`, `downloadsLastWeek`); entries without npm data correctly report `onNpm: false`. |
| `bun run dev` (packages/desktop) | App launches: vite dev server up, renderer connected, onboarding completes, "server ready" logged, no GPU failures on second run. Interactive clicking not possible from this harness. |

## Checklist

### 1. Plugins tab visible on desktop; Browse default lists catalog entries with npm metadata

**Status: PASS (unit/live-verified; GUI confirmation pending)**

- Tab trigger and content are guarded by `platform.platform === "desktop" && platform.plugins`
  (`packages/app/src/components/settings-v2/dialog-settings-v2.tsx:69` and `:118`).
- Live fetch returned **185 catalog entries** from ecosystem + awesome lists, enriched
  with npm metadata (`onNpm`, `version`, `updatedAt`, `downloadsLastWeek`).
- GUI repro: `cd packages/desktop && bun run dev` → open Settings → Plugins tab appears
  after Shortcuts; Browse is the default view; entries list with descriptions and
  downloads/week.

### 2. Search filters the list by name and description

**Status: PASS (code-verified; GUI confirmation pending)**

- The `filtered` memo in `packages/app/src/components/settings-v2/plugins.tsx`
  (search: `const filtered = createMemo`) matches case-insensitively against
  `e.name` **and** `e.description`.
- No unit test asserts this memo directly; verified by reading the implementation.
- GUI repro: Browse view → type `helicone` → list narrows to `opencode-helicone-session`;
  type `types` → `opencode-type-inject` matches via description only.

### 3. Install dialog: Global writes global config; "This project" writes project config; toast reminds to restart

**Status: requires GUI session (unit-verified where possible)**

- Unit-verified: `registerPluginManager > install global writes ~/.config/opencode/opencode.json`
  and `install project writes <dir>/opencode.json` pass in
  `packages/desktop/src/main/plugin-manager.test.ts`.
- Unit-verified: success toast key `settings.plugins.install.success`
  ("Installed {{name}}. Restart OpenCode to load it.") is rendered after install
  (`plugins.tsx`, `doInstall` flow).
- GUI repro:
  1. Browse → Install… on any entry.
  2. Dialog offers Global and This-project (project button only when a project dir is
     known).
  3. Choose Global → restart-reminder toast appears; `~/.config/opencode/opencode.json`
     now contains the plugin in its `plugin` array.
  4. Repeat with "This project" → `<dir>/opencode.json` updated instead.

### 4. Install preserves comments in a `.jsonc` global config

**Status: PASS (unit-verified; GUI confirmation pending)**

- Unit-verified in `packages/desktop/src/main/plugin-config.test.ts`:
  - `mutateConfig > jsonc mutation preserves comments and formatting`
  - `readConfig > jsonc preserves comments in raw and parses data`
- Implementation: `packages/desktop/src/main/plugin-config.ts` `mutateConfig` parses
  JSONC, applies `modify` + `applyEdits`, preserving unknown keys and comments.
- GUI repro: add a comment (e.g. `// my note`) to `~/.config/opencode/opencode.jsonc`,
  install another plugin via the dialog, reopen the file — comment and formatting
  intact.

### 5. Installed view lists plugins from both scopes with Global/Project badges

**Status: PASS (unit/code-verified; GUI confirmation pending)**

- Unit-verified: `registerPluginManager > read-configs returns both scopes with provenance`
  passes in `plugin-manager.test.ts`.
- Component renders Global/Project provenance tags
  (`settings.plugins.installed.provenance.global|project`) in
  `packages/app/src/components/settings-v2/plugins.tsx`.
- GUI repro: install one plugin globally and one to the project; Installed view shows
  both with correct badges.

### 6. Disable removes entry; "Recently removed" chip appears; Enable restores exact entry form (tuple options preserved)

**Status: PASS (unit-verified; GUI confirmation pending)**

- Unit-verified: `registerPluginManager > remove with remember records recently-removed
  and re-enable restores` passes, including tuple-option preservation.
- Component: Disable button calls `remove(name, scope, remember=true)`; Enable in the
  "Recently removed" section re-installs using the saved entry (tuple form preserved).
- Implementation: `packages/desktop/src/main/plugin-manager.ts` `remove` with `remember`
  records `recentlyRemoved` (name + scope + exact entry form); re-enable installs the
  saved entry.
- GUI repro: install a tuple-form plugin `["pkg", { options: {...} }]`; Installed →
  Disable → entry gone from config, chip appears; Enable → file contains the exact
  tuple again.

### 7. Uninstall removes entry with no recently-removed record

**Status: PASS (unit-verified; GUI confirmation pending)**

- Unit-verified: `registerPluginManager > remove without forget drops the record
  entirely (uninstall)` passes.
- Component: Uninstall button calls `remove(..., remember=false)`.
- GUI repro: install a plugin; Installed → Uninstall → entry gone, no "Recently
  removed" chip appears.

### 8. Offline: cached/stale banner or error state; Installed view still functional

**Status: requires GUI session (partial unit coverage)**

- Implementation: `packages/desktop/src/main/plugin-catalog.ts` `fetchCatalog()` serves
  the cached catalog when the network fetch fails and marks `stale: true`; the renderer
  shows the `settings.plugins.stale` banner (with relative age) in Browse view; on
  total failure the `settings.plugins.errors.catalog` toast surfaces.
- Installed view is served from config files directly, independent of network.
- GUI repro:
  1. Launch once online so the catalog is cached.
  2. Disconnect network (or block catalog hosts via /etc/hosts), relaunch the app.
  3. Browse shows cached entries with the stale banner (or the catalog error toast);
     Installed view lists installed plugins normally.
  4. Reconnect.

### 9. Corrupt config file: writes refused, error surfaces file path

**Status: PASS (unit-verified; GUI confirmation pending)**

- Unit-verified in `plugin-config.test.ts`:
  - `mutateConfig > refuses to write on parse failure`
  - `readConfig > throws ConfigParseError with path on bad content`
- Component surfaces `settings.plugins.errors.parseFailed` with the file path in the
  Installed view (`plugins.tsx`, `configsError` rendering).
- GUI repro: put invalid content in `<dir>/opencode.json` (e.g. `{ "plugin": [ }`);
  open Installed view → error names the file path; install attempts targeting that file
  are refused and the file is unchanged.

### 10. Web build (`platform.platform === "web"`): Plugins tab hidden

**Status: PASS (code-verified)**

- Both tab trigger and content are wrapped in
  `Show when={platform.platform === "desktop" && platform.plugins}`
  (`dialog-settings-v2.tsx:69` and `:118`), so on web (or when the desktop bridge is
  absent) the tab never renders. `platform.plugins` is only provided by the desktop
  platform context (Task 4 wiring).
- GUI repro (optional): run the app in web mode → Settings shows no Plugins tab.

## Summary

| # | Item | Status |
|---|---|---|
| 1 | Plugins tab + catalog listing | PASS (live-verified; GUI confirm pending) |
| 2 | Search filter | PASS (code-verified; GUI confirm pending) |
| 3 | Install scopes + restart toast | requires GUI session (unit-verified paths) |
| 4 | JSONC comment preservation | PASS (unit-verified; GUI confirm pending) |
| 5 | Installed view + provenance badges | PASS (unit-verified; GUI confirm pending) |
| 6 | Disable → recently removed → Enable restores tuple | PASS (unit-verified; GUI confirm pending) |
| 7 | Uninstall (no recently-removed record) | PASS (unit-verified; GUI confirm pending) |
| 8 | Offline stale banner / error state | requires GUI session (partially unit-covered) |
| 9 | Corrupt config refused + path surfaced | PASS (unit-verified; GUI confirm pending) |
| 10 | Web build hides Plugins tab | PASS (code-verified) |

No code gaps found during verification; no source changes were required.