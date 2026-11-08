import { createRequire } from "node:module"
import path from "node:path"
import { Effect, Exit, Fiber } from "effect"
import { createRunnableDevEnvironment, createServer, isRunnableDevEnvironment } from "vite"
import solid from "vite-plugin-solid"
import refresh from "solid-refresh/babel"
import { host, type Run } from "./host.js"

const require = createRequire(import.meta.url)

export const run: Run = Effect.fn("Tui.vite")(function* (input: Parameters<Run>[0]) {
  const fork = Effect.runForkWith(yield* Effect.context<Effect.Services<ReturnType<Run>>>())
  const finished = Promise.withResolvers<Exit.Exit<void, unknown>>()
  let initial = true
  let recoverable = false
  host.route = undefined
  host.settle = () => {
    recoverable = false
  }
  host.stop = async () => {
    const fiber = host.active
    host.active = undefined
    if (fiber) await Effect.runPromise(Fiber.interrupt(fiber))
  }
  host.mount = async (app) => {
    await host.stop?.()
    const fiber = fork(
      app({
        ...input,
        args: initial
          ? input.args
          : { ...input.args, prompt: undefined, sessionID: undefined, continue: false, fork: false },
        terminalHandoff: initial ? input.terminalHandoff : undefined,
      }),
    )
    initial = false
    host.active = fiber
    fiber.addObserver((exit) => {
      if (host.active !== fiber) return
      host.active = undefined
      finished.resolve(exit)
    })
  }

  const server = yield* Effect.acquireRelease(
    Effect.tryPromise(() =>
      createServer({
        root: path.resolve(import.meta.dirname, "../../tui"),
        configFile: false,
        appType: "custom",
        clearScreen: false,
        logLevel: "error",
        server: { middlewareMode: true, ws: false },
        resolve: {
          alias: [
            { find: /^solid-js(?:\/dist\/solid.js)?$/, replacement: require.resolve("solid-js/dist/dev.js") },
            {
              find: /^solid-js\/store(?:\/dist\/store.js)?$/,
              replacement: require.resolve("solid-js/store/dist/dev.js"),
            },
          ],
        },
        plugins: [
          {
            name: "tui-refresh-boundaries",
            enforce: "pre",
            async resolveId(source, importer) {
              if (importer === path.join(import.meta.dirname, "route.tsx")) return
              if (!source.endsWith("/route") && !source.endsWith("/route.tsx")) return
              const resolved = await this.resolve(source, importer, { skipSelf: true })
              if (resolved?.id === path.resolve(import.meta.dirname, "../../tui/src/context/route.tsx"))
                return path.join(import.meta.dirname, "route.tsx")
            },
            load(id) {
              if (id === "/@solid-refresh")
                return `export * from ${JSON.stringify(path.join(import.meta.dirname, "refresh.ts"))}`
            },
          },
          solid({
            hot: false,
            dev: true,
            solid: { generate: "universal", moduleName: "@opentui/solid" },
            // Enable the existing refresh plugin in Vite's non-browser environment.
            babel: { plugins: [[refresh, { bundler: "vite" }]] },
          }),
          {
            name: "tui-recovery",
            hotUpdate() {
              if (this.environment.name !== "native") return
              recoverable = Boolean(host.active)
              if (host.active) return
              this.environment.moduleGraph.invalidateAll()
              this.environment.hot.send({ type: "full-reload" })
              return []
            },
          },
        ],
        environments: {
          native: {
            consumer: "server",
            resolve: {
              conditions: ["bun", "development", "module"],
              externalConditions: ["bun", "node"],
              noExternal: [
                "solid-js",
                "solid-refresh",
                "@opentui/solid",
                "@opentui/keymap",
                /^@solid-primitives\//,
                "@Mackery6969/plugin",
                "@Mackery6969/client",
                "@Mackery6969/latex",
                "@Mackery6969/merman",
              ],
              // Exact subpaths are needed for workspace TypeScript exports.
              external: [
                "@opentui/core",
                "@opentui/core/testing",
                "effect",
                "@Mackery6969/cli/vite-host",
                "@Mackery6969/client",
                "@Mackery6969/client/effect/service",
                "@Mackery6969/client/promise",
                "@Mackery6969/core/util/slug",
                "@Mackery6969/schema",
                "@Mackery6969/schema/event",
                "@Mackery6969/schema/project",
                "@Mackery6969/schema/session-id",
                "@Mackery6969/schema/session-inbox",
                "@Mackery6969/schema/session-message",
                "@Mackery6969/schema/skill",
                "@Mackery6969/schema/token-usage",
                "@Mackery6969/schema/vcs",
                "@Mackery6969/schema/worktree",
                "@Mackery6969/simulation/frontend",
                "@Mackery6969/simulation/protocol",
                "@Mackery6969/theme/tui",
                "@Mackery6969/theme/tui/v1",
                "@Mackery6969/util/activity-calendar",
                "@Mackery6969/util/flock",
                "@Mackery6969/util/global",
                "@Mackery6969/util/hash",
                "@Mackery6969/util/session-title-fallback",
              ],
            },
            optimizeDeps: { noDiscovery: true, include: [] },
            dev: {
              createEnvironment: (name, config) =>
                createRunnableDevEnvironment(name, config, {
                  runnerOptions: {
                    sourcemapInterceptor: false,
                    hmr: { logger: { debug() {}, error: (error) => console.error(error) } },
                  },
                }),
            },
          },
        },
      }),
    ),
    (server) =>
      Effect.promise(async () => {
        await host.stop?.()
        await server.close()
      }),
  )
  const environment = server.environments.native
  if (!isRunnableDevEnvironment(environment)) return yield* Effect.die(new Error("Expected a runnable environment"))
  host.reset = () => {
    recoverable = false
    environment.runner.clearCache()
  }
  host.recover = () => {
    if (!recoverable) return false
    recoverable = false
    queueMicrotask(() => {
      input.log?.("warn", "TUI hot update failed; reloading", {})
      environment.moduleGraph.invalidateAll()
      environment.hot.send({ type: "full-reload" })
    })
    return true
  }
  yield* Effect.promise(() =>
    environment.runner.import(path.join(import.meta.dirname, "entry.ts")).catch(console.error),
  )
  const exit = yield* Effect.promise(() => finished.promise)
  if (Exit.isFailure(exit)) return yield* Effect.failCause(exit.cause)
}, Effect.scoped)
