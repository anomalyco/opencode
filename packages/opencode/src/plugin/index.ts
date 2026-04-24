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
import { Effect, Layer, ServiceMap } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { makeRunPromise } from "@/effect/run-service"
import { Instance } from "@/project/instance"

export namespace Plugin {
  const log = Log.create({ service: "plugin" })
  const pending = new Map<string, Promise<void>>()

  type Item = {
    name: string
    hooks: Hooks
    custom: boolean
  }

  type State = {
    hooks: Item[]
  }

  type TriggerEvent = {
    plugin: string
    custom: boolean
    hook: string
    stage: "before" | "after" | "error"
    error?: string
  }

  export type TriggerOpts = {
    onInvoke?: (input: TriggerEvent) => Promise<void> | void
  }

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
      opts?: TriggerOpts,
    ) => Effect.Effect<Output>
    readonly list: () => Effect.Effect<Hooks[]>
    readonly init: () => Effect.Effect<void>
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@opencode/Plugin") {}

  const INTERNAL_PLUGINS: PluginInstance[] = [CodexAuthPlugin, CopilotAuthPlugin, GitlabAuthPlugin, PoeAuthPlugin]
  const DEPRECATED_PLUGIN_PACKAGES = ["opencode-openai-codex-auth", "opencode-copilot-auth"]

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const cache = yield* InstanceState.make<State>(
        Effect.fn("Plugin.state")(function* (ctx) {
          const hooks: Item[] = []

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
            const cfg = await Config.live()
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
              if (init) hooks.push({ name: plugin.name || "internal", hooks: init, custom: false })
            }

            let plugins = cfg.plugin ?? []
            if (plugins.length) await Config.waitForDependencies()

            for (let plugin of plugins) {
              const spec = plugin
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

              await import(plugin)
                .then(async (mod) => {
                  const seen = new Set<PluginInstance>()
                  for (const [name, fn] of Object.entries<PluginInstance>(mod)) {
                    if (typeof fn !== "function") continue
                    if (seen.has(fn)) continue
                    seen.add(fn)
                    const init = await fn(input)
                    const base = Config.getPluginName(plugin)
                    hooks.push({
                      name: name === "default" ? base : `${base}:${name}`,
                      hooks: init,
                      custom: !spec.startsWith("opencode-"),
                    })
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

            for (const item of hooks) {
              try {
                await (item.hooks as any).config?.(cfg)
              } catch (err) {
                log.error("plugin config hook failed", { error: err })
              }
            }
          })

          yield* Effect.acquireRelease(
            Effect.sync(() =>
              Bus.subscribeAll(async (input) => {
                for (const item of hooks) {
                  item.hooks["event"]?.({ event: input })
                }
              }),
            ),
            (unsub) => Effect.sync(unsub),
          )

          return { hooks }
        }),
      )

      const trigger = Effect.fn("Plugin.trigger")(function* <
        Name extends TriggerName,
        Input = Parameters<Required<Hooks>[Name]>[0],
        Output = Parameters<Required<Hooks>[Name]>[1],
      >(name: Name, input: Input, output: Output, opts?: TriggerOpts) {
        if (!name) return output
        const state = yield* InstanceState.get(cache)
        yield* Effect.promise(async () => {
          for (const item of state.hooks) {
            const fn = item.hooks[name] as any
            if (!fn) continue
            await opts?.onInvoke?.({
              plugin: item.name,
              custom: item.custom,
              hook: String(name),
              stage: "before",
            })
            try {
              await fn(input, output)
              await opts?.onInvoke?.({
                plugin: item.name,
                custom: item.custom,
                hook: String(name),
                stage: "after",
              })
            } catch (err) {
              await opts?.onInvoke?.({
                plugin: item.name,
                custom: item.custom,
                hook: String(name),
                stage: "error",
                error: err instanceof Error ? err.message : String(err),
              })
              throw err
            }
          }
        })
        return output
      })

      const list = Effect.fn("Plugin.list")(function* () {
        const state = yield* InstanceState.get(cache)
        return state.hooks.map((item) => item.hooks)
      })

      const init = Effect.fn("Plugin.init")(function* () {
        yield* InstanceState.get(cache)
      })

      return Service.of({ trigger, list, init })
    }),
  )

  const runPromise = makeRunPromise(Service, layer)

  export async function trigger<
    Name extends TriggerName,
    Input = Parameters<Required<Hooks>[Name]>[0],
    Output = Parameters<Required<Hooks>[Name]>[1],
  >(name: Name, input: Input, output: Output, opts?: TriggerOpts): Promise<Output> {
    return runPromise((svc) => svc.trigger(name, input, output, opts))
  }

  export async function list(): Promise<Hooks[]> {
    return runPromise((svc) => svc.list())
  }

  export async function init() {
    const dir = Instance.directory
    const task = pending.get(dir)
    if (task) return task

    const next = runPromise((svc) => svc.init())
      .catch((err) => {
        log.error("plugin preload failed", {
          directory: dir,
          error: err instanceof Error ? err.message : String(err),
        })
      })
      .finally(() => {
        if (pending.get(dir) === next) pending.delete(dir)
      })

    pending.set(dir, next)
    return next
  }
}
