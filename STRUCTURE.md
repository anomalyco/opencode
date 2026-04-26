# Codebase Structure

## Directory Layout

```
[project-root]/
├── packages/
│   ├── app/                # Web frontend application (SolidJS/Vite)
│   ├── console/            # Console application and related packages
│   ├── core/               # Shared core logic, utilities, and Effect primitives
│   ├── desktop-electron/   # Desktop application (Electron)
│   ├── desktop/            # Desktop application (Tauri)
│   ├── docs/               # Project documentation site
│   ├── opencode/           # Main CLI tool and backend logic (Effect-based)
│   ├── plugin/             # Plugin system
│   ├── sdk/                # SDKs for different languages (js)
│   └── ui/                 # Shared UI components
├── .github/                # GitHub Actions and templates
└── .opencode/              # Built-in opencode tools, skills, agents, plugins
```

## Directory Purposes

**packages/opencode:**
- Purpose: Main application logic, agent implementations, and CLI commands.
- Contains: `yargs` CLI setup, database configuration, tools, and session logic.
- Key files: `src/index.ts`, `src/agent/agent.ts`, `src/cli/cmd/*`

**packages/core:**
- Purpose: Reusable foundational utilities and abstractions.
- Contains: Effect logger, runtime logic, global abstractions, and various general utilities.
- Key files: `src/global.ts`, `src/util/*`

**packages/app & packages/desktop-electron:**
- Purpose: Frontends for the opencode application (Web and Electron desktop respectively).

**.opencode:**
- Purpose: Central repository for built-in configurations of the application itself.
- Contains: Default agents, skills, plugins, and commands.

## Key File Locations

**Entry Points:** 
- `packages/opencode/src/index.ts`: Main entry point for the CLI, initializing Yargs commands and database migration.
- `packages/app/src/index.ts`: Web frontend entry point.
- `packages/desktop-electron/src/index.ts`: Electron desktop app entry point.

**Configuration:** 
- `package.json`: Main workspace configuration defining scripts like `dev:web`, `dev:desktop`, and dependency catalog.

**Core Logic:** 
- `packages/opencode/src/agent/agent.ts`: Schema definitions and core configuration for Agents.
- `packages/opencode/src/session/processor.ts`: Logic for session prompt processing.

**Tests:** 
- Co-located within package `test` directories (e.g., `packages/opencode/test/**/*.test.ts`).

## Naming Conventions

**Files:** kebab-case or dot-separated for commands/utils: `run-state.ts`, `agent.ts`
**Directories:** kebab-case: `desktop-electron`, `control-plane`

## Where to Add New Code

**New CLI command:** `packages/opencode/src/cli/cmd/[command-name].ts`
**New core utility:** `packages/core/src/util/[util-name].ts`
**New built-in skill:** `.opencode/skills/[skill-name]/`
**Tests:** Co-located within the specific package's `test` directory (e.g., `packages/opencode/test/`)
