## Context

KanCode is a TUI/CLI-focused fork of OpenCode (`puetsua/kancode`). Package names (`@opencode-ai/*`, `packages/opencode`) and the provider id `"opencode"` (OpenCode Zen) stay as-is. User-facing strings, config discovery, env aliases, and XDG paths need a dual-brand compatibility layer so existing OpenCode users keep working while new installs prefer KanCode names.

## Goals / Non-Goals

**Goals:**

- Show KanCode / `kancode` in TUI title, CLI help, agent prompts, ACP name, READMEs, and bug URLs
- Ship `kancode` as preferred binary name with `opencode` as shim/alias
- Dual-read configs, project dirs, env flags, and data dirs with clear precedence
- Soften upstream SaaS upsell; point issues/docs at this fork
- Document rules in OpenSpec, AGENTS.md, and README

**Non-Goals:**

- Renaming npm packages, folder layout, Effect service IDs, or provider id `"opencode"`
- Copying/migrating data dirs on disk (read-fallback only)
- Changing `$schema` URLs away from `opencode.ai/config.json` (keep for editor schema compatibility)
- Restoring pruned web/desktop/console surfaces

## Decisions

### 1. Config file precedence (global + project root)

**Decision:** Project scope **merge-includes** both filename families when present.

Per directory merge order:

1. Preferred OpenCode file: `opencode.jsonc` else `opencode.json`
2. Preferred KanCode file: `kancode.jsonc` else `kancode.json` (overrides OpenCode on conflict)

**User scope** (XDG/global config directory): KanCode only — `kancode.jsonc`, `kancode.json`, then legacy `config.json`. Do **not** fall back to `opencode.json(c)`.

**Alternative considered:** First-existing-wins (KanCode exclusive when both exist) — rejected; users who keep OpenCode settings alongside a thin KanCode overlay need merge-include.

### 2. Project directory discovery (`.kancode` / `.opencode`)

**Decision:** At project/worktree ancestry, discover both `.kancode` and `.opencode`. When both exist at the same ancestry level, load `.kancode` after `.opencode` so KanCode wins on merge conflict. Config files inside each dir follow project merge-include. Both directories may contribute agents/commands/plugins. At user home, discover `.kancode` only — never `~/.opencode`.

**Alternative considered:** Prefer only one dir name everywhere — rejected for projects; breaks users who already have `.opencode/`. User-scope KanCode-only is intentional for this fork.

### 3. Env flag aliases

**Decision:** Keep all `Flag.OPENCODE_*` property names (code API unchanged). Resolution: if `KANCODE_<SUFFIX>` is set, use it; else use `OPENCODE_<SUFFIX>`. Apply via a small `envAlias(suffix)` helper in `packages/core/src/flag/flag.ts`. Also set `process.env.KANCODE = "1"` (and keep `OPENCODE = "1"`) in CLI middleware for detection.

### 4. XDG / data paths

**Decision:** App name for user-scope paths is always `kancode`.

- **Config / data / cache / state / tmp / managed**: always `kancode` (create if missing); no fallback to `opencode`

No automatic copy/migrate from legacy OpenCode dirs; users can move dirs manually if needed.

### 5. Binary naming

**Decision:** Add `kancode` as primary bin entry pointing at the same launcher; keep `opencode` bin entry as alias. CLI `scriptName("kancode")`. Help logo detection accepts either prefix.

### 6. Intentional residual OpenCode strings

Leave as OpenCode where they are product/provider/schema/package identity:

- Provider id `"opencode"` / OpenCode Zen
- `@opencode-ai/*` package names and Effect `@opencode/...` service IDs
- Config `$schema` `https://opencode.ai/config.json` (and tui schema URL)
- Upstream install/update URLs that still refer to anomalyco packaging until this fork publishes releases
- Tree-sitter wasm URLs under anomalyco (technical assets, not product branding)

### 7. Upsell / SaaS copy

**Decision:** Soften OpenCode Go / zen marketing in TUI and retry tips. Keep OpenCode Zen as a connectable provider (product name / id `"opencode"`), but do **not** ship it as the default or promote a public free tier. Users enable Zen explicitly via `/connect`, `OPENCODE_API_KEY`, auth credentials, or `provider.opencode` in `kancode.json` / `opencode.json`. Remove pressure copy that pushes opencode.ai subscriptions where this fork does not operate that SaaS. Bug report URL → `https://github.com/puetsua/kancode/issues`.

### 8. OpenCode Zen is opt-in

**Decision:** Stop auto-loading Zen with a public API key and stop preferring `"opencode"` when resolving a default model. First-run / no-config installs require the user to configure any provider (Anthropic, OpenAI, Copilot, Zen, etc.). Zen plugin code and models.dev catalog entry remain so configured users keep full access.

## Risks / Trade-offs

- [Dual dirs load more plugins/agents] → Mitigation: document precedence; merge is existing behavior
- [Empty kancode data dir shadows nonempty opencode] → Mitigation: nonempty check before preferring kancode
- [Both KANCODE_* and OPENCODE_* set differently] → Mitigation: KANCODE wins; document in AGENTS/README
- [Incomplete string sweep] → Mitigation: prioritize hotspots; leave intentional residuals listed in design

## Migration Plan

1. Ship dual-read; no forced migration
2. Existing users keep working with `opencode.json` / `.opencode/` / `OPENCODE_*`
3. New users can adopt `kancode.json` / `.kancode/` / `KANCODE_*`
4. Rollback: revert branding commits; dual-read is additive

## Open Questions

None blocking; packaging/release channels remain out of scope for this change.
