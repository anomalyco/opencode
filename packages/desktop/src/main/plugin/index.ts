export * as Plugins from "./index"

import { app } from "electron"
import { Context, Effect, Layer } from "effect"
import type { PluginEndpoint } from "../../shared/ipc-rpc/plugins"
import { ApplicationLifecycle } from "../lifecycle"
import { Shutdown } from "../lifecycle/shutdown"

const LEVELS = { debug: "Debug", info: "Info", warn: "Warn", error: "Error" } as const

import { DesktopCli } from "../service/desktop-cli"
import { DesktopStorage } from "../storage"
import type { PluginHost } from "./host"
import { createDriver, loadedHost } from "./machine"

export interface Interface {
  /** Loads the host on first use, and again after a load failed. Main plugins activate only through `start`. */
  readonly host: () => Promise<PluginHost>
  /** The host when something already loaded it. */
  readonly loaded: () => PluginHost | undefined
  /** Loads the host and activates main plugins. Runs once the first window is up. */
  readonly start: Effect.Effect<void>
  /** Starts state sync for a window. Before the host loads, nothing is available yet. */
  readonly subscribe: (ipc: string, window: number) => { readonly available: boolean; readonly state?: unknown }
  readonly configure: (window: number, servers: readonly PluginEndpoint[]) => void
}

export class Service extends Context.Service<Service, Interface>()("opencode/desktop/Plugins") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const storage = yield* DesktopStorage.Service
    const shutdown = yield* Shutdown.Service
    const lifecycle = yield* ApplicationLifecycle.Service
    const desktopCli = yield* DesktopCli.Service
    const context = yield* Effect.context()
    const runFork = Effect.runForkWith(context)
    const runPromise = Effect.runPromiseWith(context)
    // Renderers subscribe and push servers while they boot, which can be before the host loads.
    const subscriptions = new Map<string, Set<number>>()
    const servers = new Map<number, readonly PluginEndpoint[]>()

    const driver = createDriver({
      load: async () => {
        const [module, cli] = await Promise.all([import("./host"), runPromise(desktopCli.resolve)])

        return () =>
          module.createHost({
            db: storage.db,
            state: storage.state,
            cli: {
              version: cli.version,
              command: cli.command,
              binary: cli.binary,
              development: !app.isPackaged && !cli.binary,
            },
            subscriptions,
            servers,
            appState: lifecycle.state,
            restart: lifecycle.restart,
            log: (message, data) => runFork(Effect.logError(message, data)),
            write: (level, message, data) => runFork(Effect.logWithLevel(LEVELS[level])(message, data)),
          })
      },
      subscribed: () => [...subscriptions].flatMap((entry) => (entry[1].size ? [entry[0]] : [])),
      log: (message, data) => runFork(Effect.logError(message, data)),
    })

    const remove = yield* shutdown.add({
      stop: Effect.promise(driver.stop),
      resume: Effect.tryPromise(driver.resume).pipe(
        Effect.catch((error) => Effect.logError("plugins failed to resume", { error })),
      ),
    })

    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        remove()
        driver.dispose()
      }),
    )

    return Service.of({
      host: driver.host,
      loaded: () => loadedHost(driver.state()),
      start: Effect.tryPromise(driver.start).pipe(
        Effect.catch((error) => Effect.logError("plugins failed to start", { error })),
      ),
      subscribe(ipc, window) {
        const ids = subscriptions.get(ipc) ?? new Set()
        ids.add(window)
        subscriptions.set(ipc, ids)
        // A booting window waits on some Ipcs (e.g. server sources) before its first paint, so the
        // plugin that provides one starts now instead of with the deferred rest.
        driver.demand(ipc)

        return loadedHost(driver.state())?.snapshot(ipc, window) ?? { available: false }
      },
      configure(window, list) {
        // Re-inserting keeps the most recent window last, which resolution prefers.
        servers.delete(window)
        servers.set(window, list)
      },
    })
  }),
)
