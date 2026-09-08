import { BrowserWindow, net } from "electron"
import { Effect } from "effect"
import { EventRpcs } from "../../shared/ipc-rpc"
import { ipcEventStream } from "../ipc-events"
import { IpcPortHandoff } from "../ipc-transport"
import { Shutdown } from "../lifecycle/shutdown"
import { isRendererUrl } from "../windows/protocol"
import { sender } from "./context"
import { createMainExtensionHost } from "../extensions/host"
import { mainExtensions } from "../extensions/builtins"
import { emitIpcEvent } from "../ipc-events"
import { ExtensionEvent } from "../../shared/ipc-rpc/events"
import { ExtensionsChanged } from "../../shared/ipc-rpc/events"
import { ExtensionManagerRpcs } from "../../shared/ipc-rpc/extension-manager"
import { ExtensionManager } from "@opencode/plugin/desktop/manager"
import { DesktopStorage } from "../storage"
import { createExtensionManager } from "../extensions/manager"
import { loadMainPlugin } from "../extensions/module"

const rpcs = EventRpcs.merge(ExtensionManagerRpcs)
export const eventHandlers = rpcs.toLayer(
  Effect.gen(function* () {
    const handoff = yield* IpcPortHandoff
    const shutdown = yield* Shutdown.Service
    const storage = yield* DesktopStorage.Service
    const extensions = createMainExtensionHost(
      mainExtensions,
      (win, event) => emitIpcEvent(win.webContents, new ExtensionEvent({ event })),
      (id) => loadMainPlugin(manager, id),
    )
    const manager = createExtensionManager({
      db: storage.db,
      fetch: net.fetch,
      reserved: mainExtensions.map((plugin) => plugin.id),
      changed(id, entries) {
        extensions.releaseAll(id)
        BrowserWindow.getAllWindows().forEach((win) => {
          if (!win.isDestroyed() && isRendererUrl(win.webContents.getURL()))
            emitIpcEvent(win.webContents, new ExtensionsChanged({ entries }))
        })
      },
    })
    const authorized = (context: Parameters<typeof sender>[1]) => {
      const contents = sender(handoff, context)
      const win = BrowserWindow.fromWebContents(contents)
      if (!win || win.isDestroyed() || win.webContents !== contents || !isRendererUrl(contents.getURL()))
        throw new ExtensionManager.ManagerError("notFound")
    }
    const operation = <Value>(context: Parameters<typeof sender>[1], run: () => Value | Promise<Value>) =>
      Effect.tryPromise(async () => {
        try {
          authorized(context)
          return { ok: true as const, entries: await run() }
        } catch (error) {
          return {
            ok: false as const,
            error: { code: error instanceof ExtensionManager.ManagerError ? error.code : ("storage" as const) },
          }
        }
      }).pipe(Effect.orDie)
    const stop = Effect.promise(() => extensions.dispose())
    const remove = yield* shutdown.add(stop)
    yield* Effect.addFinalizer(() => Effect.sync(remove).pipe(Effect.andThen(stop)))
    return rpcs.of({
      ExtensionManagerList: (_request, context) =>
        Effect.sync(() => {
          authorized(context)
          return manager.list()
        }),
      ExtensionManagerInstall: ({ data }, context) => operation(context, () => manager.install(data)),
      ExtensionManagerInstallURL: ({ url }, context) => operation(context, () => manager.installURL(url)),
      ExtensionManagerEnable: ({ id, enabled }, context) => operation(context, () => manager.enable(id, enabled)),
      ExtensionManagerReload: ({ id }, context) => operation(context, () => manager.reload(id)),
      ExtensionManagerSource: ({ id, revision }, context) =>
        Effect.sync(() => {
          try {
            authorized(context)
            return { ok: true as const, value: manager.source(id, revision) }
          } catch (error) {
            return {
              ok: false as const,
              error: { code: error instanceof ExtensionManager.ManagerError ? error.code : ("storage" as const) },
            }
          }
        }),
      DesktopExtension: ({ request }, context) =>
        Effect.tryPromise(async () => {
          const contents = sender(handoff, context)
          const win = BrowserWindow.fromWebContents(contents)
          if (!win || win.isDestroyed() || win.webContents !== contents || !isRendererUrl(contents.getURL()))
            throw new Error("Desktop extension owner is unavailable")
          if (request.type === "call") return extensions.call(win, request.call)
          if (request.type === "cancel") extensions.cancel(win, request.extensionID, request.requestID)
          if (request.type === "servers") extensions.configure(win, request.servers)
          if (request.type === "surface")
            extensions.surface(win, request.extensionID, request.surfaceID, request.layout)
          if (request.type === "release") extensions.release(win, request.extensionID)
          return null
        }).pipe(Effect.orDie),
      DesktopEvents: (_request, context) => ipcEventStream(sender(handoff, context).id),
    })
  }),
)
