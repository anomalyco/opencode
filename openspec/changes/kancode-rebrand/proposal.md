## Why

This fork is already named KanCode (`puetsua/kancode`), but most user-facing surfaces still say OpenCode and point at anomalyco/opencode.ai. Users need clear KanCode branding while keeping existing OpenCode configs, env flags, and data directories working without migration pain.

## What Changes

- Rebrand user-facing display name, TUI title, CLI help/script name, agent identity prompts, ACP agent name, READMEs, and bug-report URLs to **KanCode** / `kancode` / `puetsua/kancode`
- Prefer binary name `kancode`; keep `opencode` as a shim/alias for muscle memory
- Dual-read config: prefer `kancode.json` / `kancode.jsonc` when present, else `opencode.json` / `opencode.jsonc`; discover both `.kancode/` and `.opencode/` with kancode winning on conflict
- Honor existing `OPENCODE_*` env flags; add `KANCODE_*` aliases that map to the same flags (KANCODE wins when both set)
- XDG/data dirs: prefer `kancode` paths; fall back to existing `opencode` dirs so sessions/config are not lost
- Soften or remove clear upstream SaaS upsell (OpenCode Go / zen marketing copy); point docs/issues at this fork
- Document precedence in OpenSpec + AGENTS/README
- Keep LICENSE attribution intact

Non-goals / not in this change:
- Renaming `@opencode-ai/*` packages or the `packages/opencode` folder
- Renaming Effect service IDs
- Renaming the upstream provider id `"opencode"` (OpenCode Zen)
- Restoring web/desktop/console surfaces
- Publishing new install/release channels

## Capabilities

### New Capabilities

- `branding-compat`: User-facing KanCode branding plus dual-read compatibility for config files, project dirs, env flags, and XDG/data paths

### Modified Capabilities

- `product-surface`: Product name and primary UX copy refer to KanCode while remaining a TUI/CLI-focused fork

## Impact

- `packages/opencode` (bin, CLI help, config loaders, prompts, ACP, uninstall/install copy)
- `packages/tui` (title, tips, error URLs, provider dialogs)
- `packages/core` (XDG app name / Global paths, Flag env aliases)
- Root `README.md` / `README.zht.md`, `AGENTS.md`, `openspec/config.yaml`
- Optional: `packages/ui` i18n strings if still present
