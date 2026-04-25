# Changelog

New updates and improvements to OpenCode

## [v1.14.25](https://github.com/anomalyco/opencode/releases/tag/v1.14.25)

Apr 25, 2026

### Core

- Fixed permission config preserving rule order and exposes full IntelliSense for tool permission keys
- LSP permission prompts now include request details like the operation, file, and cursor position
- Shell commands keep the correct working directory after login shell startup files run
- Added Roslyn LSP support for Razor, `.cshtml`, and C# script files
- GPT-5.5 with OpenAI OAuth now uses the correct context limits to avoid compaction issues

## [v1.14.24](https://github.com/anomalyco/opencode/releases/tag/v1.14.24)

Apr 24, 2026

### Core

- Fixed DeepSeek assistant messages so reasoning is always included, avoiding provider formatting failures.
- Fixed inherited model configs so interleaved-capability models keep working when that field falls back to an existing model. (@07akioni)
- Added an experimental HTTP API endpoint for MCP server status.
- Added experimental HTTP API endpoints to list files, read file contents, and check project file status.

## [v1.14.23](https://github.com/anomalyco/opencode/releases/tag/v1.14.23)

Apr 24, 2026

### Core

- Respect custom `.npmrc` registry settings when checking package versions and updates.

### TUI

- Render all non-synthetic text in a user message instead of showing only the first text block.

## [v1.14.22](https://github.com/anomalyco/opencode/releases/tag/v1.14.22)

Apr 23, 2026

### Core

- Respect `.npmrc` settings during npm installs.
- Let projects store a custom icon override so the chosen icon persists correctly.

### Desktop

- Fix session views and nested session items not getting stuck with stale state when switching between sessions.

## [v1.14.21](https://github.com/anomalyco/opencode/releases/tag/v1.14.21)

Apr 23, 2026

### Core

- Support pull diagnostics from LSP servers that use them, including C# and Kotlin.
- Fix project detection and caching for bare Git repos and worktrees. (@StevenTCramer)
- Improve session compaction so long threads keep more useful context when older history is summarized.
- Preserve UTF-8 BOMs when files are edited, patched, or rewritten through tools.
- Use Roslyn Language Server for C# support instead of `csharp-ls`. (@jmbryan4)
- Add the high reasoning variant for supported Mistral Small models. (@rubdos)
- Hide unsupported variants for Kimi models that do not expose them.

### TUI

- Fail fast when opening an invalid or missing session instead of starting the TUI in a broken state.
- Skip upgrade checks when auto-update is disabled. (@rahuliyer95)

### Desktop

- Keep project avatar previews consistent between the sidebar and edit dialog.
- Improve project icon overrides so uploaded icons and color fallbacks behave correctly in the edit dialog.
- Improve Linux desktop metadata for app listings and categorization. (@NN708)

## [v1.14.20](https://github.com/anomalyco/opencode/releases/tag/v1.14.20)

Apr 21, 2026

### Core

- Fixed a system theme regression in the TUI.
- Added `GET /config` to the experimental HTTP API.
- Fixed local dynamic imports on Windows when running under Node, improving plugin and tool loading.

### TUI

- Fixed permission replies using remote workspaces so they are sent to the correct workspace.

### Desktop

- Stopped prompt controls from replaying their fade-in animation on every render.
- Added a setting to hide the session progress bar while the agent is working.
- Fixed the Select Server dialog layout so the server list and actions size correctly. (@OpeOginni)
- Fixed synced project updates so desktop project state changes apply reliably.
- Fixed sidebar project avatars to fall back to `icon.url` when no override is set. (@ysm-dev)

### SDK

- Fixed the `WorkspaceAdaptor.create` type to include the `env` parameter. (@jamesmurdza)

## [v1.14.19](https://github.com/anomalyco/opencode/releases/tag/v1.14.19)

Apr 20, 2026

### Core

- Prevented compiled binaries from failing on startup because of a circular session schema dependency.
- Renamed the compaction setting to `preserve_recent_tokens` for the budget that keeps recent turns verbatim.
- Preserved concurrent edits to the same file instead of letting parallel edits overwrite each other.
- Fixed managed installs on Windows and added bundled ripgrep support for Windows ARM64.
- Added NVIDIA as a built-in provider option, including connection docs and required attribution headers. (@anniesurla)
- Kept recent conversation turns verbatim during session compaction so follow-up work keeps more local context.
- Fell back to summarizing the full conversation when preserved recent turns include too much media to fit safely.

### Desktop

- Reduced loading flicker when opening projects and bringing prompt controls online.
- Added a separate terminal font setting and bundled JetBrainsMono Nerd Font Mono.

## [v1.14.18](https://github.com/anomalyco/opencode/releases/tag/v1.14.18)

Apr 19, 2026

### Core

- Restore the native ripgrep backend so file search and file listing work reliably again.

## [v1.14.17](https://github.com/anomalyco/opencode/releases/tag/v1.14.17)

Apr 19, 2026

### Core

- Preserve executable permissions before Docker builds when artifacts lose their exec bits.
- Fix plugins reinstalling more often than needed.
- Use `display: summarized` by default for Anthropic Bedrock Opus 4.7 requests.
- Detect attachment types from file contents so images and PDFs still work with incorrect or missing extensions.
- Support `OTEL_RESOURCE_ATTRIBUTES` for custom telemetry resource tags.
- Fix package installs when `node_modules` is missing.
- Fix GitHub Copilot Anthropic Haiku requests by disabling unsupported tool streaming.

### TUI

- Add a full-session option when forking from the session dialog.
- Show the session ID in the sidebar on non-production channels.

## [v1.4.11](https://github.com/anomalyco/opencode/releases/tag/v1.4.11)

Apr 18, 2026

### Core

- Fixed workspace routing so requests reach the correct workspace instance.
- Stopped share sync attempts for sessions that were never shared.

## [v1.4.10](https://github.com/anomalyco/opencode/releases/tag/v1.4.10)

Apr 17, 2026

### Core

- Restored workspace history on connect so existing sessions catch up before live sync resumes
- Passed OTEL exporter settings into managed workspaces so telemetry works there too
- Normalized provider metadata defaults so models still load when catalog data is incomplete
- Passed `EXA_API_KEY` to the `websearch` tool to reduce rate limits (@rasdani)

### TUI

- Added a restore flow for sessions whose workspace is unavailable, with clearer workspace status indicators
- Fixed agent cycling when no agent is selected and improved prompt key handling

## [v1.4.9](https://github.com/anomalyco/opencode/releases/tag/v1.4.9)

Apr 17, 2026

### Core

- Added LLM Gateway as a provider, including config support and model usage reporting. (@smakosh)
- Limited GitHub Copilot Opus 4.7 models to medium reasoning effort to avoid unsupported variants. (@OpeOginni)
- Improved remote workspace reconnection with exponential backoff and clearer failure handling.

### TUI

- Fixed `--session-id` so it opens the requested session after app startup.
- Fixed light mode detection in Ghostty.

### Desktop

- Fixed the beta desktop app so the file tree still appears when enabled in settings.

## [v1.4.8](https://github.com/anomalyco/opencode/releases/tag/v1.4.8)

Apr 17, 2026

### Core

- Fixed a crash when experimental mode was enabled.
- Let plugin tools return metadata in execute results. (@jquense)
- Show real filenames instead of `/dev/null` in revert diffs.
- Improved workspace session handling when a workspace no longer exists.
- Fixed Windows `ctrl+z` terminal suspend and input undo behavior.
- Enabled Azure prompt caching with a default per-session cache key.

### TUI

- Preserve prompt input when views unmount and remount.
- Keep session list dialogs ordered more consistently within each day.

### Desktop

- Fixed desktop workspace loading so ready state persists correctly.
- Fixed desktop session syncing when loading project data from query cache.
- Added beta desktop settings to hide title bar tools like navigation, search, terminal, status, and file tree.
- Improved desktop session change loading in the review panel.

## [v1.4.7](https://github.com/anomalyco/opencode/releases/tag/v1.4.7)

Apr 16, 2026

### Core

- GitHub Copilot `gpt-5-mini` now uses low reasoning effort for better request compatibility. (@thakrarsagar)
- Workspaces now receive your auth context, so provider sign-in carries across workspace sessions.
- Cloudflare AI Gateway now drops `max_tokens` for OpenAI reasoning models so GPT-5 and o-series requests stop failing. (@kobicovaldev)
- Azure models now default `store=true`, fixing requests that require stored responses.
- Claude Opus 4.7 now supports `xhigh` adaptive reasoning. (@GrahamCampbell)
- Claude Opus 4.7 now shows summarized thinking by default.
- TUI plugins now load against the correct project when multiple directories are open.
- The bash tool uses less memory on large command output.
- Experimental workspaces now wait for sync to finish before returning writes, reducing stale reads and missed updates.
- Session restore can now replay a session into another workspace in batches.
- Sessions now retry provider 5xx errors even when the provider SDK does not mark them retryable.

### TUI

- Pasting files or large text no longer inserts content twice.
- `--agent` on the command line is no longer overwritten by the session's saved agent. (@CarloWood)
- Empty LSP, MCP, formatter, and session status responses no longer break TUI sync state.

### Desktop

- Desktop builds now show a Beta or Dev badge in the title bar when applicable.

## [v1.4.6](https://github.com/anomalyco/opencode/releases/tag/v1.4.6)

Apr 15, 2026

### Core

- Fixed snapshot staging for very long file lists and improved staging performance.
- Fixed OTEL header parsing when a header value contains `=`.

### Desktop

- Fixed prompt submission state updates to avoid failed or inconsistent sends.
- Improved session title input spacing while editing.

## [v1.4.5](https://github.com/anomalyco/opencode/releases/tag/v1.4.5)

Apr 15, 2026

### Core

- Export AI SDK telemetry spans to OTLP trace backends.
- Expose the experimental question API schema and OpenAPI spec from `@opencode-ai/server`.
- Expose a reusable question handler factory for custom question API hosts.

### Desktop

- Start desktop shell commands from the home directory.
- Avoid bootstrap error popups while global sync initializes.

## [v1.4.4](https://github.com/anomalyco/opencode/releases/tag/v1.4.4)

Apr 15, 2026

### Core

- Restored instance and logger context during prompt runs so prompt-time tools and logging behave correctly.
- Kept GitHub Copilot compaction requests valid.
- Restored the flat reply shape for question API responses.
- Persisted MCP OAuth connections that finish immediately, so authenticated servers stay connected.
- Prevented duplicate user messages in ACP clients.
- Stopped emitting `user_message_chunk` events during session and prompt turns in ACP clients. (@RAIT-09)
- Fixed reasoning summary injection for `@ai-sdk/openai-compatible` providers. (@nazarhnatyshen)
- Added the experimental `compaction.autocontinue` hook to stop auto-continuing after compaction.
- Added Alibaba provider support with cache support.
- Snapshots now fully respect `.gitignore`, including previously tracked files.
- Reading images no longer counts against quota.
- Sessions can now update project permissions mid-run. (@remorses)
- Enabled thinking for `zhipuai-coding-plan` and fixed Korean IME truncation. (@claudianus)

### TUI

- Added `opencode export --sanitize` to redact PII and confidential transcript data.
- Fixed diff line number contrast in built-in themes.
- Plugin auth login now asks for an API key when a plugin needs authorization. (@goniz)
- Plugin auth no longer asks for an API key when the plugin has no `authorize` method. (@goniz)

### Desktop

- Fixed the Windows desktop backend hanging before shutdown.

### SDK

- The JavaScript SDK now throws a clear error when an older server responds with HTML instead of the API.

### Extensions

- Plugins can now register custom workspace adaptors that appear in workspace creation.

## [v1.4.3](https://github.com/anomalyco/opencode/releases/tag/v1.4.3)

Apr 10, 2026

### Core

- Fixed `agent create` for OpenAI accounts authenticated with OAuth.
- Interrupted Bash commands now keep their final output and truncation details instead of ending as aborted.
- Added fast mode variants for supported Claude and GPT models.

### TUI

- Restored the hidden session scrollbar as the default.

### Extensions

- Added configurable OAuth redirect URIs for remote MCP servers. (@egze)

## [v1.4.2](https://github.com/anomalyco/opencode/releases/tag/v1.4.2)

Apr 9, 2026

### TUI

- Fix subagents not being clickable until finished

### Desktop

- Removed the forced loading delay while the app connects

## [v1.4.1](https://github.com/anomalyco/opencode/releases/tag/v1.4.1)

Apr 9, 2026

### Core

- Fix `clangd` choosing `CMakeLists.txt` or `Makefile` as the project root in C and C++ workspaces. (@nonbanana)
- Add permission prompts for GitLab Duo Workflow tool calls instead of auto-running them. (@vglafirov)
- Hide unsupported variants for Big Pickle models.

### TUI

- Show an OpenCode Go subscribe prompt when free usage limits are reached.
- Simplify provider labels in the model and provider pickers.

### Desktop

- Fix terminal connections in same-origin desktop and web app setups. (@OpeOginni)
- Fix session review and change lists when diff data arrives in inconsistent shapes.

### SDK

- Fix the generated SDK and OpenAPI types for `/providers` and session shell responses.
