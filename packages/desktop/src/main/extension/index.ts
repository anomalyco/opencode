export * as Extensions from "./index"

import { app } from "electron"
import { Context, Effect, Layer } from "effect"
import type { ExtensionEndpoint } from "../../shared/ipc-rpc/extensions"
import { ApplicationLifecycle } from "../lifecycle"
import { Shutdown } from "../lifecycle/shutdown"

const LEVELS = { debug: "Debug", info: "Info", warn: "Warn", error: "Error" } as const

import { DesktopCli } from "../service/desktop-cli"
import { DesktopStorage } from "../storage"
import { setAppQuitting } from "../windows"
import { setExtensionAssets } from "../windows/protocol"
import { extensionAsset } from "./assets"
import type { ExtensionHost } from "./host"

/** The host once it loaded, and its load while one is in flight. */
type LoadedHost = { host?: ExtensionHost; loading?: Promise<ExtensionHost> }

export interface Interface {
  /** Loads the host on first use. Main extensions activate only through `start`. */
  readonly host: () => Promise<ExtensionHost>
  /** The host when something already loaded it. */
  readonly loaded: () => ExtensionHost | undefined
  /** Loads the host and activates main extensions. Runs once the first window is up. */
  readonly start: Effect.Effect<void>
  /** Starts state sync for a window. Before the host loads, nothing is available yet. */
  readonly subscribe: (ipc: string, window: number) => { readonly available: boolean; readonly state?: unknown }
  readonly configure: (window: number, servers: readonly ExtensionEndpoint[]) => void
}

export class Service extends Context.Service<Service, Interface>()("opencode/desktop/Extensions") {}

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
    const servers = new Map<number, readonly ExtensionEndpoint[]>()
    const current: LoadedHost = {}

    setExtensionAssets((request, url) => extensionAsset(storage.db, request, url))

    // Disposes every extension but the caller (the host keeps it), then hands off (e.g. quitAndInstall) or relaunches.
    const restart = async (handoff?: () => void | Promise<void>) => {
      setAppQuitting()
      await runPromise(lifecycle.prepareToRestart)

      if (!handoff) {
        app.relaunch()
        app.quit()

        return
      }

      await Promise.resolve()
        .then(handoff)
        .catch((cause: unknown) => {
          setAppQuitting(false)
          throw cause
        })
    }

    const host = () => {
      current.loading ??= Promise.all([import("./host"), runPromise(desktopCli.resolve)]).then(([module, cli]) => {
        current.host = module.createHost({
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
          restart,
          log: (message, data) => runFork(Effect.logError(message, data)),
          write: (level, message, data) => runFork(Effect.logWithLevel(LEVELS[level])(message, data)),
        })

        return current.host
      })

      return current.loading
    }

    const stop = Effect.promise(async () => {
      if (current.loading)
        await current.loading.then(
          (loaded) => loaded.dispose(),
          () => undefined,
        )
    })

    const remove = yield* shutdown.add(stop)
    yield* Effect.addFinalizer(() => Effect.sync(remove))

    return Service.of({
      host,
      loaded: () => current.host,
      start: Effect.tryPromise(() => host().then((loaded) => loaded.start())).pipe(
        Effect.catch((error) => Effect.logError("extensions failed to start", { error })),
      ),
      subscribe(ipc, window) {
        const ids = subscriptions.get(ipc) ?? new Set()
        ids.add(window)
        subscriptions.set(ipc, ids)
        // A booting window waits on some Ipcs (e.g. server sources) before its first paint, so the
        // extension that provides one starts now instead of with the deferred rest.
        void host().then(
          (loaded) => loaded.demand(ipc),
          () => undefined,
        )

        return current.host?.snapshot(ipc, window) ?? { available: false }
      },
      configure(window, list) {
        // Re-inserting keeps the most recent window last, which resolution prefers.
        servers.delete(window)
        servers.set(window, list)
      },
    })
  }),
)
