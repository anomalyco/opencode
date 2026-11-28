import path from "node:path"
import { Document, Event, Info } from "@opencode/schema/config"
import { ConfigMCP } from "@opencode/schema/config/mcp"
import type { ConfigPolicy } from "@opencode/schema/config/policy"
import { Bus } from "@opencode/core/bus"
import { Command } from "@opencode/core/command"
import { Config } from "@opencode/core/config"
import { ConfigMcpPlugin } from "@opencode/core/config/plugin/mcp"
import { Credential } from "@opencode/core/credential"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Environment } from "@opencode/core/environment/index"
import { Flag } from "@opencode/core/flag"
import { Form } from "@opencode/core/form"
import { Integration } from "@opencode/core/integration"
import { Location } from "@opencode/core/location"
import { Mcp } from "@opencode/core/mcp/index"
import { McpPool } from "@opencode/core/mcp/pool"
import { CommandPlugin } from "@opencode/core/plugin/command"
import { McpSkillPlugin } from "@opencode/core/plugin/mcp-skill"
import { AbsolutePath } from "@opencode/core/schema"
import { Skill } from "@opencode/core/skill"
import { State } from "@opencode/core/state"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Context, Effect, Exit, Layer, Scope, Stream } from "effect"
import { Image } from "@opencode/core/image"
import { Permission } from "@opencode/core/permission"
import { Tool } from "@opencode/core/tool"
import { McpTool } from "@opencode/core/tool/mcp"
import { Global } from "@opencode/util/global"
import { hostEnvironmentLayer } from "../fixture/environment"
import { tmpdirScoped } from "../fixture/tmpdir"
import { imagePassthrough } from "../lib/image"
import { permissionLayer } from "../lib/permission"
import { location } from "../fixture/location"
import { registerIntegrationPolicy } from "../fixture/policy"
import { TestDatabase } from "../lib/database"
import { eventually } from "../lib/eventually"
import { host } from "../plugin/host"
import type { Spec } from "./fixture/server"

/** Waits up to 10 seconds of real time for `predicate`, failing with `label` and the last value. */
export const until = <A, E, R>(label: string, effect: Effect.Effect<A, E, R>, predicate: (value: A) => boolean) =>
  eventually(effect, predicate).pipe(
    Effect.catchIf(
      (error): error is Error => error instanceof Error && error.message === "Timed out waiting for value",
      () =>
        effect.pipe(
          Effect.flatMap((last) => Effect.die(new Error(`Timed out waiting for ${label}: ${JSON.stringify(last)}`))),
        ),
    ),
  )

/** Two directories that exist, for Locations that must differ. */
export const DIRECTORIES = [import.meta.dir, path.join(import.meta.dir, "fixture")].map((item) =>
  AbsolutePath.make(item),
)

export const remote = (url: string, fields: Partial<ConfigMCP.Remote> = {}) =>
  new ConfigMCP.Remote({ type: "remote", url, oauth: false, ...fields })

/** The fixture as a local server. `pids` names a file each process appends its pid to. */
export const stdio = (
  spec: Spec & { readonly era: "modern" | "legacy" },
  fields: Partial<ConfigMCP.Local> & { readonly pids?: string } = {},
) =>
  new ConfigMCP.Local({
    type: "local",
    command: [process.execPath, path.join(import.meta.dir, "fixture/stdio.ts")],
    ...fields,
    environment: {
      MCP_FIXTURE: JSON.stringify(spec),
      ...(fields.pids ? { MCP_PID_FILE: fields.pids } : {}),
      ...fields.environment,
    },
  })

const unused = () => Effect.die("unused integration service")
const integration = Layer.mock(Integration.Service, {
  revision: () => 0,
  transform: () => Effect.succeed({ dispose: Effect.void }),
  connection: {
    active: unused,
    resolve: unused,
    key: unused,
    external: unused,
    activate: unused,
    update: unused,
    remove: unused,
    status: unused,
  },
  oauth: { connect: unused, status: unused, complete: unused, cancel: unused },
  command: { connect: unused, status: unused, cancel: unused },
})

// The plugins that turn config into servers and MCP catalogs into skills and commands, as a Location loads them.
// Without config, nothing transforms the service until the test does, so its first transform is its startup.
const plugins = (config: boolean) =>
  makeLocationNode({
    name: "test/mcp-plugins",
    layer: Layer.effectDiscard(
      Effect.gen(function* () {
        const bus = yield* Bus.Service
        const mcp = yield* Mcp.Service
        const command = yield* Command.Service
        if (config) {
          yield* ConfigMcpPlugin.register(bus.subscribe())
          yield* registerIntegrationPolicy({ mcp, events: bus.subscribe() })
        }
        yield* McpSkillPlugin.Plugin.effect(host())
        yield* CommandPlugin.Plugin.effect(
          host({
            command: {
              list: () => Effect.die("unused command.list"),
              transform: command.transform,
              reload: command.reload,
            },
          }),
        )
      }),
    ),
    deps: [Bus.node, Config.node, Mcp.node, Skill.node, Command.node, Location.node],
  })

export interface Configuration {
  readonly servers?: Record<string, typeof ConfigMCP.Server.Type>
  /** Timeout defaults for every configured server. */
  readonly timeout?: ConfigMCP.Timeout
  readonly policies?: ReadonlyArray<ConfigPolicy.Info>
  /** Any other setting, which no MCP server depends on. */
  readonly username?: string
}

export interface Open extends Configuration {
  /** Loads no config at all, leaving the service's startup to the test's first transform. */
  readonly unconfigured?: boolean
  /** What the Location's tool registry asks before running a tool; allows everything by default. */
  readonly permission?: Layer.Layer<Permission.Service>
  readonly directory?: string
  readonly flags?: string
  /** Where local servers run; the host by default. */
  readonly environment?: Layer.Layer<Environment.Service>
}

/**
 * Locations on one host: each a real Mcp service with its config, skills and command plugins, sharing one Bus,
 * credential store and MCP pool, as Locations in one process do.
 */
export const world = Effect.gen(function* () {
  const shared = yield* Layer.build(
    AppNodeBuilder.build(LayerNode.group([Bus.node, Credential.node, McpPool.node]), [TestDatabase.replacement]),
  )
  const bus = Context.get(shared, Bus.Service)
  const credentials = Context.get(shared, Credential.Service)
  const pool = Context.get(shared, McpPool.Service)

  const open = Effect.fnUntraced(function* (input: Open = {}) {
    const directory = AbsolutePath.make(input.directory ?? DIRECTORIES[0])
    const scope = yield* Scope.make()
    yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void))
    const document = (configuration: Configuration) =>
      new Document({
        type: "document",
        info: new Info({
          username: configuration.username,
          policies: [...(configuration.policies ?? [])],
          mcp: new ConfigMCP.Info({ timeout: configuration.timeout, servers: configuration.servers ?? {} }),
        }),
      })
    const config = yield* Layer.build(Config.testLayer([document(input)]))
    const context = yield* Layer.buildWithScope(
      AppNodeBuilder.build(
        LayerNode.group([
          Mcp.node,
          Form.node,
          Skill.node,
          Command.node,
          Location.node,
          Tool.node,
          McpTool.node,
          plugins(!input.unconfigured),
        ]),
        [
          Permission.node.replace(input.permission ?? permissionLayer()),
          Image.node.replace(imagePassthrough),
          Global.node.replace(Global.layerWith({ data: (yield* tmpdirScoped()).path })),
          Bus.node.replace(Layer.succeed(Bus.Service, bus)),
          Credential.node.replace(Layer.succeed(Credential.Service, credentials)),
          McpPool.node.replace(Layer.succeed(McpPool.Service, pool)),
          Config.node.replace(Layer.succeed(Config.Service, Context.get(config, Config.Service))),
          Flag.node.replace(Flag.testLayer([], { overrides: input.flags ?? "mcp_skills" })),
          Location.node.replace(Layer.succeed(Location.Service, Location.Service.of(location({ directory })))),
          Environment.node.replace(input.environment ?? hostEnvironmentLayer),
          Integration.node.replace(integration),
        ],
      ),
      scope,
    )
    const run = <A, E>(effect: Effect.Effect<A, E, Location.Service>) =>
      effect.pipe(Effect.provideService(Location.Service, Context.get(context, Location.Service)))
    // Every event this Location sees, in order.
    const events: Array<{ readonly type: string; readonly data: unknown }> = []
    yield* bus.subscribe().pipe(
      Stream.provideService(Location.Service, Context.get(context, Location.Service)),
      Stream.runForEach((event) => Effect.sync(() => events.push({ type: event.type, data: event.data }))),
      Effect.forkIn(scope, { startImmediately: true }),
    )
    const mcp = Context.get(context, Mcp.Service)
    const status = (name: string) =>
      mcp.servers().pipe(Effect.map((servers) => servers.find((server) => server.name === name)?.status))
    return {
      directory,
      mcp,
      forms: Context.get(context, Form.Service),
      skills: Context.get(context, Skill.Service),
      commands: Context.get(context, Command.Service),
      tools: Context.get(context, Tool.Service),
      mcpTool: Context.get(context, McpTool.Service),
      events,
      run,
      status,
      /** Waits until the server is no longer pending, and returns its status. */
      settled: (name: string) =>
        until(`${name} to settle`, status(name), (value) => value !== undefined && value.status !== "pending").pipe(
          Effect.flatMap((value) =>
            value ? Effect.succeed(value) : Effect.die(new Error(`${name} is not configured`)),
          ),
        ),
      /** Replaces the config and announces it, as editing a config file does. */
      configure: (configuration: Configuration) =>
        Context.get(config, Config.Test)
          .setEntries([document(configuration)])
          .pipe(Effect.andThen(run(bus.publish(Event.Updated, {}))), Effect.asVoid),
      /** Closes the Location as eviction does. */
      close: State.shutdown(Scope.close(scope, Exit.void)),
    }
  })

  return { bus, credentials, pool, open }
})

export type World = Effect.Success<typeof world>
export type Place = Effect.Success<ReturnType<World["open"]>>
