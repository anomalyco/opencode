import type { Hooks, PluginInput, Plugin as PluginInstance } from "@opencode-ai/plugin"
import { Bus } from "../bus"
import { Log } from "../util/log"
import { createOpencodeClient } from "@opencode-ai/sdk"
import { BunProc } from "../bun"
import { Flag } from "../flag/flag"
import { NamedError } from "@opencode-ai/util/error"
<<<<<<< HEAD
import { Effect, Layer, ServiceMap } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { makeRunPromise } from "@/effect/run-service"
||||||| parent of 080d3b93c (use forkScoped + Fiber.join for lazy init (match old Instance.state behavior))
import { CopilotAuthPlugin } from "./copilot"
import { gitlabAuthPlugin as GitlabAuthPlugin } from "@gitlab/opencode-gitlab-auth"
import { Effect, Layer, ServiceMap } from "effect"
import { InstanceContext } from "@/effect/instance-context"
import { runPromiseInstance } from "@/effect/runtime"
=======
import { CopilotAuthPlugin } from "./copilot"
import { gitlabAuthPlugin as GitlabAuthPlugin } from "@gitlab/opencode-gitlab-auth"
import { Effect, Fiber, Layer, ServiceMap } from "effect"
import { InstanceContext } from "@/effect/instance-context"
import { runPromiseInstance } from "@/effect/runtime"
>>>>>>> 080d3b93c (use forkScoped + Fiber.join for lazy init (match old Instance.state behavior))

export namespace Plugin {
  const log = Log.create({ service: "plugin" })

  type State = {
    hooks: Hooks[]
    started: boolean
    ensure: () => Promise<void>
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
          let task: Promise<void> | undefined

<<<<<<< HEAD
          async function load() {
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
||||||| parent of 080d3b93c (use forkScoped + Fiber.join for lazy init (match old Instance.state behavior))
      yield* Effect.promise(async () => {
        const client = createOpencodeClient({
          baseUrl: "http://localhost:4096",
          directory: instance.directory,
          headers: Flag.OPENCODE_SERVER_PASSWORD
            ? {
                Authorization: `Basic ${Buffer.from(`${Flag.OPENCODE_SERVER_USERNAME ?? "opencode"}:${Flag.OPENCODE_SERVER_PASSWORD}`).toString("base64")}`,
              }
            : undefined,
          fetch: async (...args) => Server.Default().fetch(...args),
        })
        const config = await Config.get()
        const input: PluginInput = {
          client,
          project: instance.project,
          worktree: instance.worktree,
          directory: instance.directory,
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

        let plugins = config.plugin ?? []
        if (plugins.length) await Config.waitForDependencies()

        for (let plugin of plugins) {
          // ignore old codex plugin since it is supported first party now
          if (plugin.includes("opencode-openai-codex-auth") || plugin.includes("opencode-copilot-auth")) continue
          log.info("loading plugin", { path: plugin })
          if (!plugin.startsWith("file://")) {
            const lastAtIndex = plugin.lastIndexOf("@")
            const pkg = lastAtIndex > 0 ? plugin.substring(0, lastAtIndex) : plugin
            const version = lastAtIndex > 0 ? plugin.substring(lastAtIndex + 1) : "latest"
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
=======
      const load = Effect.fn("Plugin.load")(function* () {
        yield* Effect.promise(async () => {
          const client = createOpencodeClient({
            baseUrl: "http://localhost:4096",
            directory: instance.directory,
            headers: Flag.OPENCODE_SERVER_PASSWORD
              ? {
                  Authorization: `Basic ${Buffer.from(`${Flag.OPENCODE_SERVER_USERNAME ?? "opencode"}:${Flag.OPENCODE_SERVER_PASSWORD}`).toString("base64")}`,
                }
              : undefined,
            fetch: async (...args) => Server.Default().fetch(...args),
          })
          const config = await Config.get()
          const input: PluginInput = {
            client,
            project: instance.project,
            worktree: instance.worktree,
            directory: instance.directory,
            get serverUrl(): URL {
              return Server.url ?? new URL("http://localhost:4096")
            },
            $: Bun.$,
>>>>>>> 080d3b93c (use forkScoped + Fiber.join for lazy init (match old Instance.state behavior))
          }
<<<<<<< HEAD

          return {
            hooks,
            started: false,
            ensure: () => {
              task ??= Effect.runPromise(
                Effect.tryPromise({
                  try: load,
                  catch: (cause) => cause,
                }).pipe(Effect.catchCause((cause) => Effect.sync(() => log.error("init failed", { cause })))),
              )
              return task
            },
          }
        }),
      )
||||||| parent of 080d3b93c (use forkScoped + Fiber.join for lazy init (match old Instance.state behavior))
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
      })
=======

          for (const plugin of INTERNAL_PLUGINS) {
            log.info("loading internal plugin", { name: plugin.name })
            const init = await plugin(input).catch((err) => {
              log.error("failed to load internal plugin", { name: plugin.name, error: err })
            })
            if (init) hooks.push(init)
          }

          let plugins = config.plugin ?? []
          if (plugins.length) await Config.waitForDependencies()

          for (let plugin of plugins) {
            // ignore old codex plugin since it is supported first party now
            if (plugin.includes("opencode-openai-codex-auth") || plugin.includes("opencode-copilot-auth")) continue
            log.info("loading plugin", { path: plugin })
            if (!plugin.startsWith("file://")) {
              const lastAtIndex = plugin.lastIndexOf("@")
              const pkg = lastAtIndex > 0 ? plugin.substring(0, lastAtIndex) : plugin
              const version = lastAtIndex > 0 ? plugin.substring(lastAtIndex + 1) : "latest"
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
        })
      })
>>>>>>> 080d3b93c (use forkScoped + Fiber.join for lazy init (match old Instance.state behavior))

      const loadFiber = yield* load().pipe(
        Effect.catchCause((cause) => Effect.sync(() => log.error("init failed", { cause }))),
        Effect.forkScoped,
      )

      const trigger = Effect.fn("Plugin.trigger")(function* <
        Name extends Exclude<keyof Required<Hooks>, "auth" | "event" | "tool">,
        Input = Parameters<Required<Hooks>[Name]>[0],
        Output = Parameters<Required<Hooks>[Name]>[1],
      >(name: Name, input: Input, output: Output) {
        if (!name) return output
<<<<<<< HEAD
        const state = yield* InstanceState.get(cache)
        yield* Effect.promise(() => state.ensure())
||||||| parent of 080d3b93c (use forkScoped + Fiber.join for lazy init (match old Instance.state behavior))
=======
        yield* Fiber.join(loadFiber)
>>>>>>> 080d3b93c (use forkScoped + Fiber.join for lazy init (match old Instance.state behavior))
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
<<<<<<< HEAD
        const state = yield* InstanceState.get(cache)
        yield* Effect.promise(() => state.ensure())
        return state.hooks
||||||| parent of 080d3b93c (use forkScoped + Fiber.join for lazy init (match old Instance.state behavior))
        return hooks
=======
        yield* Fiber.join(loadFiber)
        return hooks
>>>>>>> 080d3b93c (use forkScoped + Fiber.join for lazy init (match old Instance.state behavior))
      })

      const init = Effect.fn("Plugin.init")(function* () {
<<<<<<< HEAD
        const state = yield* InstanceState.get(cache)
        yield* Effect.promise(() => state.ensure())
        if (state.started) return
        state.started = true
||||||| parent of 080d3b93c (use forkScoped + Fiber.join for lazy init (match old Instance.state behavior))
=======
        yield* Fiber.join(loadFiber)
>>>>>>> 080d3b93c (use forkScoped + Fiber.join for lazy init (match old Instance.state behavior))
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

<<<<<<< HEAD
  export async function list(): Promise<Hooks[]> {
    return runPromise((svc) => svc.list())
||||||| parent of 080d3b93c (use forkScoped + Fiber.join for lazy init (match old Instance.state behavior))
  export async function list() {
    return runPromiseInstance(Service.use((svc) => svc.list()))
=======
  export async function list(): Promise<Hooks[]> {
    return runPromiseInstance(Service.use((svc) => svc.list()))
>>>>>>> 080d3b93c (use forkScoped + Fiber.join for lazy init (match old Instance.state behavior))
  }

  export async function init() {
    return runPromise((svc) => svc.init())
  }
}
