import { DialogProvider, useDialog } from "@opencode/ui/context/dialog"
import { createStore } from "solid-js/store"
import { For, onMount, type JSX } from "solid-js"
import { render } from "solid-js/web"
import { liveAccessor, PluginContext } from "@opencode/plugin/gui/host"
import type { Context, IpcClient, SetupContext, Ui } from "@opencode/plugin/gui"
import browserEn from "./i18n/en"
import type definition from "./index"
import type { BrowserProfile, ImportResult, ProfileSource, SiteList } from "./profile/ipc"
import { SiteChooserDialog } from "./site-chooser"
import { SignInOffer } from "./import-prompt"

/**
 * What main answers the dialog: how many made-up sites the first profile has (or why it has none), whether the
 * listing waits for the test, whether an import brings everything or (`partial`) leaves a cookie behind, and the page's site it opens for (`site`).
 * `pages` is how many pages of history an import that asks for history brings.
 */
export type SiteScenario = {
  /** The dialog opens with its site list shown, as where the person asked to choose sites. */
  reveal?: boolean
  readonly sites: number | "locked"
  readonly hold?: boolean
  readonly partial?: boolean
  readonly skipped?: number
  readonly protected?: number
  readonly empty?: boolean
  readonly site?: { readonly name: string; readonly choose: boolean }
  readonly pages?: number
  /** The browser's files could not be read when the import ran. */
  readonly unreadable?: boolean
  /** No cookie could be brought: the import counts none, whatever it lost. */
  readonly none?: boolean
  /** The app runs on macOS, where a Chromium browser's import waits at the Keychain prompt: this one waits for the test. */
  readonly keychain?: boolean
}

/** The dialog host, once the opener mounts under it: the offer opens its own import dialog there. */
type Hosted = { dialog?: ReturnType<typeof useDialog> }

const sources: ProfileSource[] = [
  {
    id: "chrome",
    name: "Google Chrome",
    engine: "chromium",
    profiles: [
      { id: "Default", name: "Work" },
      { id: "Profile 1", name: "Home" },
    ],
  },
]

// Five named tools first, as a profile's most recent sites, then made-up sites up to the scenario's count. A long one
// shows how a name loses its start.
const named = ["github.com", "linear.app", "figma.com", "bank.test", "xn--mnchen-3ya.de"]

const longest = `${"very-long-subdomain-label-".repeat(4)}example.co.uk`

function siteList(count: number): SiteList {
  const sites = Array.from({ length: count }, (_, index) => ({
    site: named[index] ?? (index === 5 ? longest : `site-${String(index).padStart(4, "0")}.example.co.uk`),
    cookies: (index % 7) + 1,
  }))

  return { type: "listed", sites, order: "recent" }
}

// Component-test fixture: the real import dialog, with jobs of its own, in the real dialog host, and main's browser
// profile faked at its Ipc. It records each import main receives and each list it reads in an element beside the
// dialog, so the test reads what would be imported, and whether the dialog closed.
export function mountSiteChooser(input: { ui: Ui; scenario: SiteScenario; direction?: "ltr" | "rtl"; offer?: boolean; card?: boolean }) {
  const host = document.createElement("main")
  host.dataset.testid = "site-chooser-fixture"
  host.dir = input.direction ?? "ltr"
  document.documentElement.dir = host.dir
  document.body.appendChild(host)

  const messages = new Map<string, string>([
    ...Object.entries(browserEn),
    ["common.close", "Close"],
    ["common.cancel", "Cancel"],
    ["common.retry", "Try again"],
  ])

  const t = (key: string, params?: Readonly<Partial<Record<string, string | number>>>) =>
    (messages.get(key) ?? key).replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(params?.[name] ?? ""))

  const [store, setStore] = createStore<{
    imports: { source: string; profile: string; sites?: readonly string[]; cookies?: boolean; history?: boolean }[]
    reads: string[]
    closed: boolean
    imported: number
    closes: number
  }>({ imports: [], reads: [], closed: false, imported: 0, closes: 0 })

  const held = Promise.withResolvers<void>()
  const hosted: Hosted = {}

  const client = {
    state: () => ({ extensions: [], remoteSignIns: false }),
    on: () => () => undefined,
    sources: async () => (input.scenario.empty ? [] : sources),
    summary: async () => ({ cookies: 0, persistent: true }),
    sites: async (request: { source: string; profile: string }): Promise<SiteList> => {
      setStore("reads", (reads) => [...reads, request.profile])

      if (input.scenario.hold) await held.promise

      if (request.profile === "Profile 1") return { type: "listed", sites: [{ site: "netflix.com", cookies: 4 }, { site: "bbc.co.uk", cookies: 2 }, { site: "google.com", cookies: 120000 }, { site: "google.com.au", cookies: 3 }], order: "recent" }

      return input.scenario.sites === "locked" ? { type: "failed", reason: "locked" } : siteList(input.scenario.sites)
    },
    importBrowser: async (request: { source: string; profile: string; sites?: readonly string[]; cookies?: boolean; history?: boolean }): Promise<ImportResult> => {
      setStore("imports", (items) => [...items, request])

      if (input.scenario.keychain) await held.promise

      if (input.scenario.unreadable) return { type: "failed", reason: "read" }
      // Without a list of sites, main imports the whole profile; without cookies, only its history.
      const count = request.cookies === false || input.scenario.none ? 0 : (request.sites?.length ?? 5) * 2

      return {
        type: "imported",
        imported: count,
        skipped: input.scenario.skipped ?? 0,
        protected: input.scenario.protected ?? 0,
        failed: input.scenario.partial ? 1 : 0,
        // History comes only when the import asks for it.
        pages: request.history ? input.scenario.pages : undefined,
      }
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
    locale: { locale: () => "en", direction: () => input.direction ?? "ltr" },
    plural: (key: string, count: number, params?: Parameters<typeof t>[1]) =>
      t(`${key}.${count === 1 ? "one" : "other"}`, { ...params, count }),
    use: () => live,
    signal: controller.signal,
    desktop: { os: input.scenario.keychain ? "macos" : "windows" },
    stores: { preferences: { value: { links: true, welcomed: !input.offer }, set() {} } },
    layout: { settings() {} },
    dialogs: {
      open: (content: (handle: { close: () => void }) => JSX.Element) => {
        const handle = { close: () => hosted.dialog?.close() }
        hosted.dialog?.show(() => <PluginContext.Provider value={plugin}>{content(handle)}</PluginContext.Provider>)

        return handle
      },
    },
  }

  // SAFETY: the dialog uses only the context properties implemented above.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- see SAFETY above
  const plugin = fake as unknown as Context & SetupContext<typeof definition>

  function Opener() {
    const dialog = useDialog()
    hosted.dialog = dialog

    // With `offer`, the pane's sign-in bar instead of the dialog: the bar's import and its confirmation.
    if (input.offer)
      return (
        <PluginContext.Provider value={plugin}>
          <SignInOffer variant={input.card ? "card" : "bar"} imported={() => setStore("imported", (count) => count + 1)} closed={() => setStore("closes", (count) => count + 1)} />
          {/* Out of the layout: the offer is measured and pictured where it is. */}
          <ol hidden data-testid="site-chooser-imports" data-closes={store.closes} data-imported={store.imported}>
            <For each={store.imports}>{(item) => <li>{JSON.stringify(item)}</li>}</For>
          </ol>
        </PluginContext.Provider>
      )

    onMount(() =>
      dialog.show(
        () => (
          <PluginContext.Provider value={plugin}>
            <SiteChooserDialog
              site={input.scenario.site}
          reveal={input.scenario.reveal}
              imported={() => setStore("imported", (count) => count + 1)}
              close={() => dialog.close()}
            />
          </PluginContext.Provider>
        ),
        () => setStore("closed", true),
      ),
    )

    return (
      <>
        <ol data-testid="site-chooser-imports" data-reads={store.reads.join(",")} data-closed={store.closed} data-imported={store.imported}>
          <For each={store.imports}>{(item) => <li>{JSON.stringify(item)}</li>}</For>
        </ol>
        <button type="button" data-testid="site-chooser-release" onClick={() => held.resolve()}>
          Answer the listing
        </button>
      </>
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
