import { createMemo, createSignal, lazy, onCleanup, Show, Suspense, type ParentProps } from "solid-js"
import { runsOn, type Bridge, type Entry } from "@opencode/plugin/gui/host"
import { builtins } from "./builtins"
import { PluginGuiLoader, type PluginGui } from "./plugins"
import { createMenubarItems, MenubarItemsProvider } from "./menubar-items"
import { usePlatform } from "@/runtime/platform/platform"
import { PluginHostProvider, usePluginHost } from "./host"
import { createIpcClients } from "./ipc"
import { createPluginAttachment, createHostApis, PluginAttachmentProvider, type HostApis } from "./host-apis"
import { PluginCommands } from "./commands"
import { PluginStyles, PluginThemes } from "./render"
import { PluginServersProvider } from "./servers"
import { PluginServerEndpoints } from "./server-shell"
import { createContext, useContext } from "solid-js"

const HostApisContext = createContext<HostApis>()

// Desktop only: a window loads the plugin GUIs main sends.
const PluginsContext = createContext<{
  bridge: Bridge
  set: (plugins: readonly PluginGui[], reserved: readonly string[]) => void
  reserved: () => readonly string[]
}>()

const PluginHotReload = import.meta.env.DEV ? lazy(() => import("./hmr")) : undefined

/** The ids of plugins on the app's own server whose GUI cannot load because a built-in plugin claims the id. */
export function useReservedPlugins() {
  const plugins = useContext(PluginsContext)

  return () => plugins?.reserved() ?? []
}

export function useHostApis() {
  const value = useContext(HostApisContext)

  if (!value) throw new Error("Host APIs are unavailable")

  return value
}

/** Mounts the plugin host for the window. Lives above the app interface so plugins can contribute servers. */
export function PluginRoot(props: ParentProps) {
  const platform = usePlatform()
  const apis = createHostApis()
  const bridge = platform.plugins
  const menubar = createMenubarItems(bridge)
  const ipcs = createIpcClients(bridge)
  onCleanup(ipcs.dispose)

  const os = platform.platform === "desktop" ? platform.os : undefined

  const localBuiltins = builtins.filter((definition) => runsOn(definition, os))

  // The GUIs of the plugins on the app's own server, as main sends them, and the plugins whose GUI cannot load because a
  // built-in claims the id, which Extensions › Plugins shows. Settled once the loader first publishes, even empty after
  // a failure. The web runs built-ins only.
  const [loaded, setLoaded] = createSignal<{
    settled: boolean
    plugins: readonly PluginGui[]
    reserved: readonly string[]
  }>({ settled: !bridge, plugins: [], reserved: [] })

  // The same definitions in the same order are no change, so a refetch that found nothing new restarts nothing.
  const definitions = createMemo<readonly Entry[]>(
    () => [...localBuiltins, ...loaded().plugins.map((plugin) => plugin.definition)],
    [],
    {
      equals: (a, b) => a.length === b.length && a.every((definition, index) => definition === b[index]),
    },
  )

  const builtinIds = new Set(builtins.map((builtin) => builtin.id))

  return (
    <HostApisContext.Provider value={apis}>
      <PluginsContext.Provider
        value={
          bridge && {
            bridge,
            set: (plugins, reserved) => setLoaded({ settled: true, plugins, reserved }),
            reserved: () => loaded().reserved,
          }
        }
      >
        <PluginHostProvider
          definitions={definitions}
          bridge={bridge}
          builtins={builtinIds}
          servers
          apis={apis.apis}
          whenMounted={apis.whenMounted}
          ipc={bridge ? (token) => ipcs.client(token) : undefined}
          plugin={(id) => loaded().plugins.find((plugin) => plugin.definition.id === id)}
          generation={ipcs.generation}
          ipcFailed={ipcs.failed}
        >
          <PluginStyles />
          <PluginThemes loaded={() => loaded().settled} />
          {PluginHotReload && (
            <Suspense>
              <PluginHotReload />
            </Suspense>
          )}
          <MenubarItemsProvider value={menubar}>
            <PluginServersProvider>{props.children}</PluginServersProvider>
          </MenubarItemsProvider>
        </PluginHostProvider>
      </PluginsContext.Provider>
    </HostApisContext.Provider>
  )
}

/** Attaches the session and layout HostApis and publishes plugin commands. Renders once plugins are active. */
export function PluginAttachment(props: ParentProps) {
  const host = usePluginHost()
  const attachment = createPluginAttachment(useHostApis())
  const plugins = useContext(PluginsContext)

  return (
    <PluginAttachmentProvider value={attachment}>
      <PluginCommands />
      <PluginServerEndpoints />
      <Show when={plugins}>{(value) => <PluginGuiLoader bridge={value().bridge} onChange={value().set} />}</Show>
      <Show when={host.ready()}>
        <MountedInterface attach={attachment.attach} />
        {props.children}
      </Show>
    </PluginAttachmentProvider>
  )
}

/**
 * The app interface as the HostApis see it, mounted as the routes first render and not before: writes and dialogs made
 * while plugins set up wait until then.
 */
function MountedInterface(props: { attach: () => () => void }) {
  onCleanup(props.attach())

  return null
}
