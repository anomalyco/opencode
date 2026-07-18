# Package Architecture Specification

## Purpose

Capture the live Bun monorepo package set and dependency direction so OpenSpec changes stay aligned with the current codebase.

## Requirements

### Requirement: Workspace Packages Match the TUI Monorepo

The workspace SHALL include the in-scope packages needed for TUI/CLI operation: `kancode` (`@kancode/cli`), `tui`, `ui`, `core`, `server`, `client`, `protocol`, `schema`, `sdk` (`packages/sdk/js`), `sdk-next`, `plugin`, `llm`, `codemode`, `effect-drizzle-sqlite`, `http-recorder`, `httpapi-codegen`, and `script`.

#### Scenario: Inventory reflects current packages
- **WHEN** a change lists affected packages
- **THEN** it names packages that exist under `packages/` in this repository
- **AND** it does not assume pruned packages such as `app`, `desktop`, `web`, or `console` still exist

### Requirement: Workspace Packages Use KanCode npm Scope

Editable workspace packages SHALL use the `@kancode/*` npm scope (app package `@kancode/cli` in `packages/kancode`). Effect service IDs SHALL use `@kancode/...`. The generated/client SDK namespace SHALL be `KanCode`. The repository MUST NOT reintroduce `@opencode-ai/*` package names for workspace packages. The upstream provider catalog id `"opencode"` (OpenCode Zen) MAY remain unchanged.

#### Scenario: New workspace dependency uses KanCode scope
- **WHEN** a change adds or renames a workspace package dependency
- **THEN** the dependency name uses `@kancode/<name>`
- **AND** it does not introduce `@opencode-ai/<name>` for an in-repo package

### Requirement: Published CLI npm Identity

The CLI app package in the workspace SHALL remain `@kancode/cli` (`packages/kancode`). The published npm distribution name SHALL be `@puetsua/kancode` with bin `kancode`. Planning and release docs MUST NOT treat the workspace name and the published npm name as interchangeable without stating both.

#### Scenario: Install docs match published name
- **WHEN** user-facing install instructions name the npm package
- **THEN** they use `@puetsua/kancode` and the `kancode` binary
- **AND** they do not claim the published name is `@kancode/cli`

### Requirement: Runtime Dependency Direction

Runtime dependencies SHALL follow this direction: Schema depends on nothing above it in the stack; Core and Protocol sit above Schema; Server depends on Core and Protocol. Client runtime code MAY depend on Schema and Protocol but MUST NOT depend on Core or Server. `sdk-next` MAY compose Client, Core, and Server.

#### Scenario: Client stays free of Core and Server
- **WHEN** Client runtime code is changed
- **THEN** new imports MUST NOT pull in Core or Server
- **AND** Schema/Protocol usage remains allowed

### Requirement: Agent Guidance Lives in AGENTS.md

Project coding rules SHALL continue to live in root `AGENTS.md` and package-level `AGENTS.md` files. OpenSpec project config MAY summarize constraints for planning prompts but MUST NOT replace those files as the source of day-to-day coding guidance.

#### Scenario: Implementers follow AGENTS.md
- **WHEN** applying an OpenSpec change that touches code style, Effect usage, or package boundaries
- **THEN** implementers follow root and package `AGENTS.md` rules
- **AND** OpenSpec artifacts remain consistent with those rules

### Requirement: Typecheck and Tests Stay Package-Local

Typechecking SHALL use `bun typecheck` from the relevant package directory. Tests MUST NOT be run from the repository root (root `test` is intentionally guarded).

#### Scenario: Validation from a package directory
- **WHEN** a change needs typecheck verification
- **THEN** `bun typecheck` is run inside the affected package directory
- **AND** tests are run from the appropriate package directory when needed
