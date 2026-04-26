# Architecture

## Pattern Overview

**Overall:** Effect-based functional architecture with a Monorepo design

**Key Characteristics:**
- Pervasive use of `Effect.ts` for side-effect management, dependency injection (Layers/Context), and error handling.
- Monorepo using Bun and Turbo for orchestrating multiple packages.
- Strict schema validation using `zod` and `Effect/Schema` (e.g., in `packages/opencode/src/agent/agent.ts`).

## Layers

**CLI & Application Layer:**
- Purpose: Provides the command-line interface and orchestrates commands.
- Location: `packages/opencode/src/cli/cmd/`
- Contains: Yargs command configurations and command dispatch logic.
- Depends on: Core services, Data logic, and UI rendering (TUI).
- Used by: User terminal execution.

**Agent & Session Logic:**
- Purpose: Manages interactions, prompts, and tool execution for LLM agents.
- Location: `packages/opencode/src/agent/`, `packages/opencode/src/session/`
- Contains: Agent schema definitions, processing pipelines, LLM interaction wrappers.
- Depends on: LLM providers, Database storage, Tool registry.

**Core Utilities (Domain-Agnostic):**
- Purpose: Shared functional patterns and foundational implementations.
- Location: `packages/core/src/`
- Contains: Loggers, filesystem wrappers, Effect.ts runtime extensions, array utilities.
- Used by: All other packages in the monorepo.

**Storage Layer:**
- Purpose: Persists session data, configuration, and migrations.
- Location: `packages/opencode/src/storage/`
- Contains: Drizzle ORM definitions with Bun-SQLite.

## Data Flow

**CLI Invocation Pipeline:**
1. User runs `opencode <command>` — `packages/opencode/src/index.ts`
2. Arguments parsed via Yargs middleware — `packages/opencode/src/index.ts`
3. Environment initialization and SQLite migration check — `packages/opencode/src/index.ts`
4. Command handler executed (e.g., `RunCommand`) — `packages/opencode/src/cli/cmd/run.ts`

## Key Abstractions

**Agent:**
- Purpose: Represents a specialized or general-purpose language model agent.
- Location: `packages/opencode/src/agent/agent.ts`
- Pattern: Schema validation mapped with Effect traits.

**Effect / Contextual Injection:**
- Purpose: Manages service lifecycles (like databases, LLM clients, and file system readers).
- Location: Found globally (e.g., `packages/opencode/src/session/prompt.ts`)
- Pattern: `Effect.ts` Dependency Injection (Layers).

## Entry Points

**Main CLI Executable:**
- Location: `packages/opencode/src/index.ts`
- Triggers: User execution via shell/terminal (`bun run ...`).
- Responsibilities: Bootstrap the environment, validate errors, setup telemetry/logs, and dispatch to specific commands.

## Error Handling

**Strategy:** `Effect.ts` structured failure types and bounded errors.
- Extensive use of `Effect`'s native error handling (`Cause`, `Exit`) to track failure origins.
- Fallback global error catchers (`process.on("uncaughtException")`) emitting standardized `Log.Default.error`.
- Differentiated handling for user-facing formatting (`FormatError`) versus internal stack trace debugging.

## Cross-Cutting Concerns

**Logging:** Configured globally using `@opencode-ai/core/effect/logger.ts`, emitting to the console or log files.
**Schema Validation:** Pervasive use of Zod wrapped in custom logic (`withStatics`, `@effect/schema`) for strict runtime guarantees on inputs like Agents and Tools.
**Database:** SQLite via Drizzle ORM configured centrally, initializing silently at process start via JSON migrations.
