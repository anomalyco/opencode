import { createStore } from "solid-js/store"
import { render } from "solid-js/web"
import { createMemo, type Component, type JSX, type ParentComponent } from "solid-js"
import { Toast } from "@opencode/ui/toast"
import { ExtensionContext, type Context, type Desktop, type MountedSession } from "../sdk"
import { FileContext, type FileShared } from "./context"
import ArtifactView from "./artifact-view"
import styles from "./artifact-view.css?inline"
import en from "./i18n/en"

type ArtifactHost = {
  LanguageProvider: Component<{ locale: string; children: JSX.Element }>
  UiI18nBridge: ParentComponent
  useLanguage(): { t(key: string): string }
}

type Installation = "pending" | "installed" | "absent" | "rejected"

type State = {
  path: string
  local: boolean
  macos: boolean
  installation: Installation
  launches: { path: string; app?: string }[]
}

const HTML = "preview/page one.html"

const ABSOLUTE = "/outside/page one.html"

/** The real ArtifactView over a deferred desktop boundary: a check and a launch settle only from the page. */
export function mountArtifactView(input: ArtifactHost) {
  const host = document.createElement("main")
  host.dataset.testid = "artifact-view-fixture"
  host.className = "fixed inset-0 z-50 bg-background-base p-6 text-text-base"
  document.body.appendChild(host)

  function Fixture() {
    const language = input.useLanguage()
    const messages = new Map(Object.entries(en))

    const [state, setState] = createStore<State>({
      path: HTML,
      local: true,
      macos: true,
      installation: "pending",
      launches: [],
    })

    const installation = Promise.withResolvers<boolean>()
    const launches: ReturnType<typeof Promise.withResolvers<void>>[] = []

    const desktop: Desktop = {
      get os() {
        return state.macos ? "macos" : "windows"
      },
      window: "artifact-fixture",
      zoom: () => 1,
      forceFocus: async () => undefined,
      reveal: async () => false,
      installed: () => installation.promise,
      launch: (path, app) => {
        setState("launches", (items) => [...items, { path, app }])
        const launch = Promise.withResolvers<void>()
        launches.push(launch)

        return launch.promise
      },
    }

    const session = () => {
      // SAFETY: ArtifactView reads only this session's directory and server.local.
      // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- see SAFETY above
      return {
        key: "Alpha",
        directory: "/workspace/Alpha",
        server: { local: state.local },
      } as unknown as MountedSession
    }

    const shared: FileShared = {
      changes: () => ({ status: "inactive", reason: "disabled" }),
      browser: () => ({
        status: "active",
        generation: 1,
        value: { attached: () => true, canOpen: () => true, open() {}, openFile() {} },
      }),
      installed: new Map(),
      tree: { tab: () => "all", setTab() {} },
      filter: { get: () => "", set() {}, browsing: () => false, setBrowsing() {} },
      request: { app: () => undefined, set() {} },
      handoff: { get: () => undefined, set() {} },
      reveal: { register: () => () => undefined, run() {} },
      active: () => true,
      open() {},
    }

    // SAFETY: these are all Context members the real HTML ArtifactView reaches; the SDK and UI providers stay real.
    // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- see SAFETY above
    const context = {
      signal: new AbortController().signal,
      t: (key: string) => messages.get(key) ?? language.t(key),
      locale: { locale: () => "en" },
      list: () => [],
      get desktop() {
        return state.macos ? desktop : undefined
      },
      screen: { current: () => ({ file: { root: "/workspace/Alpha" } }) },
    } as unknown as Context

    const content = createMemo(() => ({
      type: "text" as const,
      mimeType: state.path.endsWith(".svg") ? "image/svg+xml" : "text/html",
      content: state.path.endsWith(".svg")
        ? '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8"/></svg>'
        : "<!doctype html><h1>Local HTML preview</h1>",
    }))

    const settle = (result: Installation) => {
      if (result === "rejected") installation.reject(new Error("Installation lookup failed"))
      else installation.resolve(result === "installed")

      setState("installation", result)
    }

    const toggle = (key: "macos" | "local") => () => setState(key, (value) => !value)
    const file = (path: string) => () => setState("path", (current) => (current === path ? HTML : path))

    return (
      <ExtensionContext.Provider value={context}>
        <FileContext.Provider value={shared}>
          <style>{styles}</style>
          <h1 class="mb-3 text-16-medium">HTML file preview · simulated desktop SDK boundary</h1>
          <nav class="mb-4 flex flex-wrap gap-3">
            <button onClick={() => settle("installed")}>Chrome installed</button>
            <button onClick={() => settle("absent")}>Chrome absent</button>
            <button onClick={() => settle("rejected")}>Chrome lookup fails</button>
            <button onClick={() => launches.at(-1)?.resolve()}>Launch succeeds</button>
            <button onClick={() => launches.at(-1)?.reject(new Error("Chrome could not open this file"))}>
              Launch fails
            </button>
            <button onClick={toggle("macos")}>Windows desktop</button>
            <button onClick={toggle("local")}>Remote session</button>
            <button onClick={file("preview.svg")}>SVG file</button>
            <button onClick={file(ABSOLUTE)}>Absolute file</button>
          </nav>
          <p data-testid="installation">{state.installation}</p>
          <p data-testid="launches">{JSON.stringify(state.launches)}</p>
          <div data-testid="artifact-panel" class="mt-4 flex h-80 w-full flex-col border border-border-base">
            <ArtifactView session={session()} path={state.path} content={content()} source={<pre />} />
          </div>
          <Toast.Region />
        </FileContext.Provider>
      </ExtensionContext.Provider>
    )
  }

  const dispose = render(
    () => (
      <input.LanguageProvider locale="en">
        <input.UiI18nBridge>
          <Fixture />
        </input.UiI18nBridge>
      </input.LanguageProvider>
    ),
    host,
  )

  return () => {
    dispose()
    host.remove()
  }
}
