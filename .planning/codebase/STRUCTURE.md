# Codebase Structure

**Analysis Date:** 2026-01-19

## Directory Layout

```
opencode/
├── packages/                    # Monorepo packages (main code)
│   ├── opencode/               # Core CLI and backend (main package)
│   ├── app/                    # Web app frontend (SolidJS)
│   ├── ui/                     # Shared UI components library
│   ├── desktop/                # Tauri desktop app wrapper
│   ├── sdk/                    # TypeScript SDK for API clients
│   ├── plugin/                 # Plugin system types and utilities
│   ├── util/                   # Shared utilities (error handling)
│   ├── web/                    # Marketing site and docs (Astro)
│   ├── enterprise/             # Enterprise features (SolidStart)
│   ├── function/               # Serverless functions
│   ├── slack/                  # Slack integration
│   ├── script/                 # Build scripts package
│   ├── docs/                   # Documentation content
│   ├── console/                # Admin console
│   ├── extensions/             # IDE extensions placeholder
│   └── identity/               # Identity/auth package
├── sdks/                       # External SDK implementations
│   └── vscode/                 # VSCode extension
├── github/                     # GitHub-related tooling
├── infra/                      # Infrastructure configuration
├── nix/                        # Nix build definitions
├── script/                     # Root-level build scripts
├── specs/                      # OpenAPI/type specifications
├── patches/                    # Dependency patches
├── themes/                     # Theme definitions
├── logs/                       # Log output directory
├── .opencode/                  # Local opencode configuration
└── .planning/                  # Planning documents
```

## Directory Purposes

**packages/opencode/:**
- Purpose: Core application - CLI, server, AI integration
- Contains: TypeScript source for all backend logic
- Key files: `src/index.ts` (entry), `src/server/server.ts`, `src/session/index.ts`

**packages/opencode/src/:**
- Purpose: Main source code organized by domain
- Contains: Feature modules as directories
- Key directories: `cli/`, `session/`, `provider/`, `tool/`, `server/`, `agent/`

**packages/app/:**
- Purpose: Web-based UI application
- Contains: SolidJS components, pages, context providers
- Key files: `src/entry.tsx`, `src/app.tsx`, `src/context/`

**packages/ui/:**
- Purpose: Reusable UI component library
- Contains: SolidJS components, themes, styles, assets
- Key files: `src/components/*.tsx`, `src/theme/`, `src/styles/`

**packages/desktop/:**
- Purpose: Native desktop app via Tauri
- Contains: Tauri config, frontend wrapper, platform scripts
- Key files: `src-tauri/` (Rust backend), `src/` (JS entry)

**packages/sdk/js/:**
- Purpose: TypeScript SDK for API consumers
- Contains: Generated API client from OpenAPI spec
- Key files: `src/v2/index.ts`, `src/client.ts`

**packages/plugin/:**
- Purpose: Plugin system types and utilities
- Contains: Tool definition types, plugin interfaces
- Key files: `src/index.ts`, `src/tool.ts`

**packages/enterprise/:**
- Purpose: Enterprise features (sharing, teams)
- Contains: SolidStart app, API routes
- Key files: `src/routes/`, `src/core/`

**packages/web/:**
- Purpose: Marketing website and documentation
- Contains: Astro site with Starlight docs
- Key files: `src/content/docs/`, `src/pages/`

## Key File Locations

**Entry Points:**
- `packages/opencode/src/index.ts`: CLI entry, command dispatch
- `packages/opencode/src/server/server.ts`: HTTP server, routes
- `packages/app/src/entry.tsx`: Web app mount point
- `packages/desktop/src/main.tsx`: Desktop app entry

**Configuration:**
- `package.json`: Root monorepo config, workspaces
- `turbo.json`: Turborepo build configuration
- `packages/opencode/src/config/config.ts`: Config loading logic
- `sst.config.ts`: SST deployment configuration

**Core Logic:**
- `packages/opencode/src/session/index.ts`: Session management
- `packages/opencode/src/session/processor.ts`: LLM stream processing
- `packages/opencode/src/provider/provider.ts`: Provider registry
- `packages/opencode/src/tool/registry.ts`: Tool registration
- `packages/opencode/src/agent/agent.ts`: Agent definitions

**Server Routes:**
- `packages/opencode/src/server/routes/session.ts`: Session API
- `packages/opencode/src/server/routes/provider.ts`: Provider API
- `packages/opencode/src/server/routes/config.ts`: Config API

**Testing:**
- `packages/opencode/src/**/*.test.ts`: Co-located test files
- `packages/enterprise/test/`: Enterprise tests

## Naming Conventions

**Files:**
- `kebab-case.ts`: Most source files
- `index.ts`: Module exports (barrel pattern)
- `*.test.ts`: Test files co-located with source
- `*.txt`: Prompt templates

**Directories:**
- `lowercase-hyphenated/`: Feature modules
- `src/`: Source code root in packages

**Code:**
- `PascalCase`: Types, interfaces, classes, namespaces
- `camelCase`: Functions, variables, properties
- Namespace pattern: `export namespace Foo { ... }` for module organization

## Where to Add New Code

**New CLI Command:**
- Implementation: `packages/opencode/src/cli/cmd/{command}.ts`
- Registration: Import in `packages/opencode/src/index.ts`, add to yargs

**New Tool:**
- Implementation: `packages/opencode/src/tool/{toolname}.ts`
- Registration: Import in `packages/opencode/src/tool/registry.ts`
- Pattern: Use `Tool.define()` factory

**New Server Route:**
- Implementation: `packages/opencode/src/server/routes/{route}.ts`
- Registration: Mount in `packages/opencode/src/server/server.ts`
- Pattern: Create Hono router with `describeRoute` decorators

**New UI Component:**
- Shared: `packages/ui/src/components/{Component}.tsx`
- App-specific: `packages/app/src/components/{Component}.tsx`
- Export: Add to `packages/ui/package.json` exports

**New Provider:**
- Config: Add to `packages/opencode/src/provider/provider.ts` BUNDLED_PROVIDERS or CUSTOM_LOADERS
- Models: Update models.dev data or add to config

**New Agent:**
- Config-based: Add to `.opencode/agent/{name}.md` with frontmatter
- Code-based: Add to `packages/opencode/src/agent/agent.ts` result object

**Utilities:**
- Opencode-specific: `packages/opencode/src/util/{utility}.ts`
- Cross-package: `packages/util/src/{utility}.ts`

## Special Directories

**.opencode/:**
- Purpose: Local project configuration
- Generated: Partially (node_modules)
- Committed: Yes (config files, agents, commands)
- Contains: `agent/`, `command/`, `tool/`, `plugin/`, `themes/`

**node_modules/:**
- Purpose: Package dependencies
- Generated: Yes (by bun install)
- Committed: No

**.turbo/:**
- Purpose: Turborepo cache
- Generated: Yes
- Committed: No

**logs/:**
- Purpose: Runtime log output
- Generated: Yes
- Committed: No

**specs/:**
- Purpose: OpenAPI specifications
- Generated: Partially (from code)
- Committed: Yes

## Package Dependencies

**Internal dependency flow:**
```
opencode ─┬─> @opencode-ai/util
          ├─> @opencode-ai/plugin
          ├─> @opencode-ai/sdk
          └─> @opencode-ai/script

app ─┬─> @opencode-ai/ui
     ├─> @opencode-ai/sdk
     └─> @opencode-ai/util

ui ─┬─> @opencode-ai/sdk
    └─> @opencode-ai/util

desktop ─┬─> @opencode-ai/app
         └─> @opencode-ai/ui

enterprise ─┬─> @opencode-ai/ui
            └─> @opencode-ai/util
```

---

*Structure analysis: 2026-01-19*
