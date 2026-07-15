# Branding Compatibility Specification

## Purpose

User-facing KanCode branding plus dual-read compatibility for config files, project dirs, env flags, and XDG/data paths so existing OpenCode configs keep working while new installs prefer KanCode names.

## Requirements

### Requirement: User-Facing Brand Is KanCode

The product SHALL present itself as KanCode in user-facing surfaces including the TUI terminal title, CLI script/help name, ACP agent name, default agent identity prompts, README product name, and bug-report URLs for this fork.

#### Scenario: TUI title uses KanCode
- **WHEN** the TUI starts and sets the terminal title
- **THEN** the title uses KanCode (not OpenCode)

#### Scenario: CLI help uses kancode
- **WHEN** a user runs the CLI help
- **THEN** the script name shown is `kancode`

#### Scenario: Bug reports point at this fork
- **WHEN** the TUI builds a new-issue URL for a crash or error report
- **THEN** the URL targets `puetsua/kancode` (or the configured GitHub remote for this fork)

### Requirement: Binary Prefers kancode With opencode Alias

The package bin entries SHALL prefer `kancode` as the primary command name and MUST keep `opencode` as an alias that launches the same entrypoint.

#### Scenario: Both bin names resolve
- **WHEN** either `kancode` or `opencode` is invoked from an installed package bin
- **THEN** the same application entrypoint runs

### Requirement: Config File Merge-Include With KanCode Precedence (Project Scope)

Project and worktree config loading SHALL accept `kancode.json` / `kancode.jsonc` and `opencode.json` / `opencode.jsonc`. When both KanCode and OpenCode config filenames exist in the same directory, the system MUST load and merge both (OpenCode first, then KanCode). KanCode MUST win on conflicting keys. Within each filename family, `.jsonc` is preferred over `.json` (at most one file per family).

#### Scenario: Merge both when present
- **WHEN** a project directory contains both `kancode.json` and `opencode.json`
- **THEN** both files are loaded
- **AND** keys from `kancode.json` override conflicting keys from `opencode.json`

#### Scenario: OpenCode alone still works
- **WHEN** a project directory has `opencode.json` and no `kancode.json` / `kancode.jsonc`
- **THEN** config is loaded from `opencode.json`

### Requirement: User Scope Is KanCode Only

User-scope config discovery and load (XDG/global config directory, home `~/.kancode`, and user-global writers) SHALL use only KanCode names: `kancode.json` / `kancode.jsonc` and `.kancode/`. The system MUST NOT read `opencode.json` / `opencode.jsonc` or discover `~/.opencode` at user scope. Managed/system config directory paths SHALL use the `kancode` application name only (no fallback to an `opencode` managed directory).

#### Scenario: Global config ignores opencode.json
- **WHEN** the XDG/global config directory contains only `opencode.json`
- **THEN** that file is not loaded as user-scope config

#### Scenario: Home discovers .kancode only
- **WHEN** the user's home directory has both `~/.opencode/` and `~/.kancode/`
- **THEN** only `~/.kancode/` is discovered as a user-scope config directory

### Requirement: Project Directory Dual-Read With KanCode Precedence

Project config directories SHALL be discovered for both `.kancode` and `.opencode`. When both exist at the same path level, content from `.kancode` MUST take precedence on conflicting keys after merge. Config files inside each discovered project directory follow the project merge-include rules (OpenCode then KanCode).

#### Scenario: Both project dirs are discovered
- **WHEN** a project has `.opencode/` and `.kancode/` directories
- **THEN** both are loaded as config directories
- **AND** `.kancode` wins on conflicting merged settings

#### Scenario: Legacy .opencode alone still works
- **WHEN** a project has only `.opencode/`
- **THEN** that directory is still discovered and loaded

### Requirement: Env Flag Aliases

The system MUST continue to honor `OPENCODE_*` environment variables. It SHALL also accept `KANCODE_*` aliases for the same flags. When both a `KANCODE_*` and corresponding `OPENCODE_*` variable are set, the `KANCODE_*` value MUST win.

#### Scenario: OPENCODE flag still works
- **WHEN** only `OPENCODE_CONFIG` is set
- **THEN** that path is used as the custom config path

#### Scenario: KANCODE alias wins
- **WHEN** both `KANCODE_CONFIG` and `OPENCODE_CONFIG` are set to different paths
- **THEN** `KANCODE_CONFIG` is used

### Requirement: XDG Paths — User Scope Always KanCode

The XDG **config**, **data**, **cache**, **state**, and **tmp** application directories SHALL always use the `kancode` name. The system MUST create the `kancode` path when missing and MUST NOT fall back to existing `opencode` XDG or tmp directories for user-scope runtime state.

#### Scenario: Config XDG is always kancode
- **WHEN** Global config paths are resolved
- **THEN** they resolve under the `kancode` application name even if an `opencode` config directory exists

#### Scenario: Data cache state tmp are always kancode
- **WHEN** Global data, cache, state, or tmp paths are resolved
- **THEN** they resolve under the `kancode` application name even if a nonempty `opencode` directory exists

### Requirement: Soften Upstream SaaS Upsell

User-facing copy that clearly markets anomalyco/opencode.ai SaaS subscriptions (for example OpenCode Go upsell) SHALL be softened or removed in the TUI and related prompts. Provider product names that are not SaaS upsell (for example OpenCode Zen as a provider) MAY remain when the user opts in, but MUST NOT be presented as KanCode's default or recommended provider.

#### Scenario: Go upsell is not pushed as fork marketing
- **WHEN** a user encounters retry or provider messaging in the TUI
- **THEN** the copy does not push an OpenCode Go subscription as a KanCode product offering

#### Scenario: Zen is not the default provider
- **WHEN** a fresh install has no provider credentials and no configured model
- **THEN** OpenCode Zen (`"opencode"`) is not auto-loaded as an available default provider
- **AND** the user must configure a provider explicitly (for example `/connect`, env API key, or `provider` / `model` in kancode.json)

#### Scenario: Zen remains configurable
- **WHEN** the user sets `OPENCODE_API_KEY`, stores Zen auth via `/connect`, or configures `provider.opencode` with an API key
- **THEN** OpenCode Zen loads and can be selected like any other provider
