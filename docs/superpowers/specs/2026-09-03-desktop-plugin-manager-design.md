# Plugin Manager for OpenCode Desktop — Design

**Date:** 2026-09-03
**Status:** Approved (design), pending spec review
**Repo:** `/home/yeager1977/GitHub/opencode` (clone of `anomalyco/opencode`, branch `dev`)

## Problem

OpenCode has no plugin browser or manager in the desktop app. Plugin discovery
today is manual: the docs ecosystem page, `awesome-opencode`, npm search, or
the third-party `ocx` CLI. Users must hand-edit `opencode.json` to install a
plugin.

## Goal

A "Plugins" tab in the desktop app's settings dialog that lets users:

1. **Browse** — discover available plugins with search, metadata (description,
   version, weekly downloads, last publish date), and a copyable config
   snippet.
2. **Install** — write the plugin into the chosen `opencode.json` (global or
   project) with a per-install scope prompt that remembers the last choice.
3. **Manage** — see installed plugins with provenance (global/project), remove
   or re-enable them.

## Catalog sources (per user decision)

- `https://opencode.ai/docs/ecosystem/` (curated list)
- `https://github.com/awesome-opencode/awesome-opencode` README (curated list)
- npm registry enrichment: `registry.npmjs.org` (metadata) +
  `api.npmjs.org/downloads/point/last-week` (downloads)

Catalog entries are de-duplicated by npm package name. Entries not resolvable
on npm are kept with partial metadata (name, description, source link) and a
"not on npm" note; they can be copied as snippets but not installed via the
manager.

Caching: in-memory plus on-disk `plugin-catalog-cache.json` under the app's
userData directory, TTL 24h. Stale cache is served on fetch failure with a
"stale" banner.

## Architecture

Two layers, matching existing repo patterns.

### Electron main process

New module `packages/desktop/src/main/plugin-manager.ts`:

- `fetchCatalog()` — fetch + merge + enrich + cache as above.
- `readConfigs()` — parse global (`~/.config/opencode/opencode.json|.jsonc`)
  and project (`<dir>/opencode.json|.jsonc`) configs; return plugin arrays
  with provenance.
- `mutateConfig(target, mutation)` — add/remove plugin entries. Must preserve
  unknown top-level keys and `$schema`; supports `.json` and `.jsonc` (write
  JSONC-aware: JSONC files get entries appended in-place with formatting
  preserved where feasible; if in-place edit is unsafe, fall back to a
  full-file rewrite preserving comments as best effort, and on any parse
  failure refuse to write and surface the file path).
- Plugin array entry forms: `"name"` and `["name", {options}]`. Mutations
  preserve tuple form and existing options when disabling/re-enabling.

Registered in `ipc.ts` as `ipcMain.handle("plugins:*", ...)` handlers:
`plugins:fetch-catalog`, `plugins:read-configs`, `plugins:install`,
`plugins:remove`. Typed in `packages/desktop/src/preload/index.ts` and
`types.ts`.

### Renderer UI

New component `packages/app/src/components/settings-v2/plugins.tsx`, wired as
a "Plugins" tab in `dialog-settings-v2.tsx` (under the Desktop section, after
Shortcuts). The component reaches main-process APIs through the existing
desktop platform context (the app package already abstracts desktop vs web).
On web builds without the desktop bridge, the tab is hidden.

Views (the tab has exactly two sub-views, switched with a local toggle):

- **Browse** (default) — search box, list (name, description, weekly
  downloads, updated). Row click opens detail: full description, version,
  repository link, config snippet with copy button, "Install…" button.
- **Installed** — single view that combines listing and management: entries
  parsed from global + project configs with a provenance badge (Global /
  Project), per-entry actions (Disable, Uninstall with confirm, Open config
  file), plus "recently removed" chips (see Enable/disable semantics) with
  one-click re-enable.

Install flow: renderer-side dialog asks **Global / This project / Cancel**
with the last used scope preselected; writes via IPC; success toast reminds
"restart opencode to load the plugin".

## Data flow

```
Catalog:  renderer → IPC → main: fetch ecosystem + awesome lists
          → npm enrich → cache (TTL 24h) → renderer
Install:  renderer → scope dialog → IPC plugins:install
          → main mutates target opencode.json → toast
Manage:   renderer → IPC plugins:read-configs → diff view
          → mutations via plugins:remove / re-install
```

## Enable/disable semantics

opencode config has no `enabled: false` for plugins. Therefore:

- **Disable** = remove the entry from the config, but remember it in a
  desktop-local "recently removed" list (persisted in desktop store) so the
  Manage view can offer one-click re-enable (re-writes the same entry form
  and options).
- **Uninstall** = remove entry, drop from recently-removed, confirm first.

## Error handling

- Catalog fetch failure → serve disk cache, show stale banner; no cache →
  show error state in Browse with retry; Installed/Manage views unaffected
  (they read local configs).
- npm enrichment failure → entry shown with partial metadata, not an error.
- Config parse failure → refuse all writes to that file; show path and an
  "Open config file" action.
- Write race (file changed on disk since read) → re-read, re-apply mutation
  only if the plugin array is unchanged; otherwise surface a conflict error.
- IPC not available (non-desktop renderer) → tab hidden, no graceful-degrade
  UI needed.

## Testing

- Unit (colocated `*.test.ts` in `main/`, matching repo convention):
  - config parsing/mutation: JSON + JSONC, string and tuple entries,
    unknown-key + `$schema` preservation, comment-preserving JSONC edits and
    rewrite fallback, conflict detection.
  - catalog: mocked fetches for ecosystem page, awesome README, npm registry,
    downloads API; de-duplication; cache TTL behavior; stale-cache fallback.
- Storybook story for the Plugins tab (Browse, Installed states, install
  scope dialog), colocated in `settings-v2` following
  `interface-transition.stories.tsx` precedent.
- Storybook story for the Plugins tab (Browse, Installed states, install
  scope dialog), colocated in `settings-v2` following
  `interface-transition.stories.tsx` precedent.
- Manual checklist: install global vs project, JSONC preservation with real
  user configs, offline behavior, restart reminder toast, hide tab on
  non-desktop builds.

## Non-goals (v1)

- No plugin auto-update.
- No changes to TUI, server, or core opencode packages.
- No publishing/authoring flow.
- No ratings, reviews, or security scanning of plugins.
- No support for git/file-path plugin sources in install UI (they remain
  valid config values; manager preserves them if hand-added).

## Future

The catalog/config logic is isolated in `plugin-manager.ts` so it can later
graduate to the opencode server (approach C) and benefit TUI/web clients.
The settings tab can be replaced by a dedicated app-store-style window
(approach B) reusing the same IPC surface.