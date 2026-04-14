# Changelog

All notable changes to OpenCode are documented here.

## v1.4.3 (April 10, 2026)

### Core
- Fixed `agent create` for OpenAI accounts authenticated with OAuth
- Interrupted Bash commands now keep their final output and truncation details instead of ending as aborted
- Added fast mode variants for supported Claude and GPT models

### TUI
- Restored the hidden session scrollbar as the default

### Extensions
- Added configurable OAuth redirect URIs for remote MCP servers

## v1.4.2 (April 9, 2026)

### TUI
- Fix subagents not being clickable until finished

### Desktop
- Removed the forced loading delay while the app connects

## v1.4.1 (April 9, 2026)

### Core
- Fix `clangd` choosing `CMakeLists.txt` or `Makefile` as the project root in C and C++ workspaces
- Add permission prompts for GitLab Duo Workflow tool calls instead of auto-running them
- Hide unsupported variants for Big Pickle models

### TUI
- Show an OpenCode Go subscribe prompt when free usage limits are reached
- Simplify provider labels in the model and provider pickers

### Desktop
- Fix terminal connections in same-origin desktop and web app setups
- Fix session review and change lists when diff data arrives in inconsistent shapes

### SDK
- Fix the generated SDK and OpenAPI types for `/providers` and session shell responses

## v1.4.0 (April 8, 2026)

### Breaking Changes in SDK

### Core
- Added OTLP observability export support
- Fixed failed web fetches leaving stale timeouts behind
- Improved `opencode login` transport error messages
- Retried Alibaba provider rate-limit errors instead of failing immediately
- Kept model variants scoped to the selected model
- Added full HTTP proxy support
- Fixed OpenRouter provider issues
- Aligned GitHub Copilot Anthropic reasoning levels and removed incorrect Qwen variants
- Reduced TypeScript LSP memory use by using the native project config

### TUI
- Added a keybinding option for "Switch model variant"
- Added PDF drag and drop for attachments
- Added `opencode run --dangerously-skip-permissions` to auto-approve non-denied permission prompts

### Desktop
- Improved subagent sessions with clearer titles, navigation, and progress states
- Moved auto-accept permissions into Settings
- Showed full file names on attachment chips

## v1.3.17 (April 6, 2026)

### Core
- Cloudflare Workers AI and AI Gateway now prompt for missing account details and show clear setup errors when required Cloudflare variables are missing

### TUI
- Restored the default kitty keyboard handling on Windows terminals to avoid input issues

## v1.3.16 (April 6, 2026)

### Core
- Support Azure model options on both chat and responses paths
- Expose session model and mode config options through ACP
- Add a separating blank line before read tool file contents for clearer output
- Fix output token totals when reasoning tokens are reported separately

### TUI
- Default `Ctrl+Z` to undo on Windows instead of terminal suspend
- Let you disable TUI mouse capture in config or with `OPENCODE_DISABLE_MOUSE`
- Hide org switching when there is only one org to choose from
- Label Console-managed providers and let you switch orgs from the provider UI

### Extensions
- Fix plugin installs from npm aliases and git URLs, including Windows cache path issues

## v1.3.15 (April 4, 2026)

### Core
- Prevent npm installs from failing when Arborist hits the compiled binary's `node-gyp` path

## v1.3.14 (April 4, 2026)

### Core
- Restored git-backed review modes, including uncommitted and branch diffs
- Fixed revert chains so restoring an earlier message also restores the right snapshot state
- Added macOS managed preferences for MDM-enforced config
- Fixed sessions getting stuck after tool calls with OpenAI-compatible providers
- Kept compaction summaries in the conversation's language
- Added Venice AI as a provider
- Respected model-specific `limit.input` overrides

### TUI
- Kept the prompt cursor with dialogs instead of refocusing the background prompt
- Added a one-time confirmation before sharing a session for the first time
- Applied scroll settings consistently across TUI scroll views
- Kept text selections intact during global key handling
- Fell back to the first available agent if the last-used agent is unavailable

### Desktop
- Added file mentions in review comments
- Restored prompt focus after closing agent, model, and variant pickers
- Added keyboard navigation and shortcuts to the question dock
- Hid model controls in shell mode
- Stopped the todo dock from auto-scrolling while tasks update

### SDK
- Fixed JS SDK server and TUI launch and shutdown on Windows
- Fixed object-defined `Tool.define()` tools from wrapping `execute` multiple times

### Extensions
- Added support for theme-only plugin packages

## v1.3.13 (April 1, 2026)

*No notable changes documented*

## v1.3.12 (March 31, 2026)

### Core
- Enabled prompt caching and cache token tracking for Google Vertex Anthropic
- Fixed Azure provider options being forwarded correctly after the AI SDK v6 migration

### TUI
- Fixed plugin `replace` slots mounting content more than once

## v1.3.11 (March 31, 2026)

### Core
- Add a dedicated system prompt for Kimi models

### TUI
- Improve TUI terminal output passthrough so external command output renders more reliably

### Extensions
- Skip plugins that do not expose a matching server or TUI entrypoint, warn instead of failing
- Apply default options from package exports on install
- Pin explicit plugin versions during install and block package install scripts from running

## v1.3.10 (March 31, 2026)

### Core
- Subagent tool calls stay clickable while they are pending
- Improved storage migration reliability so malformed legacy records or failed migrations do not corrupt upgraded state

### TUI
- Improved muted text contrast in the Catppuccin themes

## v1.3.9 (March 30, 2026)

### Core
- Fixed plugin entrypoint resolution for paths without leading dot

## v1.3.8 (March 30, 2026)

*No notable changes documented*

## v1.3.7 (March 30, 2026)

### Core
- Added first-class PowerShell support on Windows
- Plugin installs now preserve JSONC comments in configuration files
- Fixed `OPENCODE_DISABLE_CLAUDE_CODE_PROMPT` not being respected for project-level CLAUDE.md

### TUI
- Improved variant modal behavior to be less intrusive
- Added theme colors for dialog textarea placeholders

## v1.3.6 (March 29, 2026)

### TUI
- Fixed variant dialog search so typing now properly filters the list of variants

### Desktop
*No notable changes documented*

### Core
- Fixed token usage double-counting for Anthropic and Amazon Bedrock providers

## v1.3.5 (March 29, 2026)

### Core
- Fix plugin hooks to properly handle async operations
- Adjust GPT prompt to be more minimal and fix file reference annoyances

## v1.3.4 (March 29, 2026)

### Core
- Add prompt slot feature
- Update opencode-gitlab-auth to 2.0.1
- Refactored session processor to use effect-based architecture
- Use AppFileSystem instead of raw Filesystem for better abstraction
- Upgrade OpenTUI to version 0.1.91
- Adjust bash tool description to increase cache hit rates between projects
- Update Effect to version 4.0.0-beta.42
- Refactor session compaction service to use Effect
- Add single target plugin entrypoints
- Use ChildProcessSpawner instead of Process.spawn for formatting
- Move more responsibility to workspace routing
- Refactor Session service to use Effect-based architecture
- Add support for AI SDK v6
- Add additional overflow error patterns to error handling
- Fix flaky plugin tests by removing mock.module which is not supported in Bun
- Split out instance and route through workspaces
- Effectify Plugin service internals
- Effectify Skill service internals
- Add TUI plugins support
- Refactor tool registry to yield Config and Plugin services using Effect.forEach
- Ignore generated models snapshot files
- Replace async git() with ChildProcessSpawner in VCS module
- Yield services instead of promise facades in Effect refactor
- Fixed web UI bundle build on Windows
- Improve app startup performance
- Close MCP transport on failed or timed-out connections
- Use cachedInvalidateWithTTL for config and bump Effect to beta.37
- Refactor Config service to use Effect
- Remove workspace server and WorkspaceContext, improve routing architecture
- Add GPT prompt so non-Codex GPT models have their own system prompt modeled after Codex CLI
- Refactor LSP service with InstanceState using Effect

### TUI
- Use theme color for prompt placeholder
- Add dialog variant menu and improve subagent functionality
- Open dialog for model variant selection instead of cycling
- Check KV theme before falling back to default theme
- Add top spacing to session view and remove obsolete documentation prompt
- Restore subagent footer and fix style guide violations
- Add model variant selection dialog
- Remove variant cycle display from footer
- Move session context into prompt footer

### Desktop
- Improved app startup efficiency
- Use Azure Artifact Signing for Windows releases
- Default file tree to closed with minimum width
- Resize layout viewport when mobile keyboard appears
- Persist queued followups across project switches
- Reduce markdown jank while responses stream in UI
- Remove fork session button from app
- Default shell tool to collapsed state
- Don't bundle fonts in app

## v1.3.3 (March 26, 2026)

### TUI
- Bypass local SSE event streaming in worker for improved performance
- Fix image paste support on Windows Terminal 1.25+ with kitty keyboard enabled

### Desktop
- Embed WebUI directly in the binary with configurable proxy flags
- Fix agent normalization in desktop app
- Fix project switch flickering when using keybinds by pre-warming globalSync state
- Move message navigation from cmd+arrow to cmd+opt+[ / cmd+opt+] to preserve native cursor movement
- Add createDirectory option to directory picker in Electron app
- Remove `.json` extension from electron-store for seamless Tauri to Electron migration

### Core
- Initial implementation of event-sourced syncing system for session data
- Fix enterprise URL not being set properly during authentication flow
- Classify ZlibError from Bun fetch as retryable instead of unknown error
- Skip snapshotting files larger than 2MB to improve performance
- Respect agent permission configuration for todowrite tool
- Fix DWS workflow tools being silently cancelled due to missing tool approval support
- Fix MCP servers disappearing after transient errors and improve OAuth handling

### Misc
- Revert git-backed review modes to restore compatibility with older CLI builds

## v1.3.2 (March 24, 2026)

### TUI
- Added heap snapshot functionality allowing users to capture memory snapshots of both TUI and server processes via the "Write heap snapshot" command. Snapshots are saved to `tui.heapsnapshot` and `server.heapsnapshot` files.