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
- Fixed inherited model configs so interleaved-capability models keep working when that field falls back to an existing model.
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
- Fix project detection and caching for bare Git repos and worktrees.
- Improve session compaction so long threads keep more useful context when older history is summarized.
- Preserve UTF-8 BOMs when files are edited, patched, or rewritten through tools.
- Use Roslyn Language Server for C# support instead of `csharp-ls`.
- Add the high reasoning variant for supported Mistral Small models.
- Hide unsupported variants for Kimi models that do not expose them.

### TUI

- Fail fast when opening an invalid or missing session instead of starting the TUI in a broken state.
- Skip upgrade checks when auto-update is disabled.

### Desktop

- Keep project avatar previews consistent between the sidebar and edit dialog.
- Improve project icon overrides so uploaded icons and color fallbacks behave correctly in the edit dialog.
- Improve Linux desktop metadata for app listings and categorization.
