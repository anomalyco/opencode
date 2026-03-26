import type { Hooks, PluginInput, Plugin as PluginInstance } from "@opencode-ai/plugin"
import { Config } from "../config/config"
import { Bus } from "../bus"
import { Log } from "../util/log"
import { createOpencodeClient } from "@opencode-ai/sdk"
import { BunProc } from "../bun"
import { Flag } from "../flag/flag"
import { CodexAuthPlugin } from "./codex"
import { Session } from "../session"
import { NamedError } from "@opencode-ai/util/error"
import { CopilotAuthPlugin } from "./copilot"
import { gitlabAuthPlugin as GitlabAuthPlugin } from "opencode-gitlab-auth"
import { PoeAuthPlugin } from "opencode-poe-auth"
import { Effect, Layer, ServiceMap, Stream } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { makeRuntime } from "@/effect/run-service"

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

  export class Service extends ServiceMap.Service<Service, Interface>()("@opencode/Plugin") {}

  // Built-in plugins that are directly imported (not installed from npm)
  const INTERNAL_PLUGINS: PluginInstance[] = [CodexAuthPlugin, CopilotAuthPlugin, GitlabAuthPlugin, PoeAuthPlugin]

  // Old npm package names for plugins that are now built-in — skip if users still have them in config
  const DEPRECATED_PLUGIN_PACKAGES = ["opencode-openai-codex-auth", "opencode-copilot-auth"]

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const bus = yield* Bus.Service

      const cache = yield* InstanceState.make<State>(
        Effect.fn("Plugin.state")(function* (ctx) {
          const hooks: Hooks[] = []

          yield* Effect.promise(async () => {
            const { Server } = await import("../server/server")

            const client = createOpencodeClient({
              baseUrl: "http://localhost:4096",
              directory: ctx.directory,
              headers: Flag.OPENCODE_SERVER_PASSWORD
                ? {
                    Authorization: `Basic ${Buffer.from(`${Flag.OPENCODE_SERVER_USERNAME ?? "opencode"}:${Flag.OPENCODE_SERVER_PASSWORD}`).toString("base64")}`,
                  }
                : undefined,
              fetch: async (...args) => Server.Default().fetch(...args),
            })
            const cfg = await Config.get()
            const input: PluginInput = {
              client,
              project: ctx.project,
              worktree: ctx.worktree,
              directory: ctx.directory,
              get serverUrl(): URL {
                return Server.url ?? new URL("http://localhost:4096")
              },
              $: Bun.$,
            }

            for (const plugin of INTERNAL_PLUGINS) {
              log.info("loading internal plugin", { name: plugin.name })
              const init = await plugin(input).catch((err) => {
                log.error("failed to load internal plugin", { name: plugin.name, error: err })
              })
              if (init) hooks.push(init)
            }

            let plugins = cfg.plugin ?? []
            if (plugins.length) await Config.waitForDependencies()

            for (let plugin of plugins) {
              if (DEPRECATED_PLUGIN_PACKAGES.some((pkg) => plugin.includes(pkg))) continue
              log.info("loading plugin", { path: plugin })
              if (!plugin.startsWith("file://")) {
                const idx = plugin.lastIndexOf("@")
                const pkg = idx > 0 ? plugin.substring(0, idx) : plugin
                const version = idx > 0 ? plugin.substring(idx + 1) : "latest"
                plugin = await BunProc.install(pkg, version).catch((err) => {
                  const cause = err instanceof Error ? err.cause : err
                  const detail = cause instanceof Error ? cause.message : String(cause ?? err)
                  log.error("failed to install plugin", { pkg, version, error: detail })
                  Bus.publish(Session.Event.Error, {
                    error: new NamedError.Unknown({
                      message: `Failed to install plugin ${pkg}@${version}: ${detail}`,
                    }).toObject(),
                  })
                  return ""
                })
                if (!plugin) continue
              }

              // Prevent duplicate initialization when plugins export the same function
              // as both a named export and default export (e.g., `export const X` and `export default X`).
              // Object.entries(mod) would return both entries pointing to the same function reference.
              await import(plugin)
                .then(async (mod) => {
                  const seen = new Set<PluginInstance>()
                  for (const [_name, fn] of Object.entries<PluginInstance>(mod)) {
                    if (seen.has(fn)) continue
                    seen.add(fn)
                    hooks.push(await fn(input))
                  }
                })
                .catch((err) => {
                  const message = err instanceof Error ? err.message : String(err)
                  log.error("failed to load plugin", { path: plugin, error: message })
                  Bus.publish(Session.Event.Error, {
                    error: new NamedError.Unknown({
                      message: `Failed to load plugin ${plugin}: ${message}`,
                    }).toObject(),
                  })
                })
            }

            // Notify plugins of current config
            for (const hook of hooks) {
              try {
                await (hook as any).config?.(cfg)
              } catch (err) {
                log.error("plugin config hook failed", { error: err })
              }
            }
          })

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
        const state = yield* InstanceState.get(cache)
        yield* Effect.promise(async () => {
          for (const hook of state.hooks) {
            const fn = hook[name] as any
            if (!fn) continue
            await fn(input, output)
          }
        })
        return output
      })

      const list = Effect.fn("Plugin.list")(function* () {
        const state = yield* InstanceState.get(cache)
        return state.hooks
      })

      const init = Effect.fn("Plugin.init")(function* () {
        yield* InstanceState.get(cache)
      })

      return Service.of({ trigger, list, init })
    }),
  )

  const defaultLayer = layer.pipe(Layer.provide(Bus.layer))
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
