# Codebase Structure

**Analysis Date:** 2026-01-27

## Directory Layout

```
opencode/
├── packages/              # Monorepo packages
│   ├── opencode/          # Core CLI and server
│   ├── app/               # Web frontend (SolidJS)
│   ├── console/           # Cloud console (SolidStart)
│   ├── sdk/               # TypeScript SDK
│   ├── ui/                # Shared UI components
│   ├── util/              # Shared utilities
│   ├── plugin/            # Plugin system
│   ├── script/            # Build scripts
│   ├── desktop/           # Desktop app (Tauri)
│   ├── opencode-broker/   # Rust auth broker
│   └── ...
├── infra/                 # SST infrastructure config
├── .planning/             # Planning and documentation
├── github/                # GitHub Actions integration
├── nix/                   # Nix configuration
├── sdks/                  # SDK generation
├── script/                # Root-level scripts
└── package.json           # Root workspace config
```

## Directory Purposes

**packages/opencode/:**

- Purpose: Core opencode application - CLI, server, session management, tools
- Contains: TypeScript source, command handlers, server routes, session logic, tool implementations
- Key files: `src/index.ts` (CLI entry), `src/server/server.ts` (HTTP server), `src/session/index.ts` (session management)

**packages/app/:**

- Purpose: Web-based frontend for opencode sessions
- Contains: SolidJS components, context providers, pages, Vite config
- Key files: `src/app.tsx` (root component), `src/entry.tsx` (entry point), `src/pages/session.tsx` (session UI)

**packages/console/:**

- Purpose: Cloud-based workspace management and billing portal
- Contains: SolidStart app, database models, auth flows, Stripe integration
- Key files: `app/src/routes/` (route handlers), `core/` (database schema)

**packages/sdk/js/:**

- Purpose: TypeScript SDK for opencode API
- Contains: Generated OpenAPI client, type definitions
- Key files: `src/client.ts` (client implementation), `src/v2/client.ts` (v2 client)

**packages/ui/:**

- Purpose: Shared UI component library
- Contains: SolidJS components, themes, icons
- Key files: Component exports, theme definitions

**packages/util/:**

- Purpose: Shared utility functions
- Contains: Error handling, encoding, retry logic, identifiers
- Key files: `src/error.ts`, `src/retry.ts`, `src/identifier.ts`

**packages/opencode-broker/:**

- Purpose: Rust-based authentication broker for system-level operations
- Contains: Rust source, IPC protocol, user session management
- Key files: `src/ipc/server.rs` (IPC server), `src/ipc/handler.rs` (request handlers)

**infra/:**

- Purpose: SST infrastructure-as-code definitions
- Contains: Cloudflare Workers config, database setup, resource definitions
- Key files: `app.ts` (main app), `console.ts` (console infrastructure)

**packages/opencode/src/:**

- Purpose: Core opencode source code
- Contains: CLI, server, session, tools, providers, plugins, storage
- Key directories:
  - `cli/` - Command handlers and CLI logic
  - `server/` - HTTP server and routes
  - `session/` - Session management and LLM interaction
  - `tool/` - Tool implementations
  - `provider/` - LLM provider integrations
  - `project/` - Project context and instance management
  - `storage/` - Filesystem persistence
  - `bus/` - Event system
  - `config/` - Configuration management
  - `auth/` - Authentication logic
  - `acp/` - Agent Client Protocol implementation
  - `mcp/` - Model Context Protocol support

**packages/app/src/:**

- Purpose: Frontend application source
- Contains: Components, pages, context providers, hooks
- Key directories:
  - `components/` - Reusable UI components
  - `pages/` - Route pages
  - `context/` - SolidJS context providers
  - `hooks/` - Custom hooks

**packages/console/app/src/:**

- Purpose: Console web application source
- Contains: Routes, components, API handlers
- Key directories:
  - `routes/` - File-based routing (SolidStart)
  - `component/` - UI components
  - `lib/` - Utility libraries

## Key File Locations

**Entry Points:**

- `packages/opencode/src/index.ts`: CLI entry point
- `packages/opencode/src/server/server.ts`: HTTP server setup
- `packages/app/src/entry.tsx`: Web app entry
- `packages/console/app/src/entry-server.tsx`: Console SSR entry
- `packages/console/app/src/entry-client.tsx`: Console client entry

**Configuration:**

- `package.json`: Root workspace config with catalog dependencies
- `tsconfig.json`: TypeScript configuration
- `packages/opencode/src/config/config.ts`: Application config system
- `infra/app.ts`: Infrastructure config for main app
- `infra/console.ts`: Infrastructure config for console

**Core Logic:**

- `packages/opencode/src/session/index.ts`: Session management
- `packages/opencode/src/session/processor.ts`: LLM stream processing
- `packages/opencode/src/session/prompt.ts`: Prompt building logic
- `packages/opencode/src/tool/registry.ts`: Tool registry and execution
- `packages/opencode/src/provider/provider.ts`: Provider abstraction
- `packages/opencode/src/project/instance.ts`: Instance management

**Testing:**

- `packages/opencode/test/`: Integration and unit tests
- Test files co-located with source using `.test.ts` suffix

**Infrastructure:**

- `infra/app.ts`: Main application infrastructure (API, web app)
- `infra/console.ts`: Console infrastructure (database, auth, workers)
- `infra/enterprise.ts`: Enterprise features infrastructure

## Naming Conventions

**Files:**

- TypeScript files: `kebab-case.ts` or `camelCase.ts`
- Test files: `*.test.ts` suffix
- Component files: `kebab-case.tsx`
- Route files: `[param].tsx` (SolidStart file-based routing)

**Directories:**

- Source directories: `kebab-case` (e.g., `session/`, `server/`)
- Package directories: `kebab-case` or `@scope/name` format

**Functions:**

- camelCase for regular functions
- PascalCase for constructors/classes
- UPPER_CASE for constants

**Types:**

- PascalCase for types and interfaces
- Namespace pattern for modules (e.g., `Session.Info`, `Provider.Model`)

## Where to Add New Code

**New CLI Command:**

- Primary code: `packages/opencode/src/cli/cmd/[command-name].ts`
- Register in: `packages/opencode/src/index.ts` (add to yargs commands)

**New Server Route:**

- Primary code: `packages/opencode/src/server/routes/[route-name].ts`
- Register in: `packages/opencode/src/server/server.ts` (add `.route()` call)

**New Tool:**

- Primary code: `packages/opencode/src/tool/[tool-name].ts`
- Register in: `packages/opencode/src/tool/registry.ts` (add to registry)

**New Provider:**

- Primary code: `packages/opencode/src/provider/[provider-name].ts`
- Register in: `packages/opencode/src/provider/provider.ts` (add to provider list)

**New Frontend Component:**

- Primary code: `packages/app/src/components/[component-name].tsx`
- Or: `packages/ui/src/[component-name].tsx` if shared

**New Console Route:**

- Primary code: `packages/console/app/src/routes/[route-path].tsx`
- Follows SolidStart file-based routing conventions

**New SDK Endpoint:**

- Update OpenAPI spec: `packages/sdk/openapi.json`
- Regenerate: Run `packages/sdk/js/script/build.ts`

**Utilities:**

- Shared helpers: `packages/util/src/[utility-name].ts`
- Package-specific: `packages/[package]/src/util/` or `packages/[package]/src/[module]/util.ts`

## Special Directories

**.planning/:**

- Purpose: Planning documents, phase summaries, codebase analysis
- Generated: No, manually maintained
- Committed: Yes

**infra/:**

- Purpose: SST infrastructure definitions
- Generated: No, manually written
- Committed: Yes

**packages/sdk/js/src/gen/:**

- Purpose: Generated OpenAPI client code
- Generated: Yes, via `packages/sdk/js/script/build.ts`
- Committed: Yes (generated code is committed)

**packages/\*/dist/:**

- Purpose: Build outputs
- Generated: Yes, via build scripts
- Committed: No (in .gitignore)

**node_modules/:**

- Purpose: Dependencies
- Generated: Yes, via `bun install`
- Committed: No

---

_Structure analysis: 2026-01-27_
