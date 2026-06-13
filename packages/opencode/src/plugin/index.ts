import type {
  Hooks,
  PluginInput,
  Plugin as PluginInstance,
  PluginModule,
  WorkspaceAdapter as PluginWorkspaceAdapter,
} from "@opencode-ai/plugin"
import { Config } from "@/config/config"
import { Bus } from "../bus"
import * as Log from "@opencode-ai/core/util/log"
import { createOpencodeClient } from "@opencode-ai/sdk"
import { ServerAuth } from "@/server/auth"
import { CodexAuthPlugin } from "./codex"
import { Session } from "@/session/session"
import { NamedError } from "@opencode-ai/core/util/error"
import { CopilotAuthPlugin } from "./github-copilot/copilot"
import { gitlabAuthPlugin as GitlabAuthPlugin } from "opencode-gitlab-auth"
import { PoeAuthPlugin } from "opencode-poe-auth"
import { CloudflareAIGatewayAuthPlugin, CloudflareWorkersAuthPlugin } from "./cloudflare"
import { AzureAuthPlugin } from "./azure"
import { DigitalOceanAuthPlugin } from "./digitalocean"
import { XaiAuthPlugin } from "./xai"
import { Effect, Layer, Context, Schema, Stream } from "effect"
import { EffectBridge } from "@/effect/bridge"
import { InstanceState } from "@/effect/instance-state"
import { errorMessage } from "@/util/error"
import { PluginLoader } from "./loader"
import { parsePluginSpecifier, readPluginId, readV1Plugin, resolvePluginId } from "./shared"
import { registerAdapter } from "@/control-plane/adapters"
import type { WorkspaceAdapter } from "@/control-plane/types"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Hash } from "@/util/hash"
import { SessionID } from "@/session/schema"

const log = Log.create({ service: "plugin" })

type State = {
  hooks: HookEntry[]
  controls: HookControl[]
}

type HookEntry = {
  id: string
  hooks: Hooks
}

export const HookControlInput = Schema.Struct({
  plugin: Schema.optional(Schema.String),
  hook: Schema.String,
  event: Schema.optional(Schema.String),
  enabled: Schema.Boolean,
}).annotate({ identifier: "PluginHookControlInput" })
export type HookControlInput = Schema.Schema.Type<typeof HookControlInput>

export const HookControl = Schema.Struct({
  sessionID: SessionID,
  plugin: Schema.String,
  hook: Schema.String,
  event: Schema.optional(Schema.String),
  enabled: Schema.Boolean,
}).annotate({ identifier: "PluginHookControl" })
export type HookControl = Schema.Schema.Type<typeof HookControl>

// Hook names that follow the (input, output) => Promise<void> trigger pattern
type TriggerName = {
  [K in keyof Hooks]-?: NonNullable<Hooks[K]> extends (input: any, output: any) => Promise<void> ? K : never
}[keyof Hooks]

export interface Interface {
  readonly trigger: <
    Name extends TriggerName,
    Input = Parameters<Required<Hooks>[Name]>[0],
    Output = Parameters<Required<Hooks>[Name]>[1],
  >(
    name: Name,
    input: Input,
    output: Output,
  ) => Effect.Effect<Output>
  readonly list: () => Effect.Effect<Hooks[]>
  readonly listHookControls: (sessionID: SessionID) => Effect.Effect<HookControl[]>
  readonly setHookControl: (input: HookControlInput & { sessionID: SessionID }) => Effect.Effect<HookControl[]>
  readonly init: () => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Plugin") {}

// Built-in plugins that are directly imported (not installed from npm)
const INTERNAL_PLUGINS: PluginInstance[] = [
  CodexAuthPlugin,
  CopilotAuthPlugin,
  GitlabAuthPlugin,
  PoeAuthPlugin,
  CloudflareWorkersAuthPlugin,
  CloudflareAIGatewayAuthPlugin,
  AzureAuthPlugin,
  DigitalOceanAuthPlugin,
  XaiAuthPlugin,
]

function isServerPlugin(value: unknown): value is PluginInstance {
  return typeof value === "function"
}

function getServerPlugin(value: unknown) {
  if (isServerPlugin(value)) return value
  if (!value || typeof value !== "object" || !("server" in value)) return
  if (!isServerPlugin(value.server)) return
  return value.server
}

function getLegacyPlugins(mod: Record<string, unknown>) {
  const seen = new Set<unknown>()
  const result: PluginInstance[] = []

  for (const entry of Object.values(mod)) {
    if (seen.has(entry)) continue
    seen.add(entry)
    const plugin = getServerPlugin(entry)
    if (!plugin) throw new TypeError("Plugin export is not a function")
    result.push(plugin)
  }

  return result
}

function legacyPluginID(load: PluginLoader.Loaded, index: number) {
  if (load.source === "npm" && load.pkg?.json.name && typeof load.pkg.json.name === "string") return load.pkg.json.name
  if (load.source === "npm") return parsePluginSpecifier(load.spec).pkg
  return index === 0 ? load.spec : `${load.spec}#${index + 1}`
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") return
  return value as Record<string, unknown>
}

function sessionIDFrom(value: unknown): SessionID | undefined {
  const record = readRecord(value)
  if (!record) return

  const direct = record.sessionID
  if (typeof direct === "string") return direct as SessionID

  const properties = readRecord(record.properties)
  if (properties) {
    const nested = sessionIDFrom(properties)
    if (nested) return nested
  }

  const part = readRecord(record.part)
  if (part) {
    const nested = sessionIDFrom(part)
    if (nested) return nested
  }
}

function eventTypeFrom(value: unknown): string | undefined {
  const record = readRecord(value)
  const type = record?.type
  return typeof type === "string" ? type : undefined
}

function controlKey(input: Omit<HookControl, "enabled">) {
  return [input.sessionID, input.plugin, input.hook, input.event ?? ""].join("\0")
}

function normalizeHookControl(input: HookControlInput & { sessionID: SessionID }): HookControl {
  return {
    sessionID: input.sessionID,
    plugin: input.plugin ?? "*",
    hook: input.hook,
    event: input.event,
    enabled: input.enabled,
  }
}

function hookControlApplies(
  control: HookControl,
  input: { sessionID: SessionID | undefined; plugin: string; hook: string; event?: string },
) {
  if (control.enabled) return false
  if (!input.sessionID || control.sessionID !== input.sessionID) return false
  if (control.plugin !== "*" && control.plugin !== input.plugin) return false
  if (control.hook !== "*" && control.hook !== input.hook) return false
  if (control.event !== undefined && control.event !== input.event) return false
  return true
}

function disabledHookControl(
  state: State,
  input: { sessionID: SessionID | undefined; plugin: string; hook: string; event?: string },
) {
  return state.controls.find((control) => hookControlApplies(control, input))
}

async function applyPlugin(load: PluginLoader.Loaded, input: PluginInput, hooks: HookEntry[]) {
  const plugin = readV1Plugin(load.mod, load.spec, "server", "detect")
  if (plugin) {
    const id = await resolvePluginId(load.source, load.spec, load.target, readPluginId(plugin.id, load.spec), load.pkg)
    hooks.push({ id, hooks: await (plugin as PluginModule).server(input, load.options) })
    return
  }

  let index = 0
  for (const server of getLegacyPlugins(load.mod)) {
    hooks.push({ id: legacyPluginID(load, index), hooks: await server(input, load.options) })
    index++
  }
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const config = yield* Config.Service
    const flags = yield* RuntimeFlags.Service

    const state = yield* InstanceState.make<State>(
      Effect.fn("Plugin.state")(function* (ctx) {
        const hooks: HookEntry[] = []
        const data: State = { hooks, controls: [] }
        const bridge = yield* EffectBridge.make()

        function publishPluginError(message: string) {
          bridge.fork(bus.publish(Session.Event.Error, { error: new NamedError.Unknown({ message }).toObject() }))
        }

        const { Server } = yield* Effect.promise(() => import("../server/server"))

        const client = createOpencodeClient({
          baseUrl: "http://localhost:4096",
          directory: ctx.directory,
          headers: ServerAuth.headers(),
          fetch: async (...args) => Server.Default().app.fetch(...args),
        })
        const cfg = yield* config.get()
        const input: PluginInput = {
          client,
          project: ctx.project,
          worktree: ctx.worktree,
          directory: ctx.directory,
          experimental_workspace: {
            register(type: string, adapter: PluginWorkspaceAdapter) {
              registerAdapter(ctx.project.id, type, adapter as WorkspaceAdapter)
            },
          },
          get serverUrl(): URL {
            return Server.url ?? new URL("http://localhost:4096")
          },
          // @ts-expect-error
          $: typeof Bun === "undefined" ? undefined : Bun.$,
        }

        for (const plugin of flags.disableDefaultPlugins ? [] : INTERNAL_PLUGINS) {
          log.info("loading internal plugin", { name: plugin.name })
          const init = yield* Effect.tryPromise({
            try: () => plugin(input),
            catch: (err) => {
              log.error("failed to load internal plugin", { name: plugin.name, error: err })
            },
          }).pipe(Effect.option)
          if (init._tag === "Some") hooks.push({ id: `internal:${plugin.name || "anonymous"}`, hooks: init.value })
        }

        const plugins = flags.pure ? [] : (cfg.plugin_origins ?? [])
        if (flags.pure && cfg.plugin_origins?.length) {
          log.info("skipping external plugins in pure mode", { count: cfg.plugin_origins.length })
        }
        if (plugins.length) yield* config.waitForDependencies()

        const loaded = yield* Effect.promise(() =>
          PluginLoader.loadExternal({
            items: plugins,
            kind: "server",
            importScope: Hash.fast([ctx.project.id, ctx.worktree, ctx.directory].join("\0")),
            report: {
              start(candidate) {
                log.info("loading plugin", { path: candidate.plan.spec })
              },
              missing(candidate, _retry, message) {
                log.warn("plugin has no server entrypoint", { path: candidate.plan.spec, message })
              },
              error(candidate, _retry, stage, error, resolved) {
                const spec = candidate.plan.spec
                const cause = error instanceof Error ? (error.cause ?? error) : error
                const message = stage === "load" ? errorMessage(error) : errorMessage(cause)

                if (stage === "install") {
                  const parsed = parsePluginSpecifier(spec)
                  log.error("failed to install plugin", { pkg: parsed.pkg, version: parsed.version, error: message })
                  publishPluginError(`Failed to install plugin ${parsed.pkg}@${parsed.version}: ${message}`)
                  return
                }

                if (stage === "compatibility") {
                  log.warn("plugin incompatible", { path: spec, error: message })
                  publishPluginError(`Plugin ${spec} skipped: ${message}`)
                  return
                }

                if (stage === "entry") {
                  log.error("failed to resolve plugin server entry", { path: spec, error: message })
                  publishPluginError(`Failed to load plugin ${spec}: ${message}`)
                  return
                }

                log.error("failed to load plugin", { path: spec, target: resolved?.entry, error: message })
                publishPluginError(`Failed to load plugin ${spec}: ${message}`)
              },
            },
          }),
        )
        for (const load of loaded) {
          if (!load) continue

          // Keep plugin execution sequential so hook registration and execution
          // order remains deterministic across plugin runs.
          yield* Effect.tryPromise({
            try: () => applyPlugin(load, input, hooks),
            catch: (err) => {
              const message = errorMessage(err)
              log.error("failed to load plugin", { path: load.spec, error: message })
              return message
            },
          }).pipe(
            Effect.catch(() => {
              // TODO: make proper events for this
              // bus.publish(Session.Event.Error, {
              //   error: new NamedError.Unknown({
              //     message: `Failed to load plugin ${load.spec}: ${message}`,
              //   }).toObject(),
              // })
              return Effect.void
            }),
          )
        }

        // Notify plugins of current config
        for (const entry of hooks) {
          yield* Effect.tryPromise({
            try: () => Promise.resolve((entry.hooks as any).config?.(cfg)),
            catch: (err) => {
              log.error("plugin config hook failed", { error: err })
            },
          }).pipe(Effect.ignore)
        }

        // Subscribe to bus events, fiber interrupted when scope closes
        yield* (yield* bus.subscribeAll()).pipe(
          Stream.runForEach((input) =>
            Effect.sync(() => {
              const sessionID = sessionIDFrom(input)
              const event = eventTypeFrom(input)
              for (const entry of hooks) {
                if (disabledHookControl(data, { sessionID, plugin: entry.id, hook: "event", event })) continue
                void entry.hooks["event"]?.({ event: input as any })
              }
            }),
          ),
          Effect.forkScoped,
        )

        return data
      }),
    )

    const trigger = Effect.fn("Plugin.trigger")(function* <
      Name extends TriggerName,
      Input = Parameters<Required<Hooks>[Name]>[0],
      Output = Parameters<Required<Hooks>[Name]>[1],
    >(name: Name, input: Input, output: Output) {
      if (!name) return output
      const s = yield* InstanceState.get(state)
      const sessionID = sessionIDFrom(input)
      for (const entry of s.hooks) {
        if (disabledHookControl(s, { sessionID, plugin: entry.id, hook: name })) continue
        const fn = entry.hooks[name] as any
        if (!fn) continue
        yield* Effect.promise(async () => fn(input, output))
      }
      return output
    })

    const list = Effect.fn("Plugin.list")(function* () {
      const s = yield* InstanceState.get(state)
      return s.hooks.map((entry) => entry.hooks)
    })

    const listHookControls = Effect.fn("Plugin.listHookControls")(function* (sessionID: SessionID) {
      const s = yield* InstanceState.get(state)
      return s.controls.filter((control) => control.sessionID === sessionID)
    })

    const setHookControl = Effect.fn("Plugin.setHookControl")(function* (
      input: HookControlInput & { sessionID: SessionID },
    ) {
      const s = yield* InstanceState.get(state)
      const next = normalizeHookControl(input)
      const key = controlKey(next)
      s.controls = s.controls.filter((control) => controlKey(control) !== key)
      if (!next.enabled) s.controls.push(next)
      return s.controls.filter((control) => control.sessionID === input.sessionID)
    })

    const init = Effect.fn("Plugin.init")(function* () {
      yield* InstanceState.get(state)
    })

    return Service.of({ trigger, list, listHookControls, setHookControl, init })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(Bus.layer),
  Layer.provide(Config.defaultLayer),
  Layer.provide(RuntimeFlags.defaultLayer),
)

export * as Plugin from "."
