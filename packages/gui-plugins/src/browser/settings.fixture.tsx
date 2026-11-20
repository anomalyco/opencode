import { DialogProvider, useDialog } from "@opencode/ui/context/dialog"
import type { JSX } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { render } from "solid-js/web"
import { liveAccessor, PluginContext } from "@opencode/plugin/gui/host"
import type { Context, SetupContext, Ui } from "@opencode/plugin/gui"
import browserEn from "./i18n/en"
import type definition from "./index"
import type { ExtensionAccess, ExtensionCompatibility, ImportResult, InstallResult, ProfileSource } from "./profile/ipc"
import BrowserSettings from "./settings"

type SampleExtension = {
  readonly id: string
  readonly name: string
  readonly version: string
  readonly icon: string
  readonly compatibility: ExtensionCompatibility
  readonly access: readonly ExtensionAccess[]
}

const badge = (bg: string, fg: string, glyph: string) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20"><rect width="20" height="20" rx="4" fill="${bg}"/>${glyph.replaceAll("FG", fg)}</svg>`,
  )}`

const sampleSources: readonly ProfileSource[] = [
  { id: "helium", name: "Helium", engine: "chromium", profiles: [{ id: "Default", name: "Default" }] },
  { id: "chrome", name: "Chrome", engine: "chromium", profiles: [{ id: "Default", name: "Default" }] },
]

const sampleExtensionEntries: readonly (readonly [string, readonly SampleExtension[]])[] = [
  [
    "helium",
    [
      {
        id: "hdokiejnpimakedhajhdlcegeplioahd",
        name: "LastPass: Free Password Manager",
        version: "4.138.0",
        icon: badge("#d32d27", "#ffffff", '<circle cx="6" cy="10" r="1.5" fill="FG"/><circle cx="10" cy="10" r="1.5" fill="FG"/><circle cx="14" cy="10" r="1.5" fill="FG"/>'),
        compatibility: { level: "partial", missing: ["native", "shortcuts"] },
        access: ["allSites", "cookies"],
      },
      {
        id: "opencodebrowseextension000000000",
        name: "OpenCode Browse",
        version: "1.0.2",
        icon: badge("#1f2328", "#ffffff", '<rect x="5" y="5" width="10" height="10" rx="2" fill="none" stroke="FG" stroke-width="1.8"/>'),
        compatibility: { level: "unsupported", cause: "startup", missing: ["native", "sidePanel"] },
        access: ["allSites"],
      },
      {
        id: "cjpalhdlnbpafiamejdnhcphjbkeiagm",
        name: "uBlock Origin",
        version: "1.62.0",
        icon: badge("#8b1e24", "#ffffff", '<path d="M10 4L15 6V10.5C15 13.3 12.8 15.4 10 16.5C7.2 15.4 5 13.3 5 10.5V6L10 4Z" fill="none" stroke="FG" stroke-width="1.6"/>'),
        compatibility: { level: "supported", missing: [] },
        access: ["allSites"],
      },
    ],
  ],
  [
    "chrome",
    [
      {
        id: "cjpalhdlnbpafiamejdnhcphjbkeiagm",
        name: "uBlock Origin",
        version: "1.62.0",
        icon: badge("#8b1e24", "#ffffff", '<path d="M10 4L15 6V10.5C15 13.3 12.8 15.4 10 16.5C7.2 15.4 5 13.3 5 10.5V6L10 4Z" fill="none" stroke="FG" stroke-width="1.6"/>'),
        compatibility: { level: "supported", missing: [] },
        access: ["allSites"],
      },
    ],
  ],
]

// Component-test fixture: the real Settings > Browser page with main's browser profile and site decisions faked at
// their Ipcs, and the stored preferences shown beside the page. `target` is the entry a settings search is revealing,
// which stays set for the whole visit, as the host leaves it. With `extensions`, Chromium browsers and their extensions
// are populated so the real Add an extension dialog can be driven end to end. `historyKept` is a sign-out that left
// main's history behind: its file could not be removed. `file` is what importing the cookie file the person picks
// brings: how many cookies came and how many could not be imported, or that the file could not be read.
export function mountBrowserSettings(input: {
  ui: Ui
  target?: string
  extensions?: boolean
  installed?: boolean
  historyKept?: boolean
  file?: { imported: number; failed: number } | "unreadable"
}) {
  const host = document.createElement("main")
  host.dataset.testid = "browser-settings-fixture"
  document.body.appendChild(host)

  const messages = new Map<string, string>([
    ...Object.entries(browserEn),
    ["common.cancel", "Cancel"],
    ["common.close", "Close"],
  ])

  const t = (key: string, params?: Readonly<Partial<Record<string, string | number>>>) =>
    (messages.get(key) ?? key).replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(params?.[name] ?? ""))

  const [preferences, setPreferences] = createStore<{ links: boolean; welcomed: boolean; advanced?: boolean; agentPages?: boolean }>({
    links: true,
    welcomed: true,
  })

  // The window's list of the last pages, which a sign-out empties.
  const [history, setHistory] = createStore<{ visits: readonly { url: string; title: string }[] }>({
    visits: [{ url: "https://alpha.example/", title: "Alpha" }],
  })

  const sampleExtensions = new Map(sampleExtensionEntries)
  const installed = new Set<string>()
  const staged = new Map<string, SampleExtension>()

  const findSample = (source: string, id: string) => sampleExtensions.get(source)?.find((item) => item.id === id)

  const initialInstalled = input.installed
    ? (sampleExtensions.get("helium") ?? []).map((entry) => ({
        id: entry.id,
        name: entry.name,
        version: entry.version,
        enabled: entry.compatibility.level !== "unsupported",
        source: "browser" as const,
        icon: entry.icon,
        compatibility: { ...entry.compatibility, missing: [...entry.compatibility.missing] },
        access: [...entry.access],
      }))
    : []

  const client = {
    state: () => ({ extensions: initialInstalled, remoteSignIns: false, decisions: [] }),
    on: () => () => undefined,
    sources: async () => (input.extensions ? [...sampleSources] : []),
    summary: async () => ({ cookies: 0, persistent: true }),
    clear: async () => ({ history: !input.historyKept }),
    importFile: async (): Promise<ImportResult> => {
      if (input.file === "unreadable") return { type: "failed", reason: "read" }

      return { type: "imported", imported: input.file?.imported ?? 0, skipped: 0, protected: 0, failed: input.file?.failed ?? 0 }
    },
    browserExtensions: async (request: { source: string; profile: string }) =>
      input.extensions
        ? (sampleExtensions.get(request.source) ?? []).map((item) => ({
            ...item,
            access: [...item.access],
            compatibility: { ...item.compatibility, missing: [...item.compatibility.missing] },
            installed: installed.has(item.id),
          }))
        : [],
    install: async (
      request:
        | { kind: "approve"; token: string }
        | { kind: "browser"; source: string; profile: string; id: string }
        | { kind: "store"; url: string }
        | { kind: "folder"; path: string },
    ): Promise<InstallResult> => {
      if (request.kind === "approve") {
        const entry = staged.get(request.token)

        if (!entry) return { type: "failed", reason: "expired" }
        staged.delete(request.token)
        installed.add(entry.id)

        return {
          type: "installed",
          extension: {
            id: entry.id,
            name: entry.name,
            version: entry.version,
            enabled: true,
            source: "browser",
            icon: entry.icon,
            compatibility: { ...entry.compatibility, missing: [...entry.compatibility.missing] },
            access: [...entry.access],
          },
        }
      }

      if (request.kind === "browser") {
        const entry = findSample(request.source, request.id)

        if (!entry) return { type: "failed", reason: "manifest" }
        const token = `tok-${entry.id}`
        staged.set(token, entry)

        return {
          type: entry.compatibility.level === "unsupported" ? "unsupported" : "review",
          token,
          id: entry.id,
          access: [...entry.access],
          hosts: ["<all_urls>"],
          permissions: ["cookies", "storage"],
          sites: [],
          name: entry.name,
          icon: entry.icon,
          compatibility: { ...entry.compatibility, missing: [...entry.compatibility.missing] },
        }
      }

      return { type: "failed", reason: "download" }
    },
  }

  const live = liveAccessor(() => ({ status: "active", generation: 1, value: client }))
  const controller = new AbortController()

  function Host() {
    const dialog = useDialog()

    const fake = {
      id: "browser",
      ui: input.ui,
      t,
      locale: { locale: () => "en", direction: () => "ltr" },
      plural: (key: string, count: number, params?: Parameters<typeof t>[1]) =>
        t(`${key}.${count === 1 ? "one" : "other"}`, { ...params, count }),
      use: () => live,
      signal: controller.signal,
      // The person picks a made-up cookie file.
      desktop: { os: "windows", pick: async () => ["C:\\made-up\\cookies.txt"] },
      dialogs: {
        open: (content: (handle: { close: () => void }) => JSX.Element) => {
          const handle = { close: () => dialog.close() }
          dialog.show(() => <PluginContext.Provider value={plugin}>{content(handle)}</PluginContext.Provider>)

          return handle
        },
      },
      stores: {
        preferences: {
          value: preferences,
          ready: () => true,
          update: (mutate: (draft: typeof preferences) => void) => setPreferences(produce(mutate)),
          set: (next: typeof preferences) => setPreferences(next),
        },
        history: { value: history, ready: () => true, set: (next: typeof history) => setHistory(next) },
      },
    }

    // SAFETY: the page uses only the context properties implemented above, and of the Ipcs only the listed methods.
    // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- see SAFETY above
    const plugin = fake as unknown as Context & SetupContext<typeof definition>

    return (
      <PluginContext.Provider value={plugin}>
        <BrowserSettings target={input.target} />
        <output data-testid="browser-settings-stored">{JSON.stringify(preferences)}</output>
        <output data-testid="browser-settings-visits">{history.visits.length}</output>
      </PluginContext.Provider>
    )
  }

  const dispose = render(
    () => (
      <DialogProvider>
        <Host />
      </DialogProvider>
    ),
    host,
  )

  return () => {
    controller.abort()
    dispose()
  }
}
