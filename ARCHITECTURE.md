# Architecture (Public)

This repo is a fork of OpenCode with a local-first desktop app and a Claxedo UI layer (`packages/claxedo-app/`). This document is intentionally high-level and grounded in the current code layout and design principles for local features.

## Principles / Decisions

- **Keep upstream code as upstream-owned:** treat `packages/app/` and other upstream packages as the source of truth; prefer extensions and overrides over patching upstream directly.
- **Localize divergence:** Claxedo-specific behavior should live in `packages/claxedo-app/`, so rebases stay mechanical.
- **Pure logic over DOM where possible:** move terminal/layout logic into testable helpers and keep lifecycle/DOM glue minimal.

## Top-Level Components

- `packages/opencode/`: core server/runtime (PTY, routes, etc.)
- `packages/app/`: upstream UI app (kept mostly pristine)
- `packages/app-shared/`: shared contracts/extension points
- `packages/claxedo-app/`: Claxedo UI + override/extension layer on top of `packages/app/`
- `packages/desktop/`: Tauri desktop shell + bindings

## Key Local Mechanisms

### Overrides (Upstream Compatibility)

`packages/claxedo-app/` uses a Vite alias-based override system to replace specific upstream modules while keeping `packages/app/` as upstream-owned.

### Directory Scope vs App Scope (Portal Pattern)

The UI has "app scope" chrome (tabs/layout) and "directory scope" providers (SDK/sync/terminal state). Directory-scoped content is created under the directory providers and portaled into app-scoped hosts so hooks like terminal/sync are always under the right providers.

### Terminal Stability (Reload/Split)

Terminal tabs are treated as stateful, with snapshot/persistence + conservative replay strategies on reload/split to keep fullscreen TUIs stable.
