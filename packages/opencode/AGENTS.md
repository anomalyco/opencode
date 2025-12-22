# opencode agent guidelines

## Build/Test Commands

- **Install**: `bun install`
- **Run**: `bun run index.ts`
- **Typecheck**: `bun run typecheck` (npm run typecheck)
- **Test**: `bun test` (runs all tests)
- **Single test**: `bun test test/tool/tool.test.ts` (specific test file)

## Code Style

- **Runtime**: Bun with TypeScript ESM modules
- **Imports**: Use relative imports for local modules, named imports preferred
- **Types**: Zod schemas for validation, TypeScript interfaces for structure
- **Naming**: camelCase for variables/functions, PascalCase for classes/namespaces
- **Error handling**: Use Result patterns, avoid throwing exceptions in tools
- **File structure**: Namespace-based organization (e.g., `Tool.define()`, `Session.create()`)

## Architecture

- **Tools**: Implement `Tool.Info` interface with `execute()` method
- **Context**: Pass `sessionID` in tool context, use `App.provide()` for DI
- **Validation**: All inputs validated with Zod schemas
- **Logging**: Use `Log.create({ service: "name" })` pattern
- **Storage**: Use `Storage` namespace for persistence
- **API Client**: Go TUI communicates with TypeScript server via stainless SDK. When adding/modifying server endpoints in `packages/opencode/src/server/server.ts`, ask the user to generate a new client SDK to proceed with client-side changes.

## Planning with Sequential-Thinking

- Use `opencode plan` for structured development planning
- Supports complexity levels: simple, standard, complex, initiative
- Development contexts: feature, bugfix, refactor, infrastructure, research, maintenance
- Automatically creates conductor tracks when using `--create-track`
- Plans are saved to `conductor/plans/` directory per project
- Use sequential-thinking tool for AI-assisted task breakdown
