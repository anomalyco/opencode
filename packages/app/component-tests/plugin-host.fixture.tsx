import type { PluginInfo, SessionMessageInfo } from "@opencode/client/promise"
import { DialogProvider } from "@opencode/ui/context/dialog"
import { Toast } from "@opencode/ui/toast"
import {
  Panel,
  type Appearance,
  type App,
  type Keybinds,
  type MountedSession,
  type Router,
  type Servers,
  type SessionScreen,
  type Ipc,
  type IpcClient,
  type IpcSpec,
  type Plugin,
  type Storage,
  type StoreOptions,
  type Workspaces,
} from "@opencode/plugin/gui"
import type { BuiltinLayout, BuiltinLocale } from "@opencode/plugin/gui/builtin"
import {
  createComponent,
  createMemo,
  createSignal,
  getOwner,
  onCleanup,
  runWithOwner,
  Show,
  type ParentProps,
} from "solid-js"
import { createStore, produce } from "solid-js/store"
import { Schema } from "effect"
import { render } from "solid-js/web"
import { PlatformProvider, type Platform } from "@/runtime/platform/platform"
import { Persist, persisted } from "@/runtime/persistence/storage"
import { ServerScope } from "@/runtime/server/scope"
import { PluginHostProvider, usePluginHost, type HostApiFactories } from "../src/runtime/plugin/host"
import { createHostApis } from "../src/runtime/plugin/host-apis"
import { createInstalled } from "../src/runtime/plugin/installed"
import { pluginEnabled, type Entry } from "@opencode/plugin/gui/host"
import { createRegion, RegionContent } from "../src/runtime/plugin/panels"
import { createClosedTabs } from "../src/runtime/plugin/closed-tabs"
import { PluginSlot } from "../src/runtime/plugin/render"
import { persistedHandle } from "../src/runtime/plugin/stores"
import { LanguageProvider } from "../src/runtime/i18n/language"
import { ExtensionPlugins } from "../src/runtime/plugin/extension-plugins"
import { SessionPluginPills } from "../src/session/composer/plugin-pills"
import { ui } from "../src/runtime/plugin/ui"

export {
  bindPlugin,
  usePlugin,
  ComposerPill,
  Contract,
  createKeyed,
  Ipc,
  Panel,
  Slot,
  Store,
} from "@opencode/plugin/gui"

export { Schema }

type PluginHost = ReturnType<typeof usePluginHost>

/** What the app interface hands the real host APIs when it mounts. */
type Interface = Parameters<ReturnType<typeof createHostApis>["attach"]>[0]

/** The host APIs a mounted fixture created, once it rendered. */
type Captured = { apis?: ReturnType<typeof createHostApis> }

/** A value the fixture's storage holds as JSON. */
type Json = string | number | boolean | null | readonly Json[] | { readonly [key: string]: Json }

export { createComponent, createMemo, createSignal, getOwner, onCleanup, runWithOwner }

const layout: BuiltinLayout = {
  narrow: () => false,
  ready: () => true,
  open() {},
  close() {},
  toggle() {},
  hide() {},
  state: () => "closed",
  stored: () => [],
  side: { opened: () => false, toggle() {}, menu: () => [] },
  sidebar: { opened: () => true },
  scroll: { get: () => undefined, set() {} },
  settings() {},
  project() {},
  draft() {},
  command() {},
}

const about: App = { name: "opencode", version: "", channel: "dev", platform: "desktop", packaged: false }

const locale: BuiltinLocale = { locale: () => "en", direction: () => "ltr", setDirection() {} }

const appearance: Appearance = { font: () => "monospace", mode: () => "light" }

const router: Router = { routing: () => false, path: () => "/" }

const keybinds: Keybinds = { keybind: () => [], keys: (bind) => bind.split("+"), matches: () => false }

const servers: Servers = { list: () => [], get: () => undefined }

const workspaces: Workspaces = { on: () => () => undefined }

/** Every HostApi faked at its boundary, with the given storage; `ui` is the app's own components, which have none. */
function fakeApis(storage: (plugin: string) => Storage): HostApiFactories {
  return {
    app: () => about,
    locale: () => locale,
    appearance: () => appearance,
    router: () => router,
    keybinds: () => keybinds,
    servers: () => servers,
    workspaces: () => workspaces,
    desktop: () => undefined,
    sessions: () => ({ list: () => [], current: () => undefined }),
    screen: () => ({ current: () => undefined }),
    layout: () => layout,
    storage,
    system: () => ({ copy: async () => {}, save: async () => false, openExternal() {} }),
    embeds: () => ({ View: () => null, capture: async () => undefined }),
    toast: () => ({ show: () => ({ dismiss() {} }) }),
    tabs: () => ({ list: () => [], open() {}, focus() {}, move() {}, close() {} }),
    attention: () => ({ notify: async () => ({ notification: false, sound: false }) }),
    commands: () => ({ run: () => false }),
    ui: () => ui,
  }
}

/** The fake HostApis' app interface, which is always mounted: a dialog shows at once. */
function mounted(run: () => void) {
  run()

  return () => undefined
}

/** Storage that no test of `mountPluginHost` reads. */
const unused = (): Storage => {
  throw new Error("The fixture plugin reads no storage")
}

/** Resolves once `check` holds, checking every frame; rejects after five seconds. */
export async function until(check: () => boolean) {
  const deadline = performance.now() + 5000

  while (!check()) {
    if (performance.now() > deadline) throw new Error("The fixture never reached the expected state")
    await new Promise((resolve) => requestAnimationFrame(resolve))
  }
}

/** Mounts the real plugin host with one plugin whose every renderer load settles when the test says so. */
export function mountPluginHost() {
  const loads: PromiseWithResolvers<{ default: Plugin.Setup<Entry> }>[] = []
  const [disabled, setDisabled] = createSignal<ReadonlySet<string>>(new Set())
  const hosts: PluginHost[] = []
  const container = document.createElement("div")
  document.body.appendChild(container)

  function Capture() {
    hosts.push(usePluginHost())

    return null
  }

  const dispose = render(
    () => (
      <LanguageProvider locale="en">
        <DialogProvider>
          <PluginHostProvider
            definitions={() => [
              {
                id: "fixture",
                windowEntry: () => {
                  const load = Promise.withResolvers<{ default: Plugin.Setup<Entry> }>()
                  loads.push(load)

                  return load.promise
                },
              },
            ]}
            disabled={disabled}
            apis={fakeApis(unused)}
            whenMounted={mounted}
          >
            <Capture />
          </PluginHostProvider>
        </DialogProvider>
      </LanguageProvider>
    ),
    container,
  )

  return {
    unmount: () => {
      dispose()
      container.remove()
    },
    /** Resolves the nth renderer load (the first by default) with this setup. */
    load: (setup: Plugin.Setup<Entry>, index = 0) => loads[index].resolve({ default: setup }),
    /** Rejects the nth renderer load. */
    fail: (index: number, cause: unknown) => loads[index].reject(cause),
    /** Renderer loads requested so far. */
    count: () => loads.length,
    reload: () => hosts[0]?.reload("fixture"),
    disable: () => setDisabled(new Set(["fixture"])),
    enable: () => setDisabled(new Set<string>()),
    status: () => hosts[0]?.state.status.fixture,
    /** Contributions the host holds for a registry; readable after the host unmounts. */
    entries: (registry: string) => hosts[0]?.state.entries[registry]?.length ?? 0,
  }
}

/**
 * Mounts the real host over these definitions, before any session mounts, with the HostApis faked at their
 * boundary. Storage is the real persisted store of a desktop window whose reads wait until `release()`; `stored` seeds
 * it. Renders the `window.bottom` slot once the startup gate opens.
 */
export function mountPlugins(input: {
  definitions: readonly Entry[]
  disabled?: readonly string[]
  bridge?: Parameters<typeof createInstalled>[0]
  stored?: Readonly<Record<string, Json>>
  /** Shows the production Extensions › Plugins rows of the desktop app's own server, which lists these plugins. */
  plugins?: readonly PluginInfo[]
  /** The client of an Ipc while main provides it, as a desktop window's bridge reports it. Omitted: the web. */
  ipc?: (token: Ipc) => IpcClient<IpcSpec> | undefined
}) {
  const held = Promise.withResolvers<void>()
  const saved = { ...input.stored }
  const [disabled, setDisabled] = createSignal<ReadonlySet<string>>(new Set(input.disabled ?? []))
  const [definitions, setDefinitions] = createSignal(input.definitions)
  const hosts: PluginHost[] = []
  const container = document.createElement("div")
  document.body.appendChild(container)

  const platform: Platform = {
    platform: "desktop",
    plugins: input.bridge,
    windowID: "plugin-host-fixture",
    openExternal: () => undefined,
    openDirectoryPickerDialog: async () => null,
    restart: async () => undefined,
    notify: async () => undefined,
    storage: () => ({
      getItem: async (key: string) => {
        await held.promise

        return key in saved ? JSON.stringify(saved[key]) : null
      },
      setItem: async (key: string, value: string) => {
        saved[key] = JSON.parse(value)
      },
      removeItem: async () => undefined,
    }),
  }

  const storage = (plugin: string): Storage => ({
    store<S extends Schema.ConstraintCodec<object, unknown>>(key: string, options: StoreOptions<S>) {
      const pair = persisted(Persist.global(`plugin.${plugin}.${key}`), options.schema, options.initial, platform)

      return persistedHandle({ store: pair[0], set: pair[1], init: pair[3].promise })
    },
    memory: (_key, options) => {
      const [value, set] = createStore(options.initial)

      return [value, (mutation) => set(produce(mutation))] as const
    },
    remove() {},
  })

  function MountedHost() {
    const installed = input.bridge ? createInstalled(input.bridge) : undefined

    const disabledState = createMemo(() => {
      if (!installed) return disabled()

      const state = installed.enableState()

      if (!state) return undefined

      return new Set(
        definitions().flatMap((definition) =>
          pluginEnabled({ id: definition.id, builtin: false }, state) ? [] : [definition.id],
        ),
      )
    })

    return (
      <PluginHostProvider
        definitions={definitions}
        disabled={disabledState}
        apis={fakeApis(storage)}
        whenMounted={mounted}
        ipc={input.ipc}
      >
        <Capture />
      </PluginHostProvider>
    )
  }

  function Capture() {
    const host = usePluginHost()
    hosts.push(host)

    return (
      <Show when={host.ready()}>
        <Show when={input.plugins}>
          {(plugins) => (
            <div data-testid="extension-plugins">
              <ExtensionPlugins plugins={plugins()} own />
            </div>
          )}
        </Show>
        <PluginSlot at="window.bottom" input={{}} />
      </Show>
    )
  }

  const dispose = render(
    () => (
      <PlatformProvider value={platform}>
        <LanguageProvider locale="en">
          <DialogProvider>
            <MountedHost />
          </DialogProvider>
        </LanguageProvider>
      </PlatformProvider>
    ),
    container,
  )

  return {
    container,
    unmount: () => {
      dispose()
      container.remove()
    },
    /** What the window has written to storage, seeded with `stored`. */
    saved: () => ({ ...saved }),
    /** Lets the held storage reads answer. */
    release: () => held.resolve(),
    disable: (ids: readonly string[]) => setDisabled(new Set(ids)),
    /** Replaces the definitions, as plugin GUIs join, reload and leave. */
    define: (next: readonly Entry[]) => setDefinitions(next),
    reload: (id: string) => hosts[0]?.reload(id),
    ready: () => hosts[0]?.ready() ?? false,
    status: (id: string) => hosts[0]?.state.status[id],
    failure: (id: string) => hosts[0]?.state.failures[id],
    entries: (registry: string) => hosts[0]?.state.entries[registry]?.length ?? 0,
  }
}

const web: Platform = {
  platform: "web",
  openExternal: () => undefined,
  restart: async () => undefined,
  notify: async () => undefined,
}

/** A stand-in for the app interface the real host APIs attach to; each test overrides what it observes. */
function standIn(overrides: Partial<Interface>): Interface {
  return {
    sessions: () => [],
    current: () => undefined,
    tabs: { list: () => [], open() {}, focus() {}, move() {}, close() {} },
    screen: () => undefined,
    scope: () => ServerScope.local,
    scoped: () => undefined,
    layout: {
      ready: () => true,
      open() {},
      close() {},
      toggle() {},
      hide() {},
      state: () => "closed",
      stored: () => [],
      side: { opened: () => true, toggle() {}, menu: () => [] },
      sidebar: { opened: () => false },
      scroll: { get: () => undefined, set() {} },
    },
    settings() {},
    project() {},
    draft() {},
    command() {},
    run: () => false,
    notify: async () => ({ notification: false, sound: false }),
    font: () => "fixture mono",
    mode: () => "dark",
    routing: () => false,
    path: () => "/",
    keybind: () => [],
    matches: () => false,
    servers: () => ["local"],
    server: () => undefined,
    ...overrides,
  }
}

/** The real host over the real HostApis of a web window; `mounted`, when given, attaches as the app interface. */
function RealHost(props: ParentProps<{ definitions: readonly Entry[]; captured: Captured; mounted?: Interface }>) {
  const apis = createHostApis()
  props.captured.apis = apis

  if (props.mounted) onCleanup(apis.attach(props.mounted))

  return (
    <PluginHostProvider
      definitions={() => props.definitions}
      disabled={() => new Set<string>()}
      apis={apis.apis}
      whenMounted={apis.whenMounted}
    >
      {props.children}
    </PluginHostProvider>
  )
}

/**
 * Mounts the real host and HostApis, and the parts of the session screen that render plugin content for the routed
 * session: the side region (`createRegion`, `RegionContent`) with every panel's tabs stored, and the
 * `session.panel.end` slot, whose input the screen builds this way. `route(id)` routes a session the way the screen
 * does: a new session object each time, delivered through the same reactive inputs, while the one screen object
 * `ctx.screen` returns follows the route. Its composer records which session each attachment reached.
 */
export function mountSessionRegion(input: {
  definitions: readonly Entry[]
  active: string
  /** The routed session's messages, as its server holds them. */
  messages?: readonly SessionMessageInfo[]
}) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const hosts: PluginHost[] = []
  const captured: Captured = {}
  const attached: string[] = []

  const object = (id: string) => {
    const value = {
      key: `fixture\n${id}`,
      id,
      tab: id,
      pending: false,
      location: { directory: "/repo" },
      visit: {},
      server: { data: { session: { message: { list: () => input.messages ?? [] } } } },
    }

    // SAFETY: the region and slot pass the object through; the test's plugins read only `key`, `id` and the
    // server's message list.
    // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- see SAFETY above
    return value as unknown as MountedSession
  }

  const [view, setView] = createSignal(object("a"))
  const [routed, setRouted] = createSignal(true)

  const route = {
    composer: { attach: () => void attached.push(view().id), update() {}, detach() {} },
  }

  // SAFETY: the test's plugin reads only `composer.attach` of the screen.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- see SAFETY above
  const screen = route as unknown as SessionScreen

  const sidebar = { opened: () => false, width: () => 0, transition: () => false, resize() {}, toggle() {} }

  function Region() {
    const host = usePluginHost()
    hosts.push(host)
    // Every panel's `main` tab is stored, and `active` selected, as a strip restored after a reload.
    const all = () => host.items(Panel).map((item) => `${item.plugin}:main`)

    const region = createRegion({
      region: "side",
      view,
      screen,
      tabs: () => ({
        tabs: () => ({ all: all(), active: input.active }),
        all,
        active: () => input.active,
        setAll() {},
        setActive() {},
        close() {},
        remap() {},
      }),
      closed: createClosedTabs(),
      open() {},
      side: () => ({ opened: () => true, toggle() {} }),
    })

    return (
      <Show when={host.ready()}>
        <PluginSlot
          at="session.panel.end"
          input={{
            get session() {
              return view()
            },
            screen,
          }}
        />
        <RegionContent
          pane={region.pane("side")}
          view={view()}
          screen={screen}
          frame={{
            shown: () => true,
            present: () => true,
            placement: () => "side",
            reserve: () => false,
            animate: () => false,
            sidebar,
          }}
        />
      </Show>
    )
  }

  const dispose = render(
    () => (
      <LanguageProvider locale="en">
        <PlatformProvider value={web}>
          <DialogProvider>
            <RealHost
              definitions={input.definitions}
              captured={captured}
              mounted={standIn({ current: () => (routed() ? view() : undefined), screen: () => screen })}
            >
              <Region />
            </RealHost>
          </DialogProvider>
        </PlatformProvider>
      </LanguageProvider>
    ),
    container,
  )

  return {
    container,
    /** Routes a session: the screen creates a new session object for it. */
    route: (id: string) => setView(object(id)),
    /** The route leaves while its old screen has not unmounted yet. */
    leave: () => setRouted(false),
    /** The session each composer attachment reached, in order. */
    attached,
    status: (id: string) => hosts[0]?.state.status[id],
    unmount: () => {
      dispose()
      container.remove()
    },
  }
}

/**
 * Mounts the real host and the composer lane's plugin pills for one session, as the composer region renders them
 * (right-aligned). The session's directory is `/repo`.
 */
export function mountComposerPills(input: { definitions: readonly Entry[] }) {
  const container = document.createElement("div")
  container.dataset.testid = "composer-pills"
  container.style.position = "relative"
  container.style.marginTop = "240px"
  document.body.appendChild(container)
  const hosts: PluginHost[] = []
  const captured: Captured = {}

  const value = { key: "fixture\na", id: "a", directory: "/repo", visit: {} }

  // SAFETY: the pill renderer passes the session through; the test's plugins read only `directory`.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- see SAFETY above
  const session = value as unknown as MountedSession

  // SAFETY: as above; the test's plugins never read the screen.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- see SAFETY above
  const screen = {} as unknown as SessionScreen

  function Pills() {
    const host = usePluginHost()
    hosts.push(host)

    return (
      <Show when={host.ready()}>
        <SessionPluginPills session={session} screen={screen} alignment={() => "end"} />
      </Show>
    )
  }

  const dispose = render(
    () => (
      <LanguageProvider locale="en">
        <PlatformProvider value={web}>
          <DialogProvider>
            <RealHost definitions={input.definitions} captured={captured}>
              <Pills />
            </RealHost>
          </DialogProvider>
        </PlatformProvider>
      </LanguageProvider>
    ),
    container,
  )

  return {
    status: (id: string) => hosts[0]?.state.status[id],
    failure: (id: string) => hosts[0]?.state.failures[id],
    unmount: () => {
      dispose()
      container.remove()
    },
  }
}

/**
 * Mounts the real host over the real HostApis of a web window, before the app interface mounts, with the window's
 * toast region. `attach()` mounts a stand-in for the interface: its layout records each write and reports a tab it
 * opened as visible, its server is the local one, and its mono font is "fixture mono".
 */
export function mountHostApis(input: { definitions: readonly Entry[] }) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const writes: string[] = []
  const [opened, setOpened] = createSignal<readonly string[]>([])
  const hosts: PluginHost[] = []
  const captured: Captured = {}
  const layout = standIn({}).layout

  const mounted = standIn({
    layout: {
      ...layout,
      open(key) {
        writes.push(`open ${key}`)
        setOpened((keys) => [...keys, key])
      },
      close: (key) => void writes.push(`close ${key}`),
      toggle: (key) => void writes.push(`toggle ${key}`),
      state: (key) => (opened().includes(key) ? "visible" : "closed"),
      scroll: { get: () => undefined, set: (_session, key) => void writes.push(`scroll ${key}`) },
    },
    settings: (page) => void writes.push(`settings ${page}`),
  })

  function Capture() {
    hosts.push(usePluginHost())

    return null
  }

  const dispose = render(
    () => (
      <LanguageProvider locale="en">
        <PlatformProvider value={web}>
          <DialogProvider>
            <RealHost definitions={input.definitions} captured={captured}>
              <Capture />
            </RealHost>
            <Toast.Region />
          </DialogProvider>
        </PlatformProvider>
      </LanguageProvider>
    ),
    container,
  )

  return {
    /** Layout writes the interface received, in order. */
    writes,
    /** Mounts the interface. */
    attach: () => void captured.apis?.attach(mounted),
    reload: (id: string) => hosts[0]?.reload(id),
    status: (id: string) => hosts[0]?.state.status[id],
    unmount: () => {
      dispose()
      container.remove()
    },
  }
}
