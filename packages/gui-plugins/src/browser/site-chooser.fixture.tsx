import { DialogProvider, useDialog } from "@opencode/ui/context/dialog"
import { createStore } from "solid-js/store"
import { For, onMount } from "solid-js"
import { render } from "solid-js/web"
import { liveAccessor, PluginContext } from "@opencode/plugin/gui/host"
import type { Context, IpcClient, SetupContext, Ui } from "@opencode/plugin/gui"
import browserEn from "./i18n/en"
import type definition from "./index"
import type { BrowserProfile, ImportResult, ProfileSource, SiteList } from "./profile/ipc"
import { profileChoices } from "./choices"
import { SiteChooser } from "./site-chooser"

/** What main answers the dialog in a scenario: a profile's sites, or why it has none. */
export type SiteScenario = { sites: number } | { failed: "locked" | "access" | "read" }

const work = { id: "Default", name: "Work" }

const chrome: ProfileSource = {
  id: "chrome",
  name: "Google Chrome",
  engine: "chromium",
  profiles: [work, { id: "Profile 1", name: "Home" }],
}

const sources: ProfileSource[] = [
  chrome,
  { id: "firefox", name: "Firefox", engine: "firefox", profiles: [{ id: "abc.default", name: "default" }] },
]

// Five named tools first, as a profile's most recent sites, then made-up sites up to the scenario's count.
const named = ["github.com", "linear.app", "figma.com", "bank.test", "xn--mnchen-3ya.de"]

function siteList(count: number): SiteList {
  const sites = Array.from({ length: count }, (_, index) => ({
    site: named[index] ?? `site-${String(index).padStart(4, "0")}.example.co.uk`,
    cookies: (index % 7) + 1,
  }))

  return { type: "listed", sites, order: "recent" }
}

// Component-test fixture: the real import dialog in the real dialog host, with main's browser profile faked at its Ipc.
// It records each import main receives, in a list beside the dialog, so the test reads what would be imported.
export function mountSiteChooser(input: { ui: Ui; scenario: SiteScenario; direction?: "ltr" | "rtl" }) {
  const host = document.createElement("main")
  host.dataset.testid = "site-chooser-fixture"
  host.dir = input.direction ?? "ltr"
  document.documentElement.dir = host.dir
  document.body.appendChild(host)

  const messages = new Map<string, string>([
    ...Object.entries(browserEn),
    ["common.close", "Close"],
    ["common.requestFailed", "Request failed"],
  ])

  const t = (key: string, params?: Readonly<Partial<Record<string, string | number>>>) =>
    (messages.get(key) ?? key).replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(params?.[name] ?? ""))

  const [store, setStore] = createStore<{ imports: { source: string; profile: string; sites?: readonly string[] }[]; listed: number }>({
    imports: [],
    listed: 0,
  })

  const client = {
    state: () => ({ extensions: [], remoteSignIns: false }),
    on: () => () => undefined,
    sources: async () => sources,
    summary: async () => ({ cookies: 0, persistent: true }),
    sites: async (): Promise<SiteList> => {
      setStore("listed", (count) => count + 1)

      return "failed" in input.scenario ? { type: "failed", reason: input.scenario.failed } : siteList(input.scenario.sites)
    },
    importBrowser: async (request: { source: string; profile: string; sites?: readonly string[] }): Promise<ImportResult> => {
      setStore("imports", (items) => [...items, request])

      return { type: "imported", imported: (request.sites?.length ?? 0) * 2, skipped: 0, protected: 0, failed: 0 }
    },
  }

  // SAFETY: the dialog and its jobs call only the methods above, with the inputs the Ipc's schemas describe.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- see SAFETY above
  const profile = client as unknown as IpcClient<(typeof BrowserProfile)["spec"]>
  const live = liveAccessor(() => ({ status: "active", generation: 1, value: profile }))
  const controller = new AbortController()

  const fake = {
    id: "browser",
    ui: input.ui,
    t,
    plural: (key: string, count: number, params?: Parameters<typeof t>[1]) =>
      t(`${key}.${count === 1 ? "one" : "other"}`, { ...params, count }),
    use: () => live,
    signal: controller.signal,
    desktop: { os: "windows" },
    stores: { preferences: { value: { links: true, welcomed: true }, set() {} } },
  }

  // SAFETY: the dialog uses only the context properties implemented above.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- see SAFETY above
  const plugin = fake as unknown as Context & SetupContext<typeof definition>
  const choices = profileChoices(sources)

  function Opener() {
    const dialog = useDialog()

    onMount(() =>
      dialog.show(() => (
        <PluginContext.Provider value={plugin}>
          <SiteChooser choices={choices} initial={{ source: chrome, profile: work }} close={() => dialog.close()} />
        </PluginContext.Provider>
      )),
    )

    return (
      <ol data-testid="site-chooser-imports" data-listed={store.listed}>
        <For each={store.imports}>{(item) => <li>{JSON.stringify(item)}</li>}</For>
      </ol>
    )
  }

  const dispose = render(
    () => (
      <DialogProvider>
        <Opener />
      </DialogProvider>
    ),
    host,
  )

  return () => {
    controller.abort()
    dispose()
  }
}
