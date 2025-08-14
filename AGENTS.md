# AGENTS.md

## Build, Lint, Typecheck, and Test

- Install dependencies: `bun install`
- Typecheck all packages: `bun typecheck`
- Dev mode (main package): `bun run --conditions=development packages/opencode/src/index.ts`
- Lint (VSCode SDK): `cd sdks/vscode && bun run lint`
- Test (VSCode SDK): `cd sdks/vscode && bun run test`
- Web dev: `cd packages/web && bun run dev`
- To run a single test, use the test runner's filtering (e.g., `bun test path/to/file.test.ts` if available)

## Code Style Guidelines

- Prefer a single function unless composable/reusable
- Avoid unnecessary destructuring
- Avoid `else` unless necessary
- Avoid `try`/`catch` unless required
- Avoid `any` and `let`; prefer `const` and explicit types
- Use single-word variable names where possible
- Use Bun APIs (e.g., `Bun.file()`) when possible
- Prettier: no semicolons, print width 120
- Use TypeScript strictness; extend `@tsconfig/bun`
- Imports: use absolute or relative as appropriate, group by external/internal
- Naming: camelCase for variables/functions, PascalCase for types/classes
- Error handling: fail fast, avoid silent errors

> These rules are enforced for all agentic code changes in this repository.
