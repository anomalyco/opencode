import type { Hooks, PluginInput, Plugin as PluginInstance, PluginModule } from "@opencode-ai/plugin"
import { Config } from "../config/config"
import { Bus } from "../bus"
import { Log } from "../util/log"
import { createOpencodeClient } from "@opencode-ai/sdk"
import { Flag } from "../flag/flag"
import { CodexAuthPlugin } from "./codex"
import { Session } from "../session"
import { NamedError } from "@opencode-ai/util/error"
import { CopilotAuthPlugin } from "./github-copilot/copilot"
import { gitlabAuthPlugin as GitlabAuthPlugin } from "opencode-gitlab-auth"
import { PoeAuthPlugin } from "opencode-poe-auth"
import { CloudflareAIGatewayAuthPlugin, CloudflareWorkersAuthPlugin } from "./cloudflare"
import { Effect, Layer, Context, Stream } from "effect"
import { EffectLogger } from "@/effect/logger"
import { InstanceState } from "@/effect/instance-state"
import { makeRuntime } from "@/effect/run-service"
import { errorMessage } from "@/util/error"
import { PluginLoader } from "./loader"
import { parsePluginSpecifier, readPluginId, readV1Plugin, resolvePluginId } from "./shared"

export namespace Plugin {
  const log = Log.create({ service: "plugin" })

  type State = {
    hooks: Hooks[]
  }

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

  function publishPluginError(bus: Bus.Interface, message: string) {
    Effect.runFork(
      bus
        .publish(Session.Event.Error, { error: new NamedError.Unknown({ message }).toObject() })
        .pipe(Effect.provide(EffectLogger.layer)),
    )
  }

  async function applyPlugin(load: PluginLoader.Loaded, input: PluginInput, hooks: Hooks[]) {
    const plugin = readV1Plugin(load.mod, load.spec, "server", "detect")
    if (plugin) {
      await resolvePluginId(load.source, load.spec, load.target, readPluginId(plugin.id, load.spec), load.pkg)
      hooks.push(await (plugin as PluginModule).server(input, load.options))
      return
    }

    for (const server of getLegacyPlugins(load.mod)) {
      hooks.push(await server(input, load.options))
    }
  }

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const config = yield* Config.Service

      const state = yield* InstanceState.make<State>(
        Effect.fn("Plugin.state")(function* (ctx) {
          const hooks: Hooks[] = []

          const { Server } = yield* Effect.promise(() => import("../server/server"))

          const client = createOpencodeClient({
            baseUrl: "http://localhost:4096",
            directory: ctx.directory,
            headers: Flag.OPENCODE_SERVER_PASSWORD
              ? {
                  Authorization: `Basic ${Buffer.from(`${Flag.OPENCODE_SERVER_USERNAME ?? "opencode"}:${Flag.OPENCODE_SERVER_PASSWORD}`).toString("base64")}`,
                }
              : undefined,
            fetch: async (...args) => Server.Default().app.fetch(...args),
          })
          const cfg = yield* config.get()
          const input: PluginInput = {
            client,
            project: ctx.project,
            worktree: ctx.worktree,
            directory: ctx.directory,
            get serverUrl(): URL {
              return Server.url ?? new URL("http://localhost:4096")
            },
            // @ts-expect-error
            $: typeof Bun === "undefined" ? undefined : Bun.$,
          }

          for (const plugin of INTERNAL_PLUGINS) {
            log.info("loading internal plugin", { name: plugin.name })
            const init = yield* Effect.tryPromise({
              try: () => plugin(input),
              catch: (err) => {
                log.error("failed to load internal plugin", { name: plugin.name, error: err })
              },
            }).pipe(Effect.option)
            if (init._tag === "Some") hooks.push(init.value)
          }

          const plugins = Flag.OPENCODE_PURE ? [] : (cfg.plugin_origins ?? [])
          if (Flag.OPENCODE_PURE && cfg.plugin_origins?.length) {
            log.info("skipping external plugins in pure mode", { count: cfg.plugin_origins.length })
          }
          if (plugins.length) yield* config.waitForDependencies()

          const loaded = yield* Effect.promise(() =>
            PluginLoader.loadExternal({
              items: plugins,
              kind: "server",
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
                    publishPluginError(bus, `Failed to install plugin ${parsed.pkg}@${parsed.version}: ${message}`)
                    return
                  }

                  if (stage === "compatibility") {
                    log.warn("plugin incompatible", { path: spec, error: message })
                    publishPluginError(bus, `Plugin ${spec} skipped: ${message}`)
                    return
                  }

                  if (stage === "entry") {
                    log.error("failed to resolve plugin server entry", { path: spec, error: message })
                    publishPluginError(bus, `Failed to load plugin ${spec}: ${message}`)
                    return
                  }

                  log.error("failed to load plugin", { path: spec, target: resolved?.entry, error: message })
                  publishPluginError(bus, `Failed to load plugin ${spec}: ${message}`)
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
              Effect.catch((message) =>
                bus.publish(Session.Event.Error, {
                  error: new NamedError.Unknown({
                    message: `Failed to load plugin ${load.spec}: ${message}`,
                  }).toObject(),
                }),
              ),
            )
          }

          // Notify plugins of current config
          for (const hook of hooks) {
            yield* Effect.tryPromise({
              try: () => Promise.resolve((hook as any).config?.(cfg)),
              catch: (err) => {
                log.error("plugin config hook failed", { error: err })
              },
            }).pipe(Effect.ignore)
          }

          // Subscribe to bus events, fiber interrupted when scope closes
          yield* bus.subscribeAll().pipe(
            Stream.runForEach((input) =>
              Effect.sync(() => {
                for (const hook of hooks) {
                  hook["event"]?.({ event: input as any })
                }
              }),
            ),
            Effect.forkScoped,
          )

          return { hooks }
        }),
      )

      const trigger = Effect.fn("Plugin.trigger")(function* <
        Name extends TriggerName,
        Input = Parameters<Required<Hooks>[Name]>[0],
        Output = Parameters<Required<Hooks>[Name]>[1],
      >(name: Name, input: Input, output: Output) {
        if (!name) return output
        const s = yield* InstanceState.get(state)
        for (const hook of s.hooks) {
          const fn = hook[name] as any
          if (!fn) continue
          yield* Effect.promise(async () => fn(input, output))
        }
        return output
      })

      const list = Effect.fn("Plugin.list")(function* () {
        const s = yield* InstanceState.get(state)
        return s.hooks
      })

      const init = Effect.fn("Plugin.init")(function* () {
        yield* InstanceState.get(state)
      })

      return Service.of({ trigger, list, init })
    }),
  )

  export const defaultLayer = layer.pipe(Layer.provide(Bus.layer), Layer.provide(Config.defaultLayer))
  const { runPromise } = makeRuntime(Service, defaultLayer)

  export async function trigger<
    Name extends TriggerName,
    Input = Parameters<Required<Hooks>[Name]>[0],
    Output = Parameters<Required<Hooks>[Name]>[1],
  >(name: Name, input: Input, output: Output): Promise<Output> {
    return runPromise((svc) => svc.trigger(name, input, output))
  }

  export async function list(): Promise<Hooks[]> {
    return runPromise((svc) => svc.list())
  }

  export async function init() {
    return runPromise((svc) => svc.init())
  }
}
