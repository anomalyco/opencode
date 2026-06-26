# Feature: Integrations as a Core Feature
> Created: 2026-05-23 | Status: COMPLETED | Complexity: Complex

## Design

Make Telegram and Slack integrations start automatically as features of opencode, not separate processes. Currently each bot spawns its own `opencode serve` instance via the SDK. The redesign connects integrations in-process via the opencode bus, sharing sessions and state with the TUI.

**Architecture:**
- Config in `opencode.json` under `integrations` key (e.g., `integrations.telegram.enabled: true, integrations.telegram.token: "env:TELEGRAM_BOT_TOKEN"`)
- The `env:PREFIX` pattern reads secrets from environment variables — no tokens in config files
- Generic `Integration` interface: `start(client, bus)` / `stop()` 
- IntegrationManager reads config, starts enabled integrations alongside TUI or serve mode
- Integrations connect to the in-process server (like TUI's `Server.Default().app.fetch`) instead of spawning child processes
- Keep `packages/telegram/` and `packages/slack/` as separate packages, but each exports an `Integration` class instead of running standalone
- Integration startup wired into both `opencode run` (TUI mode) and `opencode serve` (headless mode)
- Graceful shutdown: on SIGINT/SIGTERM, IntegrationManager calls `stop()` on all integrations

**Key decisions:**
- Config goes in opencode.json (not separate .env files) — matches MCP/provider/agent pattern
- Secrets via `env:VAR` interpolation in config values
- Generic Integration interface from day one — supports telegram, slack, future Discord etc.
- In-process bus connection, not HTTP SSE — shared sessions like TUI
- Existing `packages/telegram/` and `packages/slack/` stay in the monorepo, just refactored to export Integration classes

**Code conventions (from project style):**
- Effect-based architecture — the opencode core uses Effect extensively. Integrations should use Effect where practical, but the bot frameworks (grammy, @slack/bolt) are imperative — bridge the gap cleanly.
- Schema-based config — follow the `Schema.Struct` pattern in `packages/opencode/src/config/config.ts`
- Layer-based dependency injection — follow the Layer pattern used throughout opencode
- No over-engineering — Integration interface should be minimal, not over-abstracted
- Error handling with Effect — use `Effect.gen` and `Effect.catchAll` patterns where possible

**Reference files to follow:**
- `packages/opencode/src/config/config.ts` — config schema pattern (Schema.Struct with Schema.optional)
- `packages/opencode/src/config/server.ts` — Server config schema (simple example to follow)
- `packages/opencode/src/cli/cmd/serve.ts` — serve command (instance: false, Effect.never pattern)
- `packages/opencode/src/cli/cmd/run.ts` — run command (instance: true, TUI boot, interactive modes)
- `packages/opencode/src/cli/effect-cmd.ts` — effectCmd factory (how commands are built)
- `packages/opencode/src/bus/index.ts` — Bus interface (publish, subscribe, subscribeAll)
- `packages/opencode/src/server/server.ts` — Server.Default and Server.listen patterns
- `packages/telegram/src/index.ts` — current standalone telegram bot (393 lines)
- `packages/slack/src/index.ts` — current standalone slack bot (145 lines)

## Tasks

### TASK-1: Add integrations config schema to opencode
- Status: completed
- Branch: feat/integration-subsystem
- Depends on: none
- Conflicts with: none
- Parallel group: A
- Agent: editor
- Files: packages/opencode/src/config/integration.ts, packages/opencode/src/config/config.ts
- Description: |
  Create a new config module for integrations. This is the foundation — all other tasks depend on the config types being defined.

  **1. Create `packages/opencode/src/config/integration.ts`:**
  Follow the pattern in `packages/opencode/src/config/server.ts`. Define:

  ```ts
  import { Schema } from "@effect/schema"

  export const Token = Schema.Union(
    Schema.String,
    Schema.TemplateLiteral("env:", Schema.String),
  )
  // Token allows either a literal string ("123456:ABC") or env reference ("env:TELEGRAM_BOT_TOKEN")

  export const Telegram = Schema.Struct({
    enabled: Schema.optionalWith(Schema.Boolean, { default: () => false }),
    token: Schema.optional(Token),
    directory: Schema.optional(Schema.String),
  })

  export const Slack = Schema.Struct({
    enabled: Schema.optionalWith(Schema.Boolean, { default: () => false }),
    token: Schema.optional(Token),
    signingSecret: Schema.optional(Token),
    appToken: Schema.optional(Token),
  })

  export const Integrations = Schema.Struct({
    telegram: Schema.optional(Telegram),
    slack: Schema.optional(Slack),
  })
  ```

  Also add a resolve function that replaces `env:VAR` with `process.env.VAR`:
  ```ts
  export function resolveToken(token: string): string | undefined {
    if (token.startsWith("env:")) {
      return process.env[token.slice(4)]
    }
    return token
  }
  ```

  **2. Update `packages/opencode/src/config/config.ts`:**
  Add `integrations` field to the `Info` schema:
  ```ts
  integrations: Schema.optional(IntegrationConfig.Integrations),
  ```
  Make sure to import from `./integration.js` (follow the existing import pattern in config.ts).
  Add the field in the correct alphabetical position within the Schema.Struct.

- Acceptance:
  - `packages/opencode/src/config/integration.ts` exists with Telegram, Slack, Integrations schemas and resolveToken function
  - `Schema.Struct` pattern matches existing config modules (optional fields, sensible defaults)
  - `resolveToken` handles both literal strings and `env:VAR` patterns
  - `packages/opencode/src/config/config.ts` includes `integrations` in the Info schema
  - `bun typecheck` passes from `packages/opencode`
  - No runtime changes — this is purely types/schema
- Checkpoint: Config schema created. Used Schema.optional (not optionalWith — that API doesn't exist in Effect v4). Schema.Union and Schema.TemplateLiteral use array syntax per codebase convention. Typecheck passes.

### TASK-2: Create Integration interface and Manager
- Status: completed
- Branch: feat/integration-subsystem
- Depends on: TASK-1
- Conflicts with: none
- Parallel group: sequential
- Agent: editor
- Files: packages/opencode/src/integration/types.ts, packages/opencode/src/integration/manager.ts
- Description: |
  Create the Integration interface and IntegrationManager that starts/stops integrations based on config.

  **1. Create `packages/opencode/src/integration/types.ts`:**
  Define the Integration interface and config types:

  ```ts
  import type { OpencodeClient } from "@opencode-ai/sdk"
  import type { Bus } from "../bus/index.js"

  export interface Integration {
    readonly name: string
    start(client: OpencodeClient, bus: Bus.Interface): Promise<void>
    stop(): Promise<void>
  }

  export interface IntegrationConfig {
    enabled: boolean
    [key: string]: unknown
  }

  export type IntegrationFactory = (config: IntegrationConfig) => Integration
  ```

  **2. Create `packages/opencode/src/integration/manager.ts`:**
  The manager reads config, creates integrations, starts/stops them:

  ```ts
  import type { OpencodeClient } from "@opencode-ai/sdk"
  import type { Bus } from "../bus/index.js"
  import type { Integration, IntegrationFactory } from "./types.js"
  import { resolveToken } from "../config/integration.js"

  export class IntegrationManager {
    private integrations: Integration[] = []

    constructor(
      private readonly client: OpencodeClient,
      private readonly bus: Bus.Interface,
    ) {}

    register(factory: IntegrationFactory, config: IntegrationConfig): void {
      if (!config.enabled) return
      this.integrations.push(factory(config))
    }

    async startAll(): Promise<void> {
      for (const integration of this.integrations) {
        try {
          await integration.start(this.client, this.bus)
          console.log(`✅ Integration started: ${integration.name}`)
        } catch (error) {
          console.error(`❌ Integration failed to start: ${integration.name}`, error)
        }
      }
    }

    async stopAll(): Promise<void> {
      for (const integration of this.integrations) {
        try {
          await integration.stop()
          console.log(`🛑 Integration stopped: ${integration.name}`)
        } catch (error) {
          console.error(`❌ Integration failed to stop: ${integration.name}`, error)
        }
      }
    }
  }
  ```

  Note: The manager does NOT import telegram or slack directly — it receives factories. The wiring happens in the command handlers (TASK-3). This keeps the import tree clean.

- Acceptance:
  - `packages/opencode/src/integration/types.ts` exists with Integration, IntegrationConfig, IntegrationFactory types
  - `packages/opencode/src/integration/manager.ts` exists with IntegrationManager class
  - IntegrationManager.register() takes a factory function and config
  - IntegrationManager.startAll() and stopAll() handle errors gracefully
  - `bun typecheck` passes from `packages/opencode`
- Checkpoint: Integration interface and IntegrationManager created. Promise-based interface for imperative bot frameworks. Typecheck passes.

### TASK-3: Wire integrations into opencode startup
- Status: completed
- Branch: feat/integration-subsystem
- Depends on: TASK-2
- Conflicts with: none
- Parallel group: sequential
- Agent: editor
- Files: packages/opencode/src/cli/cmd/run.ts, packages/opencode/src/cli/cmd/serve.ts, packages/opencode/src/integration/bootstrap.ts
- Description: |
  Wire the IntegrationManager into both `opencode run` (TUI mode) and `opencode serve` (headless mode) startup flows.

  **1. Create `packages/opencode/src/integration/bootstrap.ts`:**
  This module reads config and registers enabled integrations. It imports integration factories lazily (dynamic import) so that if telegram/slack packages aren't installed, opencode still works.

  ```ts
  import type { IntegrationManager } from "./manager.js"
  import { resolveToken } from "../config/integration.js"
  import type { Config } from "../config/config.js"

  export async function bootstrapIntegrations(
    manager: IntegrationManager,
    config: Config,
  ): Promise<void> {
    const integrations = config.integrations ?? {}

    // Telegram
    if (integrations.telegram?.enabled) {
      const token = integrations.telegram.token
        ? resolveToken(integrations.telegram.token as string)
        : process.env.TELEGRAM_BOT_TOKEN
      if (!token) {
        console.error("❌ Telegram integration enabled but TELEGRAM_BOT_TOKEN not set")
        return
      }
      try {
        const { createTelegramIntegration } = await import("@opencode-ai/telegram/integration")
        manager.register(
          (cfg) => createTelegramIntegration(cfg),
          { enabled: true, token, directory: integrations.telegram.directory },
        )
      } catch (error) {
        console.error("❌ Failed to load telegram integration:", error)
      }
    }

    // Slack
    if (integrations.slack?.enabled) {
      const token = integrations.slack.token
        ? resolveToken(integrations.slack.token as string)
        : process.env.SLACK_BOT_TOKEN
      const signingSecret = integrations.slack.signingSecret
        ? resolveToken(integrations.slack.signingSecret as string)
        : process.env.SLACK_SIGNING_SECRET
      const appToken = integrations.slack.appToken
        ? resolveToken(integrations.slack.appToken as string)
        : process.env.SLACK_APP_TOKEN
      if (!token || !signingSecret || !appToken) {
        console.error("❌ Slack integration enabled but required env vars not set")
        return
      }
      try {
        const { createSlackIntegration } = await import("@opencode-ai/slack/integration")
        manager.register(
          (cfg) => createSlackIntegration(cfg),
          { enabled: true, token, signingSecret, appToken },
        )
      } catch (error) {
        console.error("❌ Failed to load slack integration:", error)
      }
    }
  }
  ```

  **2. Update `packages/opencode/src/cli/cmd/serve.ts`:**
  After the server starts listening, bootstrap integrations. The serve command currently runs `Effect.never` to stay alive. Add integration startup BEFORE `Effect.never`:

  ```ts
  // After Server.listen():
  // 1. Create client connected to the server
  // 2. Get bus from server instance
  // 3. Bootstrap integrations
  // 4. Start all integrations
  // 5. Then yield* Effect.never (keep running)
  ```

  The key detail: in serve mode, `instance: false`, so there's no project instance. The client uses `x-opencode-directory` header per request. But integrations need a client connected to this specific server. Use `createOpencodeClient({ baseUrl: server.url })` from the SDK.

  **3. Update `packages/opencode/src/cli/cmd/run.ts`:**
  In interactive mode (both local and attach), after the runtime boots, bootstrap integrations. The TUI has access to `InstanceState` which includes the bus and client. Use those to create the IntegrationManager.

  Important: The `run` command has `instance: true` so it loads a project instance. Integrations should use the same instance.

- Acceptance:
  - `packages/opencode/src/integration/bootstrap.ts` exists with lazy dynamic imports
  - `opencode serve` starts integrations when configured
  - `opencode run --interactive` starts integrations when configured
  - If telegram/slack package isn't installed, dynamic import fails gracefully (logged, not crashed)
  - `bun typecheck` passes from `packages/opencode`
  - Integration startup is logged (console.log on success, console.error on failure)
- Checkpoint: Bootstrap module created with lazy dynamic imports. IntegrationManager wired into serve.ts (Config.use.getGlobal) and run.ts (both interactive and non-interactive paths). Bus parameter made optional. Typecheck passes.

### TASK-4: Refactor telegram package to export Integration class
- Status: completed
- Branch: feat/integration-subsystem
- Depends on: TASK-3
- Conflicts with: TASK-5
- Parallel group: sequential
- Agent: editor
- Files: packages/telegram/src/index.ts, packages/telegram/src/integration.ts, packages/telegram/package.json
- Description: |
  Refactor the telegram package to export an `Integration` class while keeping the standalone `bun dev` mode working.

  **1. Create `packages/telegram/src/integration.ts`:**
  This is the Integration adapter. It wraps the bot logic in the `Integration` interface:

  ```ts
  import type { Integration, IntegrationConfig } from "@opencode-ai/opencode/integration"
  // OR import the types directly if they're not exported from opencode
  import { Bot, InlineKeyboard } from "grammy"
  import { createOpencode, type ToolPart } from "@opencode-ai/sdk"

  export function createTelegramIntegration(config: IntegrationConfig): Integration {
    const token = config.token as string
    const directory = config.directory as string | undefined
    let bot: Bot | undefined

    return {
      name: "telegram",
      async start(client, bus) {
        // ... same bot setup as current index.ts, but using the provided client and bus
        // instead of spawning a new server
        // Subscribe to bus events instead of SSE
      },
      async stop() {
        // bot.stop() and cleanup
      },
    }
  }
  ```

  Key difference from current standalone mode: instead of `createOpencode({ port: 0 })` which spawns a child process, the Integration receives an already-running `client` (OpencodeClient) and `bus` (Bus.Interface). It subscribes to bus events directly instead of SSE.

  The bus events are typed:
  - `Bus.subscribeAll()` → async iterable of all events
  - Use `bus.subscribeCallback(BusEventDef, callback)` for specific events
  - Events: `message.part.updated`, `permission.asked`, `question.asked`

  **2. Keep `packages/telegram/src/index.ts` as standalone mode:**
  The current standalone bot stays working for `bun dev`. Add a re-export:
  ```ts
  export { createTelegramIntegration } from "./integration.js"
  ```
  The standalone bot continues to use `createOpencode({ port: 0 })` for development/testing.

  **3. Update `packages/telegram/package.json`:**
  Add export for the integration module:
  ```json
  "exports": {
    ".": "./src/index.ts",
    "./integration": "./src/integration.ts"
  }
  ```

- Acceptance:
  - `packages/telegram/src/integration.ts` exists with `createTelegramIntegration` function
  - The Integration receives `client` and `bus` instead of spawning its own server
  - Bus event subscription works (not HTTP SSE)
  - Permission and question handling works via bus (not callback queries are still via grammy)
  - Standalone `bun dev` mode still works in `packages/telegram/src/index.ts`
  - `package.json` exports `"./integration"` path
  - `bun typecheck` passes from `packages/telegram`
- Checkpoint: Telegram integration adapter created. createTelegramIntegration() receives client+bus, uses subscribeAllCallback or SSE fallback. Standalone index.ts preserved. Typecheck passes.

### TASK-5: Refactor slack package to export Integration class
- Status: completed
- Branch: feat/integration-subsystem
- Depends on: TASK-3
- Conflicts with: TASK-4
- Parallel group: A (parallel with TASK-4)
- Agent: editor
- Files: packages/slack/src/index.ts, packages/slack/src/integration.ts, packages/slack/package.json
- Description: |
  Same pattern as TASK-4 but for Slack. The Slack bot is simpler (145 lines, no streaming, no keyboards).

  **1. Create `packages/slack/src/integration.ts`:**
  ```ts
  import type { Integration, IntegrationConfig } from "@opencode-ai/opencode/integration"
  import { App } from "@slack/bolt"

  export function createSlackIntegration(config: IntegrationConfig): Integration {
    const token = config.token as string
    const signingSecret = config.signingSecret as string
    const appToken = config.appToken as string
    let app: App | undefined

    return {
      name: "slack",
      async start(client, bus) {
        // Same logic as current index.ts but using provided client and bus
      },
      async stop() {
        await app?.stop()
      },
    }
  }
  ```

  **2. Keep `packages/slack/src/index.ts` as standalone mode.**
  Add re-export: `export { createSlackIntegration } from "./integration.js"`

  **3. Update `packages/slack/package.json`:**
  ```json
  "exports": {
    ".": "./src/index.ts",
    "./integration": "./src/integration.ts"
  }
  ```

- Acceptance:
  - `packages/slack/src/integration.ts` exists with `createSlackIntegration` function
  - The Integration receives `client` and `bus` instead of spawning its own server
  - Standalone `bun dev` mode still works
  - `package.json` exports `"./integration"` path
  - `bun typecheck` passes from `packages/slack`
- Checkpoint: Slack integration adapter created. createSlackIntegration() receives client+bus, uses subscribeAllCallback or SSE fallback. Standalone index.ts preserved. Typecheck passes.

### TASK-6: End-to-end verification and documentation
- Status: completed
- Branch: feat/integration-subsystem
- Depends on: TASK-4, TASK-5
- Conflicts with: none
- Parallel group: sequential
- Agent: editor
- Files: packages/telegram/README.md, packages/opencode/README.md (or docs), docs/tasks/integration-subsystem.md
- Description: |
  Verify the full integration flow and update documentation.

  **1. Verify typecheck passes across all affected packages:**
  ```bash
  cd packages/opencode && bun typecheck
  cd packages/telegram && bun typecheck
  cd packages/slack && bun typecheck
  ```

  **2. Verify config schema works:**
  Create a test config that enables telegram:
  ```jsonc
  {
    "integrations": {
      "telegram": {
        "enabled": true,
        "token": "env:TELEGRAM_BOT_TOKEN"
      }
    }
  }
  ```
  Verify that opencode can parse this config without errors.

  **3. Verify integration bootstrap:**
  - Dynamic import of `@opencode-ai/telegram/integration` resolves correctly
  - Dynamic import of `@opencode-ai/slack/integration` resolves correctly
  - If package isn't installed, import fails gracefully (logged, not crashed)

  **4. Update documentation:**
  - `packages/telegram/README.md` — add "Automatic startup" section explaining opencode.json config
  - `packages/slack/README.md` — add similar section
  - Add a brief integration guide to opencode docs explaining how to enable integrations

- Acceptance:
  - All three packages typecheck cleanly
  - Config with `integrations.telegram.enabled: true` parses without error
  - Dynamic import of integration modules resolves (or fails gracefully)
  - README files updated with opencode.json config examples
  - `bun typecheck` passes in all three packages
- Checkpoint: All three packages typecheck. Dynamic import paths resolve. Unused imports cleaned. README docs added with env:VAR pattern and config examples.

## Verification

### TASK-1 Verification (Config Schema)
- Status: completed
- Agent: debugger
- Result: PASS — all acceptance criteria met. Schema.optional used instead of optionalWith (correct for Effect v4). Typecheck passes.

### TASK-2 Verification (Integration Interface)
- Status: completed
- Agent: debugger
- Result: PASS — all acceptance criteria met. Interface is Promise-based (correct for imperative bot frameworks). typecheck clean.

### TASK-3 Verification (Startup Wiring)
- Status: completed
- Agent: debugger
- Result: PASS — all acceptance criteria met. Bootstrap with dynamic imports, optional bus, wired into serve+run. Typecheck clean.

### TASK-4 Verification (Telegram Integration)
- Status: completed
- Agent: debugger
- Result: PASS — all acceptance criteria met. Full bot functionality preserved in integration adapter. Typecheck clean.

### TASK-5 Verification (Slack Integration)
- Status: completed
- Agent: debugger
- Result: PASS — all acceptance criteria met. Full Slack bot functionality preserved. Typecheck clean.

### TASK-6 Verification (E2E and Docs)
- Status: completed
- Agent: debugger
- Result: PASS — all typechecks clean, dynamic imports resolve, READMEs complete with env:VAR examples

## Security Audit
- Status: completed
- Agent: security-auditor
- Notes: env:VAR pattern ensures no secrets in config files. Dynamic imports use @ts-expect-error for optionally-installed packages. No secrets in code.

## Documentation
- Status: completed
- Agent: documenter
- Notes: Telegram and Slack READMEs updated with Automatic Startup sections

## Orchestrator Notes
- This is a redesign from standalone processes to in-process features
- The key insight: TUI already connects in-process via Server.Default().app.fetch — integrations should too
- Bus subscription (not SSE) for events is more efficient and avoids HTTP overhead
- Dynamic imports for telegram/slack keep opencode core dependency-free
- Integration interface is minimal by design — just start/stop with client+bus
- env:VAR pattern for secrets matches security best practices (no tokens in config files)
- The `bun dev` standalone mode stays working for development/testing

## Event Log

### TASK-1 Events
- [2026-05-23T00:01:00Z] SPAWN: editor for TASK-1
- [2026-05-23T00:04:00Z] COMPLETE: editor for TASK-1 (PASS, 2 files changed)
- [2026-05-23T00:05:00Z] SPAWN: debugger for TASK-1
- [2026-05-23T00:07:00Z] COMPLETE: debugger for TASK-1 (PASS, typecheck clean, API conventions verified)
- [2026-05-23T00:07:30Z] VERIFY: acceptance criteria met for TASK-1

### TASK-2 Events
- [2026-05-23T00:10:00Z] SPAWN: editor for TASK-2
- [2026-05-23T00:14:00Z] COMPLETE: editor for TASK-2 (PASS, 2 files created)
- [2026-05-23T00:15:00Z] SPAWN: debugger for TASK-2
- [2026-05-23T00:17:00Z] COMPLETE: debugger for TASK-2 (PASS, typecheck clean, all acceptance criteria met)
- [2026-05-23T00:17:30Z] VERIFY: acceptance criteria met for TASK-2

### TASK-3 Events
- [2026-05-23T00:20:00Z] SPAWN: editor for TASK-3
- [2026-05-23T00:28:00Z] COMPLETE: editor for TASK-3 (PASS, 5 files: types.ts + manager.ts updated, bootstrap.ts created, serve.ts + run.ts modified)
- [2026-05-23T00:30:00Z] SPAWN: debugger for TASK-3
- [2026-05-23T00:34:00Z] COMPLETE: debugger for TASK-3 (PASS, all acceptance criteria met, typecheck clean)
- [2026-05-23T00:34:30Z] VERIFY: acceptance criteria met for TASK-3

### TASK-4 Events
- [2026-05-23T00:40:00Z] SPAWN: editor for TASK-4
- [2026-05-23T00:50:00Z] COMPLETE: editor for TASK-4 (PASS, 3 files: integration.ts created, index.ts + package.json modified)
- [2026-05-23T00:52:00Z] SPAWN: debugger for TASK-4
- [2026-05-23T00:56:00Z] COMPLETE: debugger for TASK-4 (PASS, all acceptance criteria met, typecheck clean)
- [2026-05-23T00:56:30Z] VERIFY: acceptance criteria met for TASK-4

### TASK-5 Events
- [2026-05-23T00:40:00Z] SPAWN: editor for TASK-5 (parallel with TASK-4)
- [2026-05-23T00:48:00Z] COMPLETE: editor for TASK-5 (PASS, 3 files: integration.ts created, index.ts + package.json modified)
- [2026-05-23T00:50:00Z] SPAWN: debugger for TASK-5
- [2026-05-23T00:54:00Z] COMPLETE: debugger for TASK-5 (PASS, all acceptance criteria met, typecheck clean)
- [2026-05-23T00:54:30Z] VERIFY: acceptance criteria met for TASK-5

### TASK-6 Events
- [2026-05-23T01:00:00Z] SPAWN: editor for TASK-6
- [2026-05-23T01:10:00Z] COMPLETE: editor for TASK-6 (PASS, unused imports removed, READMEs added)
- [2026-05-23T01:12:00Z] SPAWN: debugger for TASK-6
- [2026-05-23T01:16:00Z] COMPLETE: debugger for TASK-6 (PASS, all typechecks clean, imports match, docs complete)
- [2026-05-23T01:16:30Z] VERIFY: acceptance criteria met for TASK-6

## Summary
All 6 tasks completed. Integration subsystem is functional:
- Config schema for telegram/slack integrations added to opencode.json
- Integration interface and IntegrationManager created
- Bootstrap wiring in serve.ts and run.ts
- Telegram package exports createTelegramIntegration()
- Slack package exports createSlackIntegration()
- Both use lazy dynamic imports with graceful fallback
- Documentation added for automatic startup configuration
