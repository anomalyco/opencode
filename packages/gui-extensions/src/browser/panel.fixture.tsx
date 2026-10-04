import { Browser } from "@opencode/plugin-browser/rpc"
import { DialogProvider } from "@opencode/ui/context/dialog"
import {
  batch,
  createSignal,
  For,
  Show,
  type Accessor,
  type Component,
  type JSX,
  type ParentComponent,
  type ParentProps,
} from "solid-js"
import { createStore, produce } from "solid-js/store"
import { Portal, render } from "solid-js/web"
import type { Bridge, BridgeLayout } from "../sdk/bridge"
import {
  ExtensionContext,
  PanelContext,
  type Appearance,
  type Build,
  type ComposerNote,
  type Context,
  type Definition,
  type Embeds,
  type Ipc,
  type IpcClient,
  type Keybinds,
  type Layout,
  type Locale,
  type MountedSession,
  type PanelFrame,
  type PanelTab,
  type Router,
  type Servers,
  type SessionRef,
  type Storage,
  type Workspaces,
} from "../sdk"
import type { InspectEvent } from "./connection"
import browserEn from "./i18n/en"
import type { Model } from "./model"
import SessionBrowserPane from "./panel"
import { BrowserPane, type PaneEvent } from "./ipc"

/** The renderer host pieces the pane runs on, passed in by `packages/app/component-tests/browser-pane.spec.ts`. */
type PaneHost = {
  createEmbeds(input: { bridge: Bridge | undefined; zoom: () => number; dialog: () => boolean }): Embeds
  LanguageProvider: Component<{ locale: string; children: JSX.Element }>
  UiI18nBridge: ParentComponent
  useLanguage(): { t(key: string): string }
}

type PaneFixtureState = {
  session: string
  mounted: boolean
  visible: boolean
  url: string | undefined
  loading: boolean
  generation: number
  delayNavigation: boolean
  pendingURL: string | undefined
  loadErrors: Record<string, string | undefined>
  error: string | undefined
  layouts: Record<string, BridgeLayout | undefined>
  covered: boolean
  captures: number
  holdCapture: boolean
  picker: Record<string, boolean | undefined>
  highlights: string[]
  comments: ComposerNote[]
}

// Component-test fixture: the real pane on the real host embeds, with the desktop faked at its two
// boundaries: the model's main-process pane (tab state, picker events) and the host bridge that shows native views.
export function mountBrowserPane(input: PaneHost) {
  const host = document.createElement("main")
  host.dataset.testid = "browser-pane-fixture"
  host.style.cssText = "position:fixed;inset:0;z-index:1000;background:#181818;color:#eee;padding:24px"
  document.body.appendChild(host)

  function Fixture() {
    const language = input.useLanguage()
    const messages = new Map(Object.entries(browserEn))

    const [store, setStore] = createStore<PaneFixtureState>({
      session: "Alpha",
      mounted: true,
      visible: true,
      url: undefined,
      loading: false,
      generation: 0,
      delayNavigation: false,
      pendingURL: undefined,
      loadErrors: {},
      error: undefined,
      layouts: {},
      covered: false,
      captures: 0,
      holdCapture: false,
      picker: {},
      highlights: [],
      comments: [],
    })

    // Each capture waits until the fixture releases it, so a spec can observe the pending state.
    const held: (() => void)[] = []
    // Picker events reach the routed session's listeners only, as the model keys them by session.
    const inspectors = new Map<string, Set<(event: InspectEvent) => void>>()
    const emitInspect = (event: InspectEvent) => inspectors.get(store.session)?.forEach((listener) => listener(event))

    const tabs = ["Alpha", "Beta"].map((name) => ({
      id: Browser.TabID.make(`tab_${name === "Alpha" ? "11111111" : "22222222"}-1111-1111-1111-111111111111`),
      title: name,
      url: `https://${name.toLowerCase()}.example/`,
      loading: false,
      canGoBack: false,
      canGoForward: false,
      generation: 0,
    }))

    const current = () => tabs.find((tab) => tab.title === store.session) ?? tabs[0]

    const bridge: Pick<Bridge, "embed" | "capture"> = {
      embed: (id, layout) => setStore("layouts", id, layout),
      capture: async () => {
        setStore("captures", (count) => count + 1)

        if (store.holdCapture) await new Promise<void>((resolve) => held.push(resolve))
        const canvas = new OffscreenCanvas(4, 4)
        const paint = canvas.getContext("2d")

        if (paint) {
          paint.fillStyle = "#3b82f6"
          paint.fillRect(0, 0, 4, 4)
        }

        return new Uint8Array(await (await canvas.convertToBlob({ type: "image/jpeg" })).arrayBuffer())
      },
    }

    // SAFETY: the host embeds call only `embed` and `capture` on their bridge (`runtime/extension/embeds.tsx`).
    const embeds = input.createEmbeds({ bridge: bridge as Bridge, zoom: () => 1, dialog: () => false })

    const base = {
      id: "browser",
      keybinds: { keybind: () => [], keys: (bind: string) => bind.split("+") },
      desktop: { zoom: () => 1 },
      embeds,
      t: (key: string) => messages.get(key) ?? language.t(key),
    }

    const panel: PanelFrame = {
      visible: () => store.visible,
      present: () => store.visible,
      placement: () => "side",
      reserve: () => false,
      animate: () => false,
      sidebar: { opened: () => false, width: () => 0, transition: () => false, resize() {}, toggle() {} },
      open: () => [],
    }

    // One object per session, as the host gives each routed session its own.
    const views = new Map(
      ["Alpha", "Beta", "Empty"].map((key) => {
        // SAFETY: the pane reads only `key` of its session.
        // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- see SAFETY above
        return [key, { key } as unknown as MountedSession] as const
      }),
    )

    const session = () => views.get(store.session) ?? views.get("Alpha")

    // The session screen: one object that follows the route, with the composer the pane attaches comments to.
    const screen = {
      get session() {
        return session()
      },
      file: { search: async () => [] },
      composer: { attach: (note: ComposerNote) => setStore("comments", (items) => [...items, note]) },
    }

    const fake = { ...base, screen: { current: () => screen } }

    // SAFETY: the pane reads only `id`, `t`, `keybinds`, `desktop`, `embeds`, and the screen's `file.search` and
    // `composer.attach`, of its extension's context.
    // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- see SAFETY above
    const extension = fake as unknown as Context

    const fakeModel: Pick<
      Model,
      "tab" | "suspended" | "embed" | "error" | "mount" | "load" | "command" | "inspect" | "highlight" | "onInspect"
    > = {
      tab: (_session, id) => {
        const tab = current()

        if (tab.id !== id) return

        return {
          ...tab,
          url: store.url ?? tab.url,
          loading: store.loading,
          generation: store.generation,
          loadError: store.loadErrors[store.session],
        }
      },
      suspended: () => false,
      embed: (_session, id) => `embed-${tabs.find((tab) => tab.id === id)?.title}`,
      error: () => store.error ?? (store.loadErrors[store.session] ? "Request failed" : undefined),
      mount: () => () => [],
      load: () => undefined,
      command: (_session, command) => {
        setStore("error", undefined)

        if (command.type === "navigate" || command.type === "reload") setStore("loadErrors", store.session, undefined)

        if (command.type === "navigate") {
          if (store.delayNavigation) {
            setStore("pendingURL", command.url)

            return
          }

          setStore({ url: command.url, loading: false, generation: store.generation + 1 })
        }

        if (command.type === "stop") setStore("loading", false)
      },
      // The desktop confirms each picker change, as the page does once inspect mode is armed.
      inspect: (_session, tabID, enabled) => {
        setStore("picker", store.session, enabled)
        emitInspect({ type: "inspect", tabID, active: enabled })
      },
      highlight: (_session, _tabID, ref) => setStore("highlights", (items) => [...items, ref ?? "clear"]),
      onInspect: (session, listener) => {
        const set = inspectors.get(session.key) ?? new Set()

        set.add(listener)
        inspectors.set(session.key, set)

        return () => set.delete(listener)
      },
    }

    // SAFETY: these are every member of its model the pane reads (`props.model.*` in `./panel`).
    const model = fakeModel as Model

    const pick = () =>
      emitInspect({
        type: "inspect",
        tabID: current().id,
        active: false,
        element: {
          ref: Browser.Ref.make("e7"),
          selector: "main > button.primary",
          label: "button.primary",
          role: "button",
          name: "Save changes",
          rect: { x: 48, y: 40, width: 160, height: 36 },
        },
      })

    return (
      <ExtensionContext.Provider value={extension}>
        <PanelContext.Provider value={panel}>
          <h1 style={{ "font-size": "24px", "margin-bottom": "16px" }}>Browser pane lifecycle</h1>
          <nav style={{ display: "flex", "flex-wrap": "wrap", gap: "12px", margin: "16px 0" }}>
            <For each={["Alpha", "Beta", "Empty"]}>
              {(name) => <button onClick={() => setStore({ session: name, mounted: name !== "Empty" })}>{name}</button>}
            </For>
            <button onClick={() => setStore("mounted", false)}>Unmount pane</button>
            <button onClick={() => setStore({ url: "about:blank", loading: false })}>Blank page</button>
            <button onClick={() => setStore({ url: "about:blank", loading: true })}>Loading page</button>
            <button
              onClick={() =>
                setStore({
                  loading: true,
                  generation: store.generation + 1,
                  loadErrors: { [store.session]: undefined },
                })
              }
            >
              Load current page
            </button>
            <button onClick={() => setStore("loadErrors", store.session, "ERR_CONNECTION_REFUSED")}>Failed page</button>
            <button onClick={() => setStore("delayNavigation", true)}>Delay navigation</button>
            <button onClick={() => setStore({ error: "ERR_BLOCKED_BY_CLIENT", pendingURL: undefined })}>
              Block navigation
            </button>
            <button
              onClick={() =>
                setStore({
                  url: store.pendingURL,
                  pendingURL: undefined,
                  loading: false,
                  generation: store.generation + 1,
                })
              }
            >
              Complete navigation
            </button>
            <button onClick={() => setStore("visible", (visible) => !visible)}>Toggle Review tab</button>
            <button onClick={() => setStore("holdCapture", true)}>Hold capture</button>
            <button onClick={() => held.splice(0).forEach((resolve) => resolve())}>Release capture</button>
            <button onClick={() => setStore("covered", (covered) => !covered)}>Toggle popover</button>
            <button onClick={pick}>Pick element</button>
          </nav>
          <p>Captures: {store.captures}</p>
          <p>Picker: {store.picker[store.session] ? "on" : "off"}</p>
          <p>Highlights: {store.highlights.join(",")}</p>
          <div style={{ position: "relative", width: "640px", height: "360px", border: "1px solid #555" }}>
            <Show when={store.mounted && session()}>
              {(view) => <SessionBrowserPane tab={() => current()} session={view()} model={model} />}
            </Show>
          </div>
          <ul data-testid="fixture-comments">
            <For each={store.comments}>
              {(note) => (
                <li>
                  {note.label} {note.live?.href?.includes("#") ? `@${note.live.href.split("#")[1]}` : "(no ref)"}:{" "}
                  {note.comment}
                </li>
              )}
            </For>
          </ul>
          <Show when={store.covered}>
            {/* Floating content portals into <body> like a menu or hover card over the page. */}
            <Portal mount={document.body}>
              <div
                data-popper-positioner
                style={{
                  position: "fixed",
                  top: "0",
                  left: "0",
                  width: "320px",
                  height: "480px",
                  "z-index": "1001",
                  "pointer-events": "none",
                }}
              />
            </Portal>
          </Show>
          <For each={tabs}>
            {(tab) => (
              <div
                data-testid={`native-${tab.title}`}
                data-visible={!!store.layouts[`embed-${tab.title}`]?.visible}
                style={{ padding: "12px", margin: "8px 0", border: "1px solid #555" }}
              >
                {tab.title}: {store.layouts[`embed-${tab.title}`]?.visible ? "visible" : "hidden"}
              </div>
            )}
          </For>
        </PanelContext.Provider>
      </ExtensionContext.Provider>
    )
  }

  return render(
    () => (
      <input.LanguageProvider locale="en">
        <input.UiI18nBridge>
          <Fixture />
        </input.UiI18nBridge>
      </input.LanguageProvider>
    ),
    host,
  )
}

type StripTabs = {
  all(): string[]
  active(): string | undefined
  setAll(all: string[]): void
  setActive(tab: string | undefined): void
  close(tab: string): void
  remap(rewrite: (tab: string) => string): void
}

type PaneClient = IpcClient<(typeof BrowserPane)["spec"]>

/** The app's extension host and side region, passed in by `packages/app/component-tests/browser-pane-restore.spec.ts`. */
type RegionHost = {
  LanguageProvider: Component<{ locale: string; children: JSX.Element }>
  ExtensionHostProvider: Component<
    ParentProps<{
      definitions: readonly Definition[]
      disabled: Accessor<ReadonlySet<string> | undefined>
      /** The HostApis the fixture provides, by context property; the host provides links and dialogs itself. */
      apis: { readonly [api: string]: (extension: string) => object | undefined }
      /** Runs once the app interface mounts; the fixture's is always mounted. */
      whenMounted: (run: () => void) => () => void
      ipc: (token: Ipc) => PaneClient | undefined
    }>
  >
  useExtensionHost(): { ready(): boolean }
  createRegion(input: { region: "side"; view: Accessor<MountedSession>; tabs: Accessor<StripTabs> }): {
    keys(): readonly string[]
    active(): string | undefined
    entry(key: string): { readonly tab: PanelTab } | undefined
  }
  /** The real browser and file extensions. */
  definitions: readonly Definition[]
}

type RegionFixtureState = {
  session: string
  strips: Record<string, { all: string[]; active?: string }>
  /** Each registration of a pane binding, with how many tabs it asked main to restore. */
  registrations: { binding: string; session: string; restore: number }[]
  /** The pane's Ipc is gone, as while its main extension reloads or is disabled. */
  away: boolean
}

// Component-test fixture: the real side region over the real browser and file extensions, with the host's
// session, layout, and storage HostApis and the pane's main-process Ipc faked at their boundaries. Alpha was
// left on a file tab; Beta on a browser tab whose page the desktop reports only with its first inventory.
export function mountBrowserRegion(input: RegionHost) {
  const host = document.createElement("main")
  host.dataset.testid = "browser-region-fixture"
  host.style.cssText = "position:fixed;inset:0;z-index:1000;background:#181818;color:#eee;padding:24px"
  document.body.appendChild(host)

  function Fixture() {
    const alpha = "browser-test\nses_alpha"
    const beta = "browser-test\nses_beta"
    const tabID = Browser.TabID.make("tab_33333333-3333-3333-3333-333333333333")

    const [store, setStore] = createStore<RegionFixtureState>({
      session: alpha,
      strips: {
        [alpha]: { all: ["file://alpha.ts"], active: "file://alpha.ts" },
        [beta]: { all: ["file://beta.ts", `browser:${tabID}`], active: `browser:${tabID}` },
      },
      registrations: [],
      away: false,
    })

    // The file tree's state, Changes or All files, as the file extension stores it.
    const [tree, setTree] = createSignal<object>()
    const strip = (session: string) => store.strips[session] ?? { all: [] }
    const setAll = (session: string, all: string[]) => setStore("strips", session, "all", all)

    const close = (session: string, key: string) =>
      batch(() => {
        setAll(
          session,
          strip(session).all.filter((item) => item !== key),
        )

        if (strip(session).active === key) setStore("strips", session, "active", undefined)
      })

    const server = {
      id: "browser-test",
      name: "Browser test",
      url: "http://127.0.0.1:4096",
      data: { on: () => () => undefined },
      local: true,
      builtin: true,
      compatible: true,
      connected: true,
    }

    const location = { directory: "/repo" }

    const refs = [alpha, beta].map(
      // SAFETY: the extensions read only these fields of a listed session, and of its server the ones `server` has.
      // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- see SAFETY above
      (key) => ({ key, id: key.split("\n")[1], tab: key, server, pending: false, location }) as unknown as SessionRef,
    )

    // The session screen's file model, which follows the route.
    const file = {
      root: "/repo",
      ready: () => false,
      resolve: (path: string) => path.replace(/^file:\/\//, ""),
      absolute: () => false,
      get: () => undefined,
      missing: () => false,
      sync: async () => undefined,
      search: async () => [],
    }

    // One object per routed session, as the host gives each its own.
    const views = new Map(
      [alpha, beta].map((key) => {
        const routed = {
          key,
          id: key.split("\n")[1],
          tab: key,
          visit: {},
          server,
          pending: false,
          location,
          directory: "/repo",
          local: true,
          background: [],
        }

        // SAFETY: the browser and file extensions read only these fields of the routed session in this fixture's flows.
        // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- see SAFETY above
        return [key, routed as unknown as MountedSession] as const
      }),
    )

    const fallback = views.get(alpha)

    if (!fallback) throw new Error("The fixture has no Alpha session")

    const view = () => views.get(store.session) ?? fallback

    // One screen object while the strip mounts, whichever session it routes.
    const screen = {
      get session() {
        return view()
      },
      file,
    }

    const layout = (extension: string): Layout => ({
      narrow: () => false,
      ready: () => true,
      open(key, session, options) {
        if (!strip(session.key).all.includes(key)) setAll(session.key, [...strip(session.key).all, key])

        if (options?.tab !== "append") setStore("strips", session.key, "active", key)
      },
      close: (key, session) => close(session.key, key),
      toggle() {},
      state(key, session) {
        if (strip(session.key).active === key) return "visible"

        return strip(session.key).all.includes(key) ? "open" : "closed"
      },
      stored: (session) =>
        strip(session.key).all.flatMap((key) =>
          key.startsWith(`${extension}:`) ? [key.slice(extension.length + 1)] : [],
        ),
      side: { opened: () => true, toggle() {} },
      sidebar: { opened: () => true },
      dock: { opened: () => false, placement: () => "side" },
      scroll: { get: () => undefined, set() {} },
      settings() {},
      project() {},
    })

    const keep = <T extends object>(key: string, initial: T) => {
      const [value, set] = createStore<T>(structuredClone(initial))

      if (key === "file:tree") setTree(() => value)

      return [value, (mutation: (draft: T) => void) => set(produce(mutation))] as const
    }

    // Loaded at once.
    const storage = (extension: string): Storage => ({
      store: (key, options) => {
        const [value, update] = keep(`${extension}:${key}`, options.initial)

        return { value, ready: () => true, update }
      },
      memory: (key, options) => keep(`${extension}:${key}`, options.initial),
      remove() {},
    })

    const build: Build = { version: "", channel: "dev", platform: "desktop", packaged: false }
    const locale: Locale = { locale: () => "en", direction: () => "ltr", setDirection() {} }
    const appearance: Appearance = { font: () => "monospace" }
    const router: Router = { routing: () => false, path: () => "/" }
    const keybinds: Keybinds = { keybind: () => [], keys: (bind) => bind.split("+"), matches: () => false }
    const servers: Servers = { list: () => [server.id] }
    const workspaces: Workspaces = { on: () => () => undefined }

    const listeners = new Set<(value: { binding: string; event: PaneEvent }) => void>()

    const pane: PaneClient = {
      register: async (value) => {
        setStore("registrations", (items) => [
          ...items,
          { binding: value.binding, session: value.session, restore: value.restore?.tabs.length ?? 0 },
        ])
      },
      load: async () => undefined,
      command: async () => undefined,
      inspect: async () => undefined,
      highlight: async () => undefined,
      close: async () => undefined,
      state: () => undefined,
      on: (_name, listener) => {
        // SAFETY: the pane's Ipc has one event, so every listener takes that event's payload.
        const added = listener as (value: { binding: string; event: PaneEvent }) => void
        listeners.add(added)

        return () => void listeners.delete(added)
      },
    }

    const apis = {
      build: () => build,
      locale: () => locale,
      appearance: () => appearance,
      router: () => router,
      keybinds: () => keybinds,
      servers: () => servers,
      workspaces: () => workspaces,
      desktop: () => undefined,
      sessions: () => ({ list: () => refs, current: view }),
      screen: () => ({ current: () => screen }),
      layout,
      storage,
    }

    const latest = () => store.registrations.filter((item) => item.session === "ses_beta").at(-1)

    // The desktop answers Beta's latest registration with the tab it restored.
    const inventory = () => {
      const binding = latest()?.binding

      if (!binding) return

      const tab = {
        id: tabID,
        url: "http://localhost:4173/",
        title: "Preview",
        loading: false,
        canGoBack: false,
        canGoForward: false,
        generation: 0,
      }

      listeners.forEach((listener) =>
        listener({ binding, event: { type: "state", state: { tabs: [tab], focusedTabID: tabID } } }),
      )
    }

    // Mounts once every extension is active, as the session screen does.
    function Strip() {
      const region = input.createRegion({
        region: "side",
        view,
        tabs: () => ({
          all: () => strip(view().key).all,
          active: () => strip(view().key).active,
          setAll: (all) => setAll(view().key, all),
          setActive: (tab) => setStore("strips", view().key, "active", tab),
          close: (tab) => close(view().key, tab),
          remap(rewrite) {
            const all = strip(view().key).all
            const next = Array.from(new Set(all.map(rewrite)))

            if (next.length !== all.length || next.some((key, index) => key !== all[index])) setAll(view().key, next)
          },
        }),
      })

      return (
        <>
          {/* The host strip draws a trigger for each of these keys. */}
          <div role="tablist" aria-label="Side panel" style={{ display: "flex", gap: "8px", margin: "16px 0" }}>
            <For each={region.keys()}>
              {(key) => (
                <span role="tab" aria-selected={region.active() === key} style={{ padding: "4px 8px" }}>
                  {region.entry(key)?.tab.title}
                </span>
              )}
            </For>
          </div>
          <p data-testid="selected">{region.active() ?? "none"}</p>
        </>
      )
    }

    function Ready(props: ParentProps) {
      const extensions = input.useExtensionHost()

      return <Show when={extensions.ready()}>{props.children}</Show>
    }

    return (
      <DialogProvider>
        <input.ExtensionHostProvider
          definitions={input.definitions}
          disabled={() => new Set<string>()}
          apis={apis}
          whenMounted={(run) => {
            run()

            return () => undefined
          }}
          ipc={(token) => (token.id === BrowserPane.id && !store.away ? pane : undefined)}
        >
          <h1 style={{ "font-size": "24px", "margin-bottom": "16px" }}>Restored side strip</h1>
          <nav style={{ display: "flex", gap: "12px", margin: "16px 0" }}>
            <button onClick={() => setStore("session", beta)}>Beta</button>
            <button onClick={inventory}>First inventory</button>
            <button onClick={() => setStore("away", true)}>Pane away</button>
            <button onClick={() => setStore("away", false)}>Pane back</button>
          </nav>
          <p>Registrations: {store.registrations.length}</p>
          <p>Beta restores: {latest()?.restore ?? 0}</p>
          <p data-testid="tree">{JSON.stringify(tree())}</p>
          <Ready>
            <Strip />
          </Ready>
        </input.ExtensionHostProvider>
      </DialogProvider>
    )
  }

  return render(
    () => (
      <input.LanguageProvider locale="en">
        <Fixture />
      </input.LanguageProvider>
    ),
    host,
  )
}
