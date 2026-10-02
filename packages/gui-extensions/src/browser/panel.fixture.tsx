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
  App,
  ExtensionContext,
  Layout,
  Native,
  PanelContext,
  Sessions,
  Storage,
  Surfaces,
  type ComposerNote,
  type Context,
  type Definition,
  type PanelFrame,
  type PanelTab,
  type Remote,
  type RemoteClient,
  type SessionRef,
  type SessionView,
} from "../sdk"
import type { InspectEvent } from "./connection"
import browserEn from "./i18n/en"
import type { Model } from "./model"
import SessionBrowserPane from "./panel"
import { BrowserPane, type PaneEvent } from "./remote"

/** The renderer host pieces the pane runs on, passed in by `packages/app/component-tests/browser-pane.spec.ts`. */
type Host = {
  createSurfaces(input: { bridge: Bridge | undefined; zoom: () => number; dialog: () => boolean }): Surfaces
  LanguageProvider: Component<{ locale: string; children: JSX.Element }>
  UiI18nBridge: ParentComponent
  useLanguage(): { t(key: string): string }
}

// Component-test fixture: the real pane on the real host surface, with the desktop faked at its two
// boundaries: the model's main-process pane (tab state, picker events) and the host bridge that shows native views.
export function mountBrowserPane(input: Host) {
  const host = document.createElement("main")
  host.dataset.testid = "browser-pane-fixture"
  host.style.cssText = "position:fixed;inset:0;z-index:1000;background:#181818;color:#eee;padding:24px"
  document.body.appendChild(host)
  function Fixture() {
    const language = input.useLanguage()
    const [store, setStore] = createStore({
      session: "Alpha",
      mounted: true,
      visible: true,
      url: undefined as string | undefined,
      loading: false,
      generation: 0,
      delayNavigation: false,
      pendingURL: undefined as string | undefined,
      loadErrors: {} as Record<string, string | undefined>,
      error: undefined as string | undefined,
      layouts: {} as Record<string, BridgeLayout | undefined>,
      covered: false,
      captures: 0,
      holdCapture: false,
      picker: {} as Record<string, boolean | undefined>,
      highlights: [] as string[],
      comments: [] as ComposerNote[],
    })
    // Each capture waits until the fixture releases it, so a spec can observe the pending state.
    const held: (() => void)[] = []
    const inspectors = new Set<(event: InspectEvent) => void>()
    const emitInspect = (event: InspectEvent) => inspectors.forEach((listener) => listener(event))
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
    const bridge = {
      surface: (id: string, layout?: BridgeLayout) => setStore("layouts", id, layout),
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
    const surfaces = input.createSurfaces({ bridge: bridge as unknown as Bridge, zoom: () => 1, dialog: () => false })
    const hosts: Record<string, unknown> = {
      [App.id]: { keybind: () => [], keys: (bind: string) => bind.split("+") },
      [Native.id]: { zoom: () => 1 },
      [Surfaces.id]: surfaces,
    }
    const extension = {
      id: "browser",
      use: (token: { id: string }) => hosts[token.id],
      t: (key: string) => (browserEn as Record<string, string>)[key] ?? language.t(key),
    } as unknown as Context
    const panel: PanelFrame = {
      visible: () => store.visible,
      present: () => store.visible,
      placement: () => "side",
      reserve: () => false,
      animate: () => false,
      sidebar: { opened: () => false, width: () => 0, transition: () => false, resize() {}, toggle() {} },
      open: () => [],
    }
    const session = {
      get key() {
        return store.session
      },
      file: { search: async () => [] },
      composer: { attach: (note: ComposerNote) => setStore("comments", (items) => [...items, note]) },
    } as unknown as SessionView
    const model = {
      tab: (_session: unknown, id: string) => {
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
      surface: (_session: unknown, id: string) => `surface-${tabs.find((tab) => tab.id === id)?.title}`,
      error: () => store.error ?? (store.loadErrors[store.session] ? "Request failed" : undefined),
      mount: () => () => undefined,
      load: () => undefined,
      command: (_session: unknown, command: Browser.Action) => {
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
      inspect: (_session: unknown, tabID: Browser.TabID, enabled: boolean) => {
        setStore("picker", store.session, enabled)
        emitInspect({ type: "inspect", tabID, active: enabled })
      },
      highlight: (_session: unknown, _tabID: Browser.TabID, ref?: Browser.Ref) =>
        setStore("highlights", (items) => [...items, ref ?? "clear"]),
      onInspect: (_session: unknown, listener: (event: InspectEvent) => void) => {
        inspectors.add(listener)
        return () => inspectors.delete(listener)
      },
    } as unknown as Model
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
            <Show when={store.mounted}>
              <SessionBrowserPane tab={() => current()} session={session} model={model} />
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
                data-visible={!!store.layouts[`surface-${tab.title}`]?.visible}
                style={{ padding: "12px", margin: "8px 0", border: "1px solid #555" }}
              >
                {tab.title}: {store.layouts[`surface-${tab.title}`]?.visible ? "visible" : "hidden"}
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

/** The app's extension host and side region, passed in by `packages/app/component-tests/browser-pane-restore.spec.ts`. */
type RegionHost = {
  LanguageProvider: Component<{ locale: string; children: JSX.Element }>
  ExtensionHostProvider: Component<
    ParentProps<{
      definitions: readonly Definition[]
      disabled: Accessor<ReadonlySet<string> | undefined>
      services: readonly {
        readonly token: { readonly kind: "host"; readonly id: string }
        create(extension: string): unknown
      }[]
      remote: (token: Remote) => unknown
    }>
  >
  useExtensionHost(): { ready(): boolean }
  createRegion(input: { region: "side"; view: SessionView; tabs: Accessor<StripTabs> }): {
    keys(): readonly string[]
    active(): string | undefined
    entry(key: string): { readonly tab: PanelTab } | undefined
  }
  /** The real browser and file extensions. */
  definitions: readonly Definition[]
}

// Component-test fixture: the real side region over the real browser and file extensions, with the host's
// session, layout, and storage services and the pane's main-process remote faked at their boundaries. Alpha was
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
    const [store, setStore] = createStore({
      session: alpha,
      strips: {
        [alpha]: { all: ["file://alpha.ts"], active: "file://alpha.ts" },
        [beta]: { all: ["file://beta.ts", `browser:${tabID}`], active: `browser:${tabID}` },
      } as Record<string, { all: string[]; active?: string }>,
      registrations: [] as { binding: string; session: string }[],
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
      (key) => ({ key, id: key.split("\n")[1], tab: key, server, pending: false, location }) as unknown as SessionRef,
    )
    const view = {
      get key() {
        return store.session
      },
      get id() {
        return store.session.split("\n")[1]
      },
      get tab() {
        return store.session
      },
      server,
      pending: false,
      location,
      directory: "/repo",
      local: true,
      background: [],
      file: {
        root: "/repo",
        ready: () => false,
        resolve: (path: string) => path.replace(/^file:\/\//, ""),
        absolute: () => false,
        get: () => undefined,
        missing: () => false,
        sync: async () => undefined,
        search: async () => [],
      },
    } as unknown as SessionView
    const layout = (extension: string): Layout => ({
      narrow: () => false,
      ready: () => true,
      open(key, session, options) {
        if (!strip(session.key).all.includes(key)) setAll(session.key, [...strip(session.key).all, key])
        if (options?.focus !== false) setStore("strips", session.key, "active", key)
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
    const storage = (extension: string): Storage => ({
      store: (key, options) => [...keep(`${extension}:${key}`, options.initial), () => true] as const,
      memory: (key, options) => keep(`${extension}:${key}`, options.initial),
      remove() {},
    })
    const app: App = {
      channel: "dev",
      platform: "desktop",
      font: () => "monospace",
      locale: () => "en",
      direction: () => "ltr",
      setDirection() {},
      routing: () => false,
      path: () => "/",
      keybind: () => [],
      keys: (bind) => bind.split("+"),
      matches: () => false,
      servers: () => [server.id],
      on: () => () => undefined,
    }
    const listeners = new Set<(value: { binding: string; event: PaneEvent }) => void>()
    const pane: RemoteClient<(typeof BrowserPane)["spec"]> = {
      register: async (value) => {
        setStore("registrations", (items) => [...items, { binding: value.binding, session: value.session }])
      },
      load: async () => undefined,
      command: async () => undefined,
      inspect: async () => undefined,
      highlight: async () => undefined,
      close: async () => undefined,
      state: () => undefined,
      on: (_name, listener) => {
        // SAFETY: the pane's remote has one event, so every listener takes that event's payload.
        const added = listener as (value: { binding: string; event: PaneEvent }) => void
        listeners.add(added)
        return () => void listeners.delete(added)
      },
    }
    const services = [
      { token: App, create: () => app },
      { token: Native, create: () => undefined },
      { token: Sessions, create: () => ({ list: () => refs, current: () => view }) },
      { token: Layout, create: layout },
      { token: Storage, create: storage },
    ]
    // The desktop answers Beta's latest registration with the tab it restored.
    const inventory = () => {
      const binding = store.registrations.filter((item) => item.session === "ses_beta").at(-1)?.binding
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
          all: () => strip(view.key).all,
          active: () => strip(view.key).active,
          setAll: (all) => setAll(view.key, all),
          setActive: (tab) => setStore("strips", view.key, "active", tab),
          close: (tab) => close(view.key, tab),
          remap(rewrite) {
            const all = strip(view.key).all
            const next = Array.from(new Set(all.map(rewrite)))
            if (next.length !== all.length || next.some((key, index) => key !== all[index])) setAll(view.key, next)
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
          services={services}
          remote={(token) => (token.id === BrowserPane.id ? pane : undefined)}
        >
          <h1 style={{ "font-size": "24px", "margin-bottom": "16px" }}>Restored side strip</h1>
          <nav style={{ display: "flex", gap: "12px", margin: "16px 0" }}>
            <button onClick={() => setStore("session", beta)}>Beta</button>
            <button onClick={inventory}>First inventory</button>
          </nav>
          <p>Registrations: {store.registrations.length}</p>
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
