import { BrowserWindow } from "electron"
import { Effect } from "effect"
import { PluginRpcs } from "../../shared/ipc-rpc"
import { pluginFailure } from "../plugin/error"
import type { PluginHost } from "../plugin/host"
import { Plugins } from "../plugin"
import { IpcPortHandoff } from "../ipc-transport"
import { isRendererUrl } from "../windows/scheme"
import { sender, type RpcContext } from "./context"

export const pluginHandlers = PluginRpcs.toLayer(
  Effect.gen(function* () {
    const handoff = yield* IpcPortHandoff
    const plugins = yield* Plugins.Service

    // Ipcs scope state and events by the calling app window.
    const caller = (context: RpcContext) => {
      const contents = sender(handoff, context)
      const win = BrowserWindow.fromWebContents(contents)

      if (!win || win.isDestroyed() || win.webContents !== contents || !isRendererUrl(contents.getURL()))
        throw new Error("plugin.caller.invalid")

      return win.id
    }

    // The manager enables, disables and reloads plugins.
    const manage = <A>(run: (host: PluginHost) => A | Promise<A>) =>
      Effect.tryPromise({
        try: () => plugins.host().then(run),
        catch: pluginFailure,
      })

    return PluginRpcs.of({
      PluginCall: (request, context) =>
        Effect.tryPromise({
          try: (signal) => plugins.host().then((host) => host.call(request, { window: caller(context), signal })),
          catch: pluginFailure,
        }),
      PluginSubscribe: ({ ipc }, context) => Effect.sync(() => plugins.subscribe(ipc, caller(context))),
      PluginEmbed: ({ id, layout }, context) => Effect.sync(() => plugins.loaded()?.embed(caller(context), id, layout)),
      PluginCapture: ({ id }, context) =>
        Effect.promise(async () => (await plugins.loaded()?.capture(caller(context), id)) ?? null),
      PluginMenubarItem: ({ id }, context) => Effect.sync(() => plugins.loaded()?.runMenubarItem(caller(context), id)),
      PluginMenubarItems: () => Effect.sync(() => plugins.loaded()?.listMenubarItems() ?? []),
      PluginConfigure: ({ servers }, context) => Effect.sync(() => plugins.configure(caller(context), servers)),
      PluginGuis: () => Effect.promise(() => plugins.host().then((host) => host.pluginGuis())),
      PluginList: () => Effect.promise(() => plugins.host().then((host) => host.list())),
      PluginEnable: ({ id }) => manage((host) => host.enable(id)),
      PluginDisable: ({ id }) => manage((host) => host.disable(id)),
      PluginReload: ({ id }) => manage((host) => host.reload(id)),
    })
  }),
)
