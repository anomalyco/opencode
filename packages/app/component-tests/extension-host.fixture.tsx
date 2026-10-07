import { DialogProvider } from "@opencode/ui/context/dialog"
import {
  Panel,
  type Appearance,
  type Build,
  type Definition,
  type Keybinds,
  type Layout,
  type Locale,
  type MountedSession,
  type Router,
  type Servers,
  type SessionScreen,
  type Setup,
  type Storage,
  type StoreOptions,
  type Workspaces,
} from "@opencode/gui-extensions/sdk"
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
import { ExtensionHostProvider, useExtensionHost, type HostApiFactories } from "../src/runtime/extension/host"
import { createHostApis } from "../src/runtime/extension/host-apis"
import { createInstalled } from "../src/runtime/extension/installed"
import { extensionEnabled } from "@opencode/gui-extensions/sdk/bridge"
import { createRegion, RegionContent } from "../src/runtime/extension/panels"
import { ExtensionSlot } from "../src/runtime/extension/render"
import { persistedHandle } from "../src/runtime/extension/stores"
import { LanguageProvider } from "../src/runtime/i18n/language"
import { GuiExtensionsSettings } from "../src/runtime/extension/settings-page-dev"

export { bindExtension, useExtension, Contract, createKeyed, Panel, Slot, Store } from "@opencode/gui-extensions/sdk"

export { Schema }

type ExtensionHost = ReturnType<typeof useExtensionHost>

/** What the app interface hands the real host APIs when it mounts. */
type Interface = Parameters<ReturnType<typeof createHostApis>["attach"]>[0]

/** The host APIs a mounted fixture created, once it rendered. */
type Captured = { apis?: ReturnType<typeof createHostApis> }

/** A value the fixture's storage holds as JSON. */
type Json = string | number | boolean | null | readonly Json[] | { readonly [key: string]: Json }

export { createComponent, createMemo, createSignal, getOwner, onCleanup, runWithOwner }

const layout: Layout = {
  narrow: () => false,
  ready: () => true,
  open() {},
  close() {},
  toggle() {},
  state: () => "closed",
  stored: () => [],
  side: { opened: () => false, toggle() {} },
  sidebar: { opened: () => true },
  dock: { opened: () => false, placement: () => "bottom" },
  scroll: { get: () => undefined, set() {} },
  settings() {},
  project() {},
}

const build: Build = { version: "", channel: "dev", platform: "desktop", packaged: false }

const locale: Locale = { locale: () => "en", direction: () => "ltr", setDirection() {} }

const appearance: Appearance = { font: () => "monospace" }

const router: Router = { routing: () => false, path: () => "/" }

const keybinds: Keybinds = { keybind: () => [], keys: (bind) => bind.split("+"), matches: () => false }

const servers: Servers = { list: () => [], get: () => undefined }

const workspaces: Workspaces = { on: () => () => undefined }

/** Every HostApi faked at its boundary, with the given storage. */
function fakeApis(storage: (extension: string) => Storage): HostApiFactories {
  return {
    build: () => build,
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
  }
}

/** The fake HostApis' app interface, which is always mounted: a dialog shows at once. */
function mounted(run: () => void) {
  run()

  return () => undefined
}

/** Storage that no test of `mountExtensionHost` reads. */
const unused = (): Storage => {
  throw new Error("The fixture extension reads no storage")
}

/** Resolves once `check` holds, checking every frame; rejects after five seconds. */
export async function until(check: () => boolean) {
  const deadline = performance.now() + 5000

  while (!check()) {
    if (performance.now() > deadline) throw new Error("The fixture never reached the expected state")
    await new Promise((resolve) => requestAnimationFrame(resolve))
  }
}

/** Mounts the real extension host with one extension whose every renderer load settles when the test says so. */
export function mountExtensionHost() {
  const loads: PromiseWithResolvers<{ default: Setup<Definition> }>[] = []
  const [disabled, setDisabled] = createSignal<ReadonlySet<string>>(new Set())
  const hosts: ExtensionHost[] = []
  const container = document.createElement("div")
  document.body.appendChild(container)

  function Capture() {
    hosts.push(useExtensionHost())

    return null
  }

  const dispose = render(
    () => (
      <LanguageProvider locale="en">
        <DialogProvider>
          <ExtensionHostProvider
            definitions={[
              {
                id: "fixture",
                renderer: () => {
                  const load = Promise.withResolvers<{ default: Setup<Definition> }>()
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
          </ExtensionHostProvider>
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
    load: (setup: Setup<Definition>, index = 0) => loads[index].resolve({ default: setup }),
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
export function mountExtensions(input: {
  definitions: readonly Definition[]
  disabled?: readonly string[]
  bridge?: Parameters<typeof createInstalled>[0]
  stored?: Readonly<Record<string, Json>>
  /** Shows the production developer settings page for status-label contracts. */
  settings?: boolean
}) {
  const held = Promise.withResolvers<void>()
  const [disabled, setDisabled] = createSignal<ReadonlySet<string>>(new Set(input.disabled ?? []))
  const hosts: ExtensionHost[] = []
  const container = document.createElement("div")
  document.body.appendChild(container)

  const platform: Platform = {
    platform: "desktop",
    windowID: "extension-host-fixture",
    openExternal: () => undefined,
    openDirectoryPickerDialog: async () => null,
    restart: async () => undefined,
    notify: async () => undefined,
    storage: () => ({
      getItem: async (key: string) => {
        await held.promise

        return key in (input.stored ?? {}) ? JSON.stringify(input.stored?.[key]) : null
      },
      setItem: async () => undefined,
      removeItem: async () => undefined,
    }),
  }

  const storage = (extension: string): Storage => ({
    store<S extends Schema.ConstraintCodec<object, unknown>>(key: string, options: StoreOptions<S>) {
      const pair = persisted(Persist.global(`extension.${extension}.${key}`), options.schema, options.initial, platform)

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
        input.definitions.flatMap((definition) => (extensionEnabled(definition, state) ? [] : [definition.id])),
      )
    })

    return (
      <ExtensionHostProvider
        definitions={input.definitions}
        disabled={disabledState}
        apis={fakeApis(storage)}
        whenMounted={mounted}
      >
        <Capture />
      </ExtensionHostProvider>
    )
  }

  function Capture() {
    const host = useExtensionHost()
    hosts.push(host)

    return (
      <Show when={host.ready()}>
        <Show when={input.settings}>
          <GuiExtensionsSettings />
        </Show>
        <ExtensionSlot at="window.bottom" input={{}} />
      </Show>
    )
  }

  const dispose = render(
    () => (
      <LanguageProvider locale="en">
        <DialogProvider>
          <MountedHost />
        </DialogProvider>
      </LanguageProvider>
    ),
    container,
  )

  return {
    container,
    unmount: () => {
      dispose()
      container.remove()
    },
    /** Lets the held storage reads answer. */
    release: () => held.resolve(),
    disable: (ids: readonly string[]) => setDisabled(new Set(ids)),
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
    screen: () => undefined,
    scope: () => ServerScope.local,
    scoped: () => undefined,
    layout: {
      ready: () => true,
      open() {},
      close() {},
      toggle() {},
      state: () => "closed",
      stored: () => [],
      side: { opened: () => true, toggle() {} },
      sidebar: { opened: () => false },
      dock: { opened: () => false, placement: () => "bottom" },
      scroll: { get: () => undefined, set() {} },
    },
    settings() {},
    project() {},
    font: () => "fixture mono",
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
function RealHost(props: ParentProps<{ definitions: readonly Definition[]; captured: Captured; mounted?: Interface }>) {
  const apis = createHostApis()
  props.captured.apis = apis

  if (props.mounted) onCleanup(apis.attach(props.mounted))

  return (
    <ExtensionHostProvider
      definitions={props.definitions}
      disabled={() => new Set<string>()}
      apis={apis.apis}
      whenMounted={apis.whenMounted}
    >
      {props.children}
    </ExtensionHostProvider>
  )
}

/**
 * Mounts the real host and HostApis, and the parts of the session screen that render extension content for the routed
 * session: the side region (`createRegion`, `RegionContent`) with every panel's tabs stored, and the
 * `session.panel.end` slot, whose input the screen builds this way. `route(id)` routes a session the way the screen
 * does: a new session object each time, delivered through the same reactive inputs, while the one screen object
 * `ctx.screen` returns follows the route. Its composer records which session each attachment reached.
 */
export function mountSessionRegion(input: { definitions: readonly Definition[]; active: string }) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const hosts: ExtensionHost[] = []
  const captured: Captured = {}
  const attached: string[] = []

  const object = (id: string) => {
    const value = { key: `fixture\n${id}`, id, tab: id, pending: false, location: { directory: "/repo" }, visit: {} }

    // SAFETY: the region and slot pass the object through; the test's extension reads only `key` and `id`.
    // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- see SAFETY above
    return value as unknown as MountedSession
  }

  const [view, setView] = createSignal(object("a"))
  const [routed, setRouted] = createSignal(true)

  const route = {
    composer: { attach: () => void attached.push(view().id), update() {}, detach() {} },
  }

  // SAFETY: the test's extension reads only `composer.attach` of the screen.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- see SAFETY above
  const screen = route as unknown as SessionScreen

  const sidebar = { opened: () => false, width: () => 0, transition: () => false, resize() {}, toggle() {} }

  function Region() {
    const host = useExtensionHost()
    hosts.push(host)
    // Every panel's `main` tab is stored, and `active` selected, as a strip restored after a reload.
    const all = () => host.items(Panel).map((item) => `${item.extension}:main`)

    const region = createRegion({
      region: "side",
      view,
      screen,
      tabs: () => ({
        all,
        active: () => input.active,
        setAll() {},
        setActive() {},
        close() {},
        remap() {},
      }),
    })

    return (
      <Show when={host.ready()}>
        <ExtensionSlot
          at="session.panel.end"
          input={{
            get session() {
              return view()
            },
            screen,
          }}
        />
        <RegionContent
          region={region}
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
 * Mounts the real host over the real HostApis of a web window, before the app interface mounts. `attach()` mounts a
 * stand-in for the interface: its layout records each write and reports a tab it opened as visible, its server is
 * the local one, and its mono font is "fixture mono".
 */
export function mountHostApis(input: { definitions: readonly Definition[] }) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const writes: string[] = []
  const [opened, setOpened] = createSignal<readonly string[]>([])
  const hosts: ExtensionHost[] = []
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
    hosts.push(useExtensionHost())

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
    status: (id: string) => hosts[0]?.state.status[id],
    unmount: () => {
      dispose()
      container.remove()
    },
  }
}
