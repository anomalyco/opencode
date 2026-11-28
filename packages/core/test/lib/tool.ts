import { Agent } from "@opencode/core/agent"
import { CodeModeCatalog } from "@opencode/core/codemode/catalog"
import { CodeModeTool } from "@opencode/core/codemode/tool"
import { Config } from "@opencode/core/config"
import { Flag } from "@opencode/core/flag"
import { CodeModePlugin } from "@opencode/core/tool/plugin/codemode"
import { execute } from "@opencode/core/tool/runtime"
import { Image } from "@opencode/core/image"
import { Permission } from "@opencode/core/permission"
import { PermissionPolicy } from "@opencode/core/permission/policy"
import { SessionMessage } from "@opencode/core/session/message"
import { toSessionError } from "@opencode/core/session/to-session-error"
import type { SessionError } from "@opencode/schema/session-error"
import { Tool } from "@opencode/core/tool"
import type { Context } from "@opencode/plugin/effect/plugin"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { type Context as EffectContext, Effect, Layer, type Scope } from "effect"
import { host } from "../plugin/host"
import { imagePassthrough } from "./image"
import { permissionLayer } from "./permission"

/** `tool.call` for a context a test builds outside the registry, where nothing should call another tool. */
export const noToolCalls: Tool.Calls = {
  call: (name) => Effect.die(new Error(`unexpected tool.call("${name}")`)),
  list: () => ({ direct: new Map(), codemode: new Map(), namespaces: new Map() }),
}

export const toolIdentity = {
  agent: Agent.ID.make("build"),
  messageID: SessionMessage.ID.make("msg_tool_test"),
}

/** Replacements for tests that build `Tool.node` without a Location. */
export const toolNodeReplacements = (
  permission: Layer.Layer<Permission.Service> = permissionLayer(),
): LayerNode.Replacements => [
  Config.node.replace(Config.testLayer()),
  Image.node.replace(imagePassthrough),
  Permission.node.replace(permission),
]

export const toolDefinitions = (registry: Tool.Interface, permissions?: Permission.Ruleset) =>
  registry
    .snapshot(permissions ? PermissionPolicy.fromRules(permissions) : undefined)
    .pipe(Effect.map((toolSet) => toolSet.definitions))

export const codeModeListings = (catalog: CodeModeCatalog.Inventory) =>
  CodeModeCatalog.summarize(catalog, { budget: Infinity }).namespaces.flatMap((namespace) => namespace.entries)

export function waitForTool(registry: Tool.Interface, name: string, remaining = 1000): Effect.Effect<void, Error> {
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

/**
 * Registers a core tool plugin's tools against the real registry without booting the
 * full plugin host. Only the tool domain is live; focused tool tests exercise
 * registration, snapshots, and execution through the same path production uses.
 */
export const registerToolPlugin = <R>(
  plugin: {
    readonly id: string
    readonly effect: (context: Context) => Effect.Effect<void, never, R>
  },
  overrides: Parameters<typeof host>[0] = {},
  hook?: Context["tool"]["hook"],
): Effect.Effect<void, never, R | Tool.Service | Scope.Scope> =>
  Effect.gen(function* () {
    const tools = yield* Tool.Service
    const context = host({
      ...overrides,
      session: {
        ...overrides.session,
        hook: overrides.session?.hook ?? (() => Effect.succeed({ dispose: Effect.void })),
      },
      tool: {
        transform: tools.transform,
        reload: tools.reload,
        list: tools.list,
        hook: hook ?? (() => Effect.die("registerToolPlugin does not support tool hooks")),
      },
    })
    yield* plugin.effect(context)
  })

/** Registers Code Mode's `execute` tool as its internal plugin does; `services` gives it the `path` and `Bun` globals. */
export const registerCodeMode = (services?: EffectContext.Context<CodeModeTool.Services>) =>
  registerToolPlugin(CodeModePlugin.Plugin).pipe((effect) => (services ? Effect.provide(effect, services) : effect))

/** `Tool.node` with Code Mode's `execute` registered, for tests that build the registry themselves. */
export const toolNodes = LayerNode.group([
  Tool.node,
  makeLocationNode({
    name: "test/codemode",
    layer: Layer.effectDiscard(registerCodeMode()),
    deps: [Tool.node, Flag.node, Permission.node],
  }),
])

/** `tool.call` over `tools` for a Code Mode tool run outside the registry: each call runs the tool directly. */
export const directCalls = (
  tools: ReadonlyMap<string, Tool.Info>,
  context: Omit<Tool.Context, "tool">,
): Tool.Calls => ({
  list: () => ({ direct: new Map(), codemode: tools, namespaces: new Map() }),
  call: (name, input, options) => {
    const tool = tools.get(name)
    if (!tool) return Effect.fail(new Tool.Error({ message: `No tool named "${name}" is available to this call.` }))
    return execute(tool, input, { ...context, codemode: options?.codemode, tool: directCalls(tools, context) })
  },
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
  options?: Tool.SnapshotOptions,
): Effect.Effect<ToolExecution> =>
  registry.snapshot(undefined, options).pipe(
    Effect.flatMap((tools) => tools.execute(input)),
    Effect.map((result) => ({ status: "completed" as const, ...result }) satisfies ToolExecution),
    Effect.catchTag("Tool.Error", (error) =>
      Effect.succeed({ status: "error" as const, error: toSessionError(error) } satisfies ToolExecution),
    ),
  )
