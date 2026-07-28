import { Agent } from "@opencode-ai/core/agent"
import type { Permission } from "@opencode-ai/core/permission"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { toSessionError } from "@opencode-ai/core/session/to-session-error"
import type { SessionError } from "@opencode-ai/schema/session-error"
import { Tool } from "@opencode-ai/core/tool"
import type { Context as PluginContext } from "@opencode-ai/plugin/effect/plugin"
import { Effect, type Scope } from "effect"
import { host } from "../plugin/host"

export const toolIdentity = {
  agent: Agent.ID.make("build"),
  messageID: SessionMessage.ID.make("msg_tool_test"),
}

export const toolDefinitions = (registry: Tool.Interface, permissions?: Permission.Ruleset) =>
  registry.snapshot(permissions).pipe(Effect.map((toolSet) => toolSet.definitions))

export function waitForTool(
  registry: Tool.Interface,
  name: string,
  remaining = 1000,
): Effect.Effect<void, Error> {
  return Effect.gen(function* () {
    if ((yield* toolDefinitions(registry)).some((tool) => tool.name === name)) return
    if (remaining === 0) {
      yield* Effect.fail(new Error(`Timed out waiting for tool: ${name}`))
      return
    }
    yield* Effect.promise(() => Bun.sleep(1))
    yield* waitForTool(registry, name, remaining - 1)
  })
}

export function waitForCodeModeTool(
  registry: Tool.Interface,
  path: string,
  remaining = 1000,
): Effect.Effect<Tool.Snapshot, Error> {
  return Effect.gen(function* () {
    const toolSet = yield* registry.snapshot()
    if (toolSet.codeModeCatalog?.some((tool) => tool.path === path)) return toolSet
    if (remaining === 0) {
      return yield* Effect.fail(new Error(`Timed out waiting for Code Mode tool: ${path}`))
    }
    yield* Effect.promise(() => Bun.sleep(1))
    return yield* waitForCodeModeTool(registry, path, remaining - 1)
  })
}

/**
 * Registers a core tool plugin's tools against the real registry without booting the
 * full plugin host. Only the tool domain is live; focused tool tests exercise
 * registration, snapshots, and execution through the same path production uses.
 */
export const registerToolPlugin = <R>(
  plugin: {
    readonly id: string
    readonly effect: (context: PluginContext) => Effect.Effect<void, never, R>
  },
  overrides: Parameters<typeof host>[0] = {},
): Effect.Effect<void, never, R | Tool.Service | Scope.Scope> =>
  Effect.gen(function* () {
    const tools = yield* Tool.Service
    const context = host({
      ...overrides,
      session: {
        hook: () => Effect.succeed({ dispose: Effect.void }),
      },
      tool: {
        transform: (callback) =>
          tools
            .transform((draft) => callback({ add: (tool) => draft.add(tool) }))
            .pipe(Effect.orDie, Effect.as({ dispose: Effect.void })),
        hook: () => Effect.die("registerToolPlugin does not support tool hooks"),
      },
    })
    yield* plugin.effect(context)
  })

export interface ToolExecution {
  readonly status: "completed" | "error"
  readonly output?: any
  readonly content?: ReadonlyArray<Tool.Content>
  readonly metadata?: Tool.Metadata
  readonly error?: SessionError.Error
}

export const executeTool = (
  registry: Tool.Interface,
  input: Parameters<Tool.Snapshot["execute"]>[0],
): Effect.Effect<ToolExecution> =>
  registry.snapshot().pipe(
    Effect.flatMap((tools) => tools.execute(input)),
    Effect.map((result) => ({ status: "completed" as const, ...result }) satisfies ToolExecution),
    Effect.catchTag("Tool.Error", (error) =>
      Effect.succeed({ status: "error" as const, error: toSessionError(error) } satisfies ToolExecution),
    ),
  )
