# Changelog

All notable changes to this project are documented here.

The canonical changelog is published at:
https://opencode.ai/changelog

This file mirrors the official OpenCode changelog so GitHub users and contributors can view release history directly in the repository.

---

# v1.4.0 — Apr 8, 2026

## Breaking Changes
Breaking Changes in SDK

## Core
- Added OTLP observability export support.
- Fixed failed web fetches leaving stale timeouts behind.
- Improved `opencode login` transport error messages.
- Retried Alibaba provider rate-limit errors instead of failing immediately.
- Kept model variants scoped to the selected model.
- Added full HTTP proxy support.
- Fixed OpenRouter provider issues.
- Aligned GitHub Copilot Anthropic reasoning levels and removed incorrect Qwen variants.
- Reduced TypeScript LSP memory use by using the native project config. (@derekbar90)

## TUI
- Added a keybinding option for "Switch model variant". (@ariane-emory)
- Added PDF drag and drop for attachments. (@gitpush-gitpaid)
- Added `opencode run --dangerously-skip-permissions` to auto-approve non-denied permission prompts.

## Desktop
- Improved subagent sessions with clearer titles, navigation, and progress states.
- Moved auto-accept permissions into Settings.
- Showed full file names on attachment chips.

---

# v1.3.17 — Apr 6, 2026

## Core
- Cloudflare Workers AI and AI Gateway now prompt for missing account details and show clear setup errors when required Cloudflare variables are missing. (@mchenco)

## TUI
- Restored the default kitty keyboard handling on Windows terminals to avoid input issues from the workaround rollback.

---

# v1.3.16 — Apr 6, 2026

## Core
- Support Azure model options on both chat and responses paths. (@meruiden)
- Expose session model and mode config options through ACP. (@georgeharker)
- Add a separating blank line before read tool file contents for clearer output.
- Fix output token totals when reasoning tokens are reported separately.

## TUI
- Default `Ctrl+Z` to undo on Windows instead of terminal suspend.
- Let you disable TUI mouse capture in config or with `OPENCODE_DISABLE_MOUSE`. (@blackheaven)
- Hide org switching when there is only one org to choose from.
- Label Console-managed providers and let you switch orgs from the provider UI.

## Extensions
- Fix plugin installs from npm aliases and git URLs, including Windows cache path issues.

---

# v1.3.15 — Apr 4, 2026

## Core
- Prevent npm installs from failing when Arborist hits the compiled binary's `node-gyp` path.

---

# v1.3.14 — Apr 4, 2026

## Core
- Restored git-backed review modes, including uncommitted and branch diffs.
- Fixed revert chains so restoring an earlier message also restores the right snapshot state. (@natewill)
- Added macOS managed preferences for MDM-enforced config. (@lennyvaknine43)
- Fixed sessions getting stuck after tool calls with OpenAI-compatible providers. (@valenvivaldi)
- Kept compaction summaries in the conversation's language. (@aaron-he-zhu)
- Added Venice AI as a provider. (@dpuyosa)
- Respected model-specific `limit.input` overrides. (@ykswang)

## TUI
- Kept the prompt cursor with dialogs instead of refocusing the background prompt.
- Added a one-time confirmation before sharing a session for the first time.
- Applied scroll settings consistently across TUI scroll views.
- Kept text selections intact during global key handling.
- Fell back to the first available agent if the last-used agent is unavailable.

## Desktop
- Added file mentions in review comments.
- Restored prompt focus after closing agent, model, and variant pickers.
- Added keyboard navigation and shortcuts to the question dock.
- Hid model controls in shell mode.
- Stopped the todo dock from auto-scrolling while tasks update.

## SDK
- Fixed JS SDK server and TUI launch and shutdown on Windows.
- Fixed object-defined `Tool.define()` tools from wrapping `execute` multiple times. (@jpcarranza94)

## Extensions
- Added support for theme-only plugin packages.

---

# v1.3.13 — Apr 1, 2026

(No changes listed)

---

# v1.3.12 — Mar 31, 2026

## Core
- Enabled prompt caching and cache token tracking for Google Vertex Anthropic. (@major)
- Fixed Azure provider options being forwarded correctly after the AI SDK v6 migration.

## TUI
- Fixed plugin `replace` slots mounting content more than once.

---

# v1.3.11 — Mar 31, 2026

## Core
- Add a dedicated system prompt for Kimi models. (@Yuxin-Dong)

## TUI
- Improve TUI terminal output passthrough so external command output renders more reliably.

## Extensions
- Skip plugins that do not expose a matching server or TUI entrypoint.
- Warn instead of failing when plugin entrypoints are missing.
- Apply default options from package exports on install.
- Pin explicit plugin versions during install.
- Block package install scripts from running.

---

# v1.3.10 — Mar 31, 2026

## Core
- Subagent tool calls stay clickable while they are pending.
- Improved storage migration reliability.

## TUI
- Improved muted text contrast in the Catppuccin themes.

---

# v1.3.9 — Mar 30, 2026

## Core
- Fixed plugin entrypoint resolution for paths without leading dot.

---

# v1.3.8 — Mar 30, 2026

(No changes listed)

---

# v1.3.7 — Mar 30, 2026

## Core
- Added first-class PowerShell support on Windows.
- Plugin installs now preserve JSONC comments in configuration files.
- Fixed `OPENCODE_DISABLE_CLAUDE_CODE_PROMPT` not being respected for project-level `CLAUDE.md`.

## TUI
- Improved variant modal behavior to be less intrusive.
- Added theme colors for dialog textarea placeholders.

---

# v1.3.6 — Mar 29, 2026

## TUI
- Fixed variant dialog search so typing now properly filters the list of variants.

## Core
- Fixed token usage double-counting for Anthropic and Amazon Bedrock providers.

---

# v1.3.5 — Mar 29, 2026

## Core
- Fix plugin hooks to properly handle async operations.
- Adjust GPT prompt to be more minimal and fix file reference annoyances.

---

# v1.3.4 — Mar 29, 2026

## Core
- Add prompt slot feature.
- Add support for AI SDK v6.
- Refactor session processing architecture.
- Improve plugin and configuration systems.

## TUI
- Add dialog variant menu and improve subagent functionality.

## Desktop
- Improved application startup efficiency.

---

# v1.3.3 — Mar 26, 2026

## TUI
- Improve SSE event streaming performance.

## Desktop
- Embed WebUI directly in the binary.
- Improve project switching behavior.

## Core
- Initial implementation of event-sourced syncing system for session data.

---

# v1.3.2 — Mar 24, 2026

## TUI
- Added heap snapshot functionality for capturing memory snapshots.

---

# v1.3.1 — Mar 24, 2026

## Features
- Added Poe as a built-in authentication provider.
- Enabled token caching for custom Amazon Bedrock providers.
- Added syntax highlighting support for Kotlin, HCL, Lua, and TOML.

## Fixes
- Fixed session timeline scrolling issues.
- Fixed stale session hover preview.
- Fixed prompt history navigation.

## Improvements
- Improved startup efficiency.
- Improved file tree resizing behavior.

---

# v1.3.0 — Mar 22, 2026

## Important
- Removed anthropic oauth plugin.

## New Features
- GitLab Agent Platform support.
- Git-backed session review modes.
- Multistep authentication support.
- Interactive update flow.
- Node.js runtime support.

## Improvements
- Major UI and UX improvements.
- Improved theme handling and agent ordering.

## Fixes
- Fixed remote server switching issues.
- Fixed Windows command execution issues.
- Improved tool discovery for npm packages.
