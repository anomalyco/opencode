import type { Hooks, PluginInput, Plugin as PluginInstance } from "@opencode-ai/plugin"
import { Bus } from "../bus"
import { Log } from "../util/log"
import { createOpencodeClient } from "@opencode-ai/sdk"
import { BunProc } from "../bun"
import { Flag } from "../flag/flag"
import { NamedError } from "@opencode-ai/util/error"
import { Effect, Layer, ServiceMap } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { makeRunPromise } from "@/effect/run-service"

export namespace Plugin {
  const log = Log.create({ service: "plugin" })

  type State = {
    hooks: Hooks[]
    started: boolean
  }

  export interface Interface {
    readonly trigger: <
      Name extends Exclude<keyof Required<Hooks>, "auth" | "event" | "tool">,
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

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const cache = yield* InstanceState.make<State>(
        Effect.fn("Plugin.state")(function* (ctx) {
          const hooks: Hooks[] = []

          yield* Effect.promise(async () => {
            const [{ Config }, { Server }, codex, copilot, gitlab] = await Promise.all([
              import("../config/config"),
              import("../server/server"),
              import("./codex"),
              import("./copilot"),
              import("opencode-gitlab-auth"),
            ])
            const internal: PluginInstance[] = [
              codex.CodexAuthPlugin,
              copilot.CopilotAuthPlugin,
              gitlab.gitlabAuthPlugin,
            ]
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

            for (const plugin of internal) {
              log.info("loading internal plugin", { name: plugin.name })
              const init = await plugin(input).catch((err) => {
                log.error("failed to load internal plugin", { name: plugin.name, error: err })
              })
              if (init) hooks.push(init)
            }

            let plugins = cfg.plugin ?? []
            if (plugins.length) await Config.waitForDependencies()

            for (let plugin of plugins) {
              if (plugin.includes("opencode-openai-codex-auth") || plugin.includes("opencode-copilot-auth")) continue
              log.info("loading plugin", { path: plugin })
              if (!plugin.startsWith("file://")) {
                const idx = plugin.lastIndexOf("@")
                const pkg = idx > 0 ? plugin.substring(0, idx) : plugin
                const version = idx > 0 ? plugin.substring(idx + 1) : "latest"
                plugin = await BunProc.install(pkg, version).catch((err) => {
                  const cause = err instanceof Error ? err.cause : err
                  const detail = cause instanceof Error ? cause.message : String(cause ?? err)
                  log.error("failed to install plugin", { pkg, version, error: detail })
                  void import("../session").then(({ Session }) =>
                    Bus.publish(Session.Event.Error, {
                      error: new NamedError.Unknown({
                        message: `Failed to install plugin ${pkg}@${version}: ${detail}`,
                      }).toObject(),
                    }),
                  )
                  return ""
                })
                if (!plugin) continue
              }

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
                  void import("../session").then(({ Session }) =>
                    Bus.publish(Session.Event.Error, {
                      error: new NamedError.Unknown({
                        message: `Failed to load plugin ${plugin}: ${message}`,
                      }).toObject(),
                    }),
                  )
                })
            }
          })

          return { hooks, started: false }
        }),
      )

      const trigger = Effect.fn("Plugin.trigger")(function* <
        Name extends Exclude<keyof Required<Hooks>, "auth" | "event" | "tool">,
        Input = Parameters<Required<Hooks>[Name]>[0],
        Output = Parameters<Required<Hooks>[Name]>[1],
      >(name: Name, input: Input, output: Output) {
        if (!name) return output
        const state = yield* InstanceState.get(cache)
        yield* Effect.promise(async () => {
          for (const hook of state.hooks) {
            const fn = hook[name]
            if (!fn) continue
            // @ts-expect-error if you feel adventurous, please fix the typing, make sure to bump the try-counter if you
            // give up.
            // try-counter: 2
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
        const state = yield* InstanceState.get(cache)
        if (state.started) return
        state.started = true
        yield* Effect.promise(async () => {
          const { Config } = await import("../config/config")
          const cfg = await Config.get()
          for (const hook of state.hooks) {
            await (hook as any).config?.(cfg)
          }
          Bus.subscribeAll(async (input) => {
            for (const hook of state.hooks) {
              hook["event"]?.({ event: input })
            }
          })
        })
      })

      return Service.of({ trigger, list, init })
    }),
  )

  const runPromise = makeRunPromise(Service, layer)

  export async function trigger<
    Name extends Exclude<keyof Required<Hooks>, "auth" | "event" | "tool">,
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
