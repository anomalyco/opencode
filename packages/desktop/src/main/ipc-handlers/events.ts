import { BrowserWindow } from "electron"
import { Effect } from "effect"
import { EventRpcs } from "../../shared/ipc-rpc"
import { ipcEventStream } from "../ipc-events"
import { IpcPortHandoff } from "../ipc-transport"
import { Shutdown } from "../lifecycle/shutdown"
import { isRendererUrl } from "../windows/scheme"
import { DesktopStorage } from "../storage"
import { sender, type RpcContext } from "./context"

export const eventHandlers = EventRpcs.toLayer(
  Effect.gen(function* () {
    const handoff = yield* IpcPortHandoff
    const shutdown = yield* Shutdown.Service
    const storage = yield* DesktopStorage.Service
    // The browser pane brings the CDP driver and the full RPC client with every protocol schema;
    // load it when a renderer first opens a pane instead of at startup.
    const load = async () => {
      const { createBrowserPane } = await import("../browser-pane")
      return createBrowserPane(storage.state)
    }
    let browser: ReturnType<typeof load> | undefined
    const stop = Effect.promise(async () => {
      if (browser) await (await browser).dispose()
    })
    const remove = yield* shutdown.add(stop)
    yield* Effect.addFinalizer(() => Effect.sync(remove).pipe(Effect.andThen(stop)))
    const owner = async (context: RpcContext) => {
      const contents = sender(handoff, context)
      const win = BrowserWindow.fromWebContents(contents)
      if (!win || win.isDestroyed() || win.webContents !== contents || !isRendererUrl(contents.getURL())) {
        throw new Error("browser.pane.owner.invalid")
      }
      browser ??= load()
      return { win, pane: await browser }
    }
    return EventRpcs.of({
      DesktopEvents: (_request, context) => ipcEventStream(sender(handoff, context).id),
      BrowserPane: ({ request }, context) =>
        Effect.tryPromise(async () => {
          const target = await owner(context)
          if (request.type === "register") return target.pane.register(target.win, request.bindingID, request.target)
          if (request.type === "layout") return target.pane.layout(target.win, request.bindingID, request.layout)
          if (request.type === "command") return target.pane.command(target.win, request.bindingID, request.command)
          return target.pane.close(target.win, request.bindingID)
        }).pipe(Effect.orDie),
      BrowserPaneCapture: (request, context) =>
        Effect.tryPromise(async () => {
          const target = await owner(context)
          return target.pane.capture(target.win, request.bindingID, request.tabID)
        }).pipe(Effect.orDie),
    })
  }),
)
