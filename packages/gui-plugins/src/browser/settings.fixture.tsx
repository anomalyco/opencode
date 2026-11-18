import { DialogProvider } from "@opencode/ui/context/dialog"
import { createStore, produce } from "solid-js/store"
import { render } from "solid-js/web"
import { liveAccessor, PluginContext } from "@opencode/plugin/gui/host"
import type { Context, SetupContext, Ui } from "@opencode/plugin/gui"
import browserEn from "./i18n/en"
import type definition from "./index"
import BrowserSettings from "./settings"

// Component-test fixture: the real Settings > Browser page with main's browser profile and site decisions faked at
// their Ipcs as an empty profile, and the stored preferences shown beside the page. `target` is the entry a settings
// search is revealing, which stays set for the whole visit, as the host leaves it.
export function mountBrowserSettings(input: { ui: Ui; target?: string }) {
  const host = document.createElement("main")
  host.dataset.testid = "browser-settings-fixture"
  document.body.appendChild(host)

  const messages = new Map<string, string>(Object.entries(browserEn))

  const t = (key: string, params?: Readonly<Partial<Record<string, string | number>>>) =>
    (messages.get(key) ?? key).replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(params?.[name] ?? ""))

  const [preferences, setPreferences] = createStore<{ links: boolean; welcomed: boolean; advanced?: boolean; agentPages?: boolean }>({
    links: true,
    welcomed: true,
  })

  // Both Ipcs the page reads, answered as a profile with nothing in it.
  const client = {
    state: () => ({ extensions: [], remoteSignIns: false, decisions: [] }),
    on: () => () => undefined,
    sources: async () => [],
    summary: async () => ({ cookies: 0, persistent: true }),
  }

  const live = liveAccessor(() => ({ status: "active", generation: 1, value: client }))
  const controller = new AbortController()

  const fake = {
    id: "browser",
    ui: input.ui,
    t,
    locale: { locale: () => "en", direction: () => "ltr" },
    plural: (key: string, count: number, params?: Parameters<typeof t>[1]) =>
      t(`${key}.${count === 1 ? "one" : "other"}`, { ...params, count }),
    use: () => live,
    signal: controller.signal,
    desktop: { os: "windows" },
    dialogs: { open: () => ({ close() {} }) },
    stores: {
      preferences: {
        value: preferences,
        ready: () => true,
        update: (mutate: (draft: typeof preferences) => void) => setPreferences(produce(mutate)),
        set: (next: typeof preferences) => setPreferences(next),
      },
    },
  }

  // SAFETY: the page uses only the context properties implemented above, and of the Ipcs only the listed methods.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- see SAFETY above
  const plugin = fake as unknown as Context & SetupContext<typeof definition>

  const dispose = render(
    () => (
      <DialogProvider>
        <PluginContext.Provider value={plugin}>
          <BrowserSettings target={input.target} />
          <output data-testid="browser-settings-stored">{JSON.stringify(preferences)}</output>
        </PluginContext.Provider>
      </DialogProvider>
    ),
    host,
  )

  return () => {
    controller.abort()
    dispose()
  }
}
