# Branding Compatibility Specification

## Purpose

User-facing KanCode branding plus KanCode-only config paths (project and user), env flag aliases, and XDG/data paths. Legacy project `.opencode/` is not loaded at runtime; users migrate selected content via the `import-opencode` skill.

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

### Requirement: Binary Name Is kancode Only

The package bin entries SHALL expose `kancode` as the command name and MUST NOT register `opencode` as an alias for this fork's entrypoint.

#### Scenario: Installed bin is kancode
- **WHEN** the package is installed and its bin entries are inspected
- **THEN** `kancode` launches this application
- **AND** there is no `opencode` bin entry that launches KanCode

### Requirement: Project Scope Config Is KanCode Only

Project and worktree config loading SHALL accept only `kancode.json` / `kancode.jsonc`. The system MUST NOT read `opencode.json` / `opencode.jsonc` at project scope. Within the KanCode filename family, `.jsonc` is preferred over `.json` (at most one file per directory).

#### Scenario: KanCode config loads
- **WHEN** a project directory contains `kancode.json`
- **THEN** config is loaded from `kancode.json`

#### Scenario: OpenCode config filename is ignored
- **WHEN** a project directory has `opencode.json` and no `kancode.json` / `kancode.jsonc`
- **THEN** that file is not loaded as project config

### Requirement: User Scope Is KanCode Only

User-scope config discovery and load (XDG/global config directory, home `~/.kancode`, and user-global writers) SHALL use only KanCode names: `kancode.json` / `kancode.jsonc` and `.kancode/`. The system MUST NOT read `opencode.json` / `opencode.jsonc` or discover `~/.opencode` at user scope. Managed/system config directory paths SHALL use the `kancode` application name only (no fallback to an `opencode` managed directory).

#### Scenario: Global config ignores opencode.json
- **WHEN** the XDG/global config directory contains only `opencode.json`
- **THEN** that file is not loaded as user-scope config

#### Scenario: Home discovers .kancode only
- **WHEN** the user's home directory has both `~/.opencode/` and `~/.kancode/`
- **THEN** only `~/.kancode/` is discovered as a user-scope config directory

### Requirement: Project Directory Is .kancode Only

Project config directories SHALL be discovered for `.kancode` only. The system MUST NOT discover or load project `.opencode/` at runtime. Config files inside `.kancode/` follow the KanCode-only filename rules. Users MAY migrate skills, commands, agents, themes, or plans from a legacy `.opencode/` directory into `.kancode/` using the built-in `import-opencode` skill.

#### Scenario: .kancode is discovered
- **WHEN** a project has a `.kancode/` directory
- **THEN** that directory is loaded as a project config directory

#### Scenario: Project .opencode is ignored
- **WHEN** a project has only `.opencode/` (and no `.kancode/`)
- **THEN** that directory is not discovered as a project config directory

#### Scenario: Import skill is available
- **WHEN** skills are listed for a session
- **THEN** a built-in `import-opencode` skill is available to copy selected `.opencode/` content into `.kancode/`

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
