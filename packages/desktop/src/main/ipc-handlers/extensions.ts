import { app, BrowserWindow } from "electron"
import { Effect } from "effect"
import { ExtensionRpcs } from "../../shared/ipc-rpc"
import { ExtensionError, extensionFailure } from "../extension/error"
import type { ExtensionHost } from "../extension/host"
import { Extensions } from "../extension"
import { IpcPortHandoff } from "../ipc-transport"
import { isRendererUrl } from "../windows/scheme"
import { sender, type RpcContext } from "./context"

export const extensionHandlers = ExtensionRpcs.toLayer(
  Effect.gen(function* () {
    const handoff = yield* IpcPortHandoff
    const extensions = yield* Extensions.Service

    // Ipcs scope state and events by the calling app window.
    const caller = (context: RpcContext) => {
      const contents = sender(handoff, context)
      const win = BrowserWindow.fromWebContents(contents)

      if (!win || win.isDestroyed() || win.webContents !== contents || !isRendererUrl(contents.getURL()))
        throw new Error("extension.caller.invalid")

      return win.id
    }

    // The manager (enable, reload, install archives) is a development tool until installed extensions have a trust
    // model; packaged builds refuse it so no renderer can install and run main-process code.
    const manage = <A>(run: (host: ExtensionHost) => A | Promise<A>) =>
      Effect.tryPromise({
        try: () => {
          if (app.isPackaged) throw new ExtensionError("unavailable")

          return extensions.host().then(run)
        },
        catch: extensionFailure,
      })

    return ExtensionRpcs.of({
      ExtensionCall: (request, context) =>
        Effect.tryPromise({
          try: (signal) => extensions.host().then((host) => host.call(request, { window: caller(context), signal })),
          catch: extensionFailure,
        }),
      ExtensionSubscribe: ({ ipc }, context) => Effect.sync(() => extensions.subscribe(ipc, caller(context))),
      ExtensionEmbed: ({ id, layout }, context) =>
        Effect.sync(() => extensions.loaded()?.embed(caller(context), id, layout)),
      ExtensionCapture: ({ id }, context) =>
        Effect.promise(async () => (await extensions.loaded()?.capture(caller(context), id)) ?? null),
      ExtensionMenubarItem: ({ id }, context) =>
        Effect.sync(() => extensions.loaded()?.runMenubarItem(caller(context), id)),
      ExtensionMenubarItems: () => Effect.sync(() => extensions.loaded()?.listMenubarItems() ?? []),
      ExtensionConfigure: ({ servers }, context) => Effect.sync(() => extensions.configure(caller(context), servers)),
      ExtensionList: () => Effect.promise(() => extensions.host().then((host) => host.list())),
      ExtensionEnable: ({ id }) => manage((host) => host.enable(id)),
      ExtensionDisable: ({ id }) => manage((host) => host.disable(id)),
      ExtensionReload: ({ id }) => manage((host) => host.reload(id)),
      ExtensionInstall: ({ source }) => manage((host) => host.install(source)),
      ExtensionRemove: ({ id }) => manage((host) => host.remove(id)),
      ExtensionSource: ({ id }) => manage((host) => host.source(id)),
    })
  }),
)
