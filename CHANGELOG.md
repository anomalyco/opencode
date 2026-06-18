# Changelog — opencode-skein

Fork-specific changes on top of upstream opencode. Format follows
[Keep a Changelog](https://keepachangelog.com/). This file tracks **what the fork
adds**, not upstream's own release notes. The machine-readable feature list lives
in [`skein.json`](skein.json); the file-level inventory in
[`fork/manifest.json`](fork/manifest.json).

## [Unreleased]

### Added
- **Self-maintaining fork tooling**: `fork/manifest.json` inventory + `bun run
  fork:verify` (proves no fork feature was dropped after a sync) and `bun run
  sync:check` (detects when upstream moved past the recorded baseline and
  scaffolds the sync worktree).
- **Fork-owned distribution**: in-app updater + `install` script repointed to the
  fork (`androidand/opencode`), so the official updater can never overwrite the
  skein binary. `skein-release.yml` builds + publishes the CLI binaries as GitHub
  Releases.
- **Ecosystem manifest**: `skein.json` + `skein.schema.json` describing the fork's
  features for aggregation on tantonet.se/skein.

### Fixed
- Recovered the themed-loading-screen writer (`ThemeState.set`) lost in a prior
  sync; moved `theme-state` into `@opencode-ai/core` so the TUI (writer) and the
  provider (reader) share it across the package boundary.
- Re-created the `core/util/log` logger as a fork-owned shim after upstream
  replaced it with Effect logging (#31310), keeping fork-only modules building.

## [fork/2026-06-18.1] — 2026-06-18
Synced to upstream `8716c4309` (238 commits). Baseline recorded in the manifest.

### Added
- **/loop scheduling** — run a prompt/command on a schedule or until done
  (ralph-style iterate-until-complete, or interval/cron), with
  list/cancel/pause/resume.
- **Intelligent auto-reply** — auto-answer input prompts via static phrases,
  AI-to-AI continuation, or external webhook/CLI hooks.
- **Pattern detection** — detect and break agent repetition loops.

## Earlier (pre-changelog) fork features
Captured retroactively from git history; see `skein.json` for current status.

### Added
- **Local provider auto-discovery** — mDNS + LAN probe for Ollama / LM Studio /
  llama-swap backends, surfaced in `/connect`.
- **Context window display** — sidebar bar with tokens-vs-limit %, breakdown,
  tokens/sec, and cost for cloud providers.
- **Live VRAM/RAM bars** — stacked memory bar (model weights vs. KV cache) for
  local models.
- **Hardware-aware context-size picker** — recommends ctx size from live KV rate
  + free VRAM and applies it to the local model.

[Unreleased]: https://github.com/androidand/opencode/compare/fork/2026-06-18.1...dev
[fork/2026-06-18.1]: https://github.com/androidand/opencode/releases/tag/fork/2026-06-18.1
