import { DialogProvider } from "@opencode/ui/context/dialog"
import { Browser } from "@opencode/plugin-browser/rpc"
import { For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { render } from "solid-js/web"
import { LanguageProvider, UiI18nBridge } from "../src/runtime/i18n/language"
import type { BrowserPaneLayout, BrowserPaneRegistration } from "../src/runtime/platform/browser-pane"
import type { createSessionBrowser } from "../src/session/browser/model"
import { SessionBrowserPane } from "../src/session/browser/pane"

export function mountBrowserPane() {
  const host = document.createElement("main")
  host.dataset.testid = "browser-pane-fixture"
  host.style.cssText = "position:fixed;inset:0;z-index:1000;background:#181818;color:#eee;padding:24px"
  document.body.appendChild(host)

  function Fixture() {
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
      layouts: {} as Record<string, BrowserPaneLayout | undefined>,
      shows: {} as Record<string, number>,
    })
    const tabs = ["Alpha", "Beta"].map((name) => ({
      id: Browser.TabID.make(`tab_${name === "Alpha" ? "11111111" : "22222222"}-1111-1111-1111-111111111111`),
      title: name,
      url: `https://${name.toLowerCase()}.example/`,
      loading: false,
      canGoBack: false,
      canGoForward: false,
      generation: 0,
    }))
    // Record the native boundary per registration: hiding Beta cannot hide Alpha's view.
    const registrations = new Map<string, BrowserPaneRegistration>(
      tabs.map((tab) => [
        tab.title,
        {
          setLayout: (layout) => {
            setStore("layouts", tab.title, layout)
            if (layout?.visible) setStore("shows", tab.title, (count = 0) => count + 1)
          },
          command: async () => undefined,
          close: () => undefined,
        },
      ]),
    )
    const browser: ReturnType<typeof createSessionBrowser> = {
      available: () => true,
      attached: () => !!registrations.get(store.session),
      opened: () => !!registrations.get(store.session),
      state: () => ({ tabs: tabs.filter((tab) => tab.title === store.session), focusedTabID: null }),
      tabs: () => tabs.filter((tab) => tab.title === store.session),
      active: () => {
        const tab = tabs.find((tab) => tab.title === store.session) ?? tabs[0]
        return {
          ...tab,
          url: store.url ?? tab.url,
          loading: store.loading,
          generation: store.generation,
          loadError: store.loadErrors[store.session],
        }
      },
      registration: () => registrations.get(store.session),
      error: () => (store.loadErrors[store.session] ? "Request failed" : undefined),
      suspended: () => false,
      close: () => undefined,
      open: () => undefined,
      command: (command) => {
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
    }
    return (
      <>
        <h1 style={{ "font-size": "24px", "margin-bottom": "16px" }}>Browser pane lifecycle</h1>
        <p>Selected session: {store.session}</p>
        <nav style={{ display: "flex", gap: "20px", margin: "16px 0" }}>
          <For each={["Alpha", "Beta", "Empty"]}>
            {(name) => <button onClick={() => setStore({ session: name, mounted: name !== "Empty" })}>{name}</button>}
          </For>
          <button onClick={() => setStore("mounted", false)}>Unmount pane</button>
          <button onClick={() => setStore({ url: "about:blank", loading: false })}>Blank page</button>
          <button onClick={() => setStore({ url: "about:blank", loading: true })}>Loading page</button>
          <button
            onClick={() =>
              setStore({ loading: true, generation: store.generation + 1, loadErrors: { [store.session]: undefined } })
            }
          >
            Load current page
          </button>
          <button onClick={() => setStore("loadErrors", store.session, "ERR_CONNECTION_REFUSED")}>Failed page</button>
          <button onClick={() => setStore("delayNavigation", true)}>Delay navigation</button>
          <button
            onClick={() =>
              setStore({ url: store.pendingURL, pendingURL: undefined, loading: false, generation: store.generation + 1 })
            }
          >
            Complete navigation
          </button>
          <button onClick={() => setStore("visible", (visible) => !visible)}>Toggle Review tab</button>
        </nav>
        <div style={{ width: "640px", height: "360px", border: "1px solid #555" }}>
          <Show when={store.mounted}>
            <SessionBrowserPane browser={browser} visible={store.visible} />
          </Show>
        </div>
        <h2 style={{ "font-size": "18px", margin: "20px 0 12px" }}>Native layout recorder</h2>
        <p>The desktop boundary keeps each session's page visible until its registration is hidden.</p>
        <For each={tabs}>
          {(tab) => (
            <div
              data-testid={`native-${tab.title}`}
              data-visible={!!store.layouts[tab.title]?.visible}
              data-shows={store.shows[tab.title] ?? 0}
              style={{ padding: "12px", margin: "8px 0", border: "1px solid #555" }}
            >
              {tab.title}: {store.layouts[tab.title]?.visible ? "visible" : "hidden"}
            </div>
          )}
        </For>
      </>
    )
  }

  return render(
    () => (
      <LanguageProvider locale="en">
        <UiI18nBridge>
          <DialogProvider>
            <Fixture />
          </DialogProvider>
        </UiI18nBridge>
      </LanguageProvider>
    ),
    host,
  )
}
