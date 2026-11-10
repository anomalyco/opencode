import "./worker"
import { createMemoryHistory, MemoryRouter, type BaseRouterProps } from "@solidjs/router"
import { createEffect, untrack } from "solid-js"
import { render } from "solid-js/web"
import {
  AppBaseProviders,
  AppInterface,
  createBrowserDraftStore,
  loadInitialLocale,
  PlatformProvider,
  ServerConnection,
  useTabs,
  type Platform,
} from "@opencode/app/vscode"
import { bootstrap } from "./bootstrap"
import { createProxyFetch, post } from "./bridge"
import { ConfigurationSync } from "./configuration"

const platform: Platform = {
  platform: "ide",
  version: bootstrap.version,
  // Drafts stay in the webview's IndexedDB, as in a browser tab.
  draftStore: createBrowserDraftStore(),
  fetch: createProxyFetch(bootstrap.server),
  openExternal: (url) => post({ type: "open.external", url }),
  openLocalFile: (url) => post({ type: "open.file", url }),
  openPath: async (path) => post({ type: "open.path", path }),
  writeClipboardText: async (text) => post({ type: "clipboard.write", text }),
  openSettings: () => post({ type: "settings.open" }),
  project: bootstrap.directory,
  // VS Code's integrated terminal serves instead, and the marketplace updates the extension, whose bundle the web
  // updater would look for in VS Code's own service worker.
  omitPlugins: ["terminal", "updater"],
  // VS Code sets these on the webview and updates them when its font settings change.
  fonts: { sans: "var(--vscode-font-family)", mono: "var(--vscode-editor-font-family)" },
  // Tabs are kept per window. Webview storage is shared by every VS Code window, so each workspace keeps its own.
  windowID: bootstrap.directory,
  // The page came from the extension host, which renders it again.
  restart: async () => post({ type: "reload" }),
  async notify(title, description) {
    if (document.hasFocus()) return
    post({ type: "notify", title, description })
  },
}

// The service credential stays in the extension host, which adds it to every proxied request.
const server: ServerConnection.Http = { type: "http", http: { url: bootstrap.server } }

const serverKey = ServerConnection.key(server)

const router = (props: BaseRouterProps) => <MemoryRouter {...props} history={createMemoryHistory()} />

void loadInitialLocale().then((locale) =>
  render(
    () => (
      <PlatformProvider value={platform}>
        <AppBaseProviders locale={locale}>
          <AppInterface canonicalLocalServer={serverKey} servers={[server]} router={router}>
            <ConfigurationSync />
            <WorkspaceDraft directory={bootstrap.directory} />
          </AppInterface>
        </AppBaseProviders>
      </PlatformProvider>
    ),
    document.getElementById("root")!,
  ),
)

/** Reopens the tab a previous load left active, or starts a draft in the workspace folder when there is none. */
function WorkspaceDraft(props: { directory: string }) {
  const tabs = useTabs()

  createEffect(() => {
    if (!tabs.ready() || !tabs.recentReady()) return

    untrack(() => {
      if (tabs.store.length > 0) return tabs.toggleHome({ home: true })
      void tabs.newDraft({ server: serverKey, directory: props.directory })
    })
  })

  return null
}
