import { expect, type Page, type Request } from "@playwright/test"
import type { SessionMessageInfo } from "@opencode/client/promise"
import { base64Encode, checksum } from "@opencode/util/encode"

// The mocked default server. Production builds connect to their own origin, so CI points this at the app.
export const SERVER = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`
export const REMOTE_SERVER = "http://127.0.0.1:4097"
export const T0 = 1700000000000

export function sessionHref(sessionID: string, server = SERVER) {
  return `/server/${base64Encode(server)}/session/${sessionID}`
}

export function draftHref(draftID: string) {
  return `/new-session?draftId=${encodeURIComponent(draftID)}`
}

// Key of `opencode.window.browser.dat:tabs.panes` entries.
export function tabKey(sessionID: string, server = SERVER) {
  return `${server}\n${sessionHref(sessionID, server)}`
}

// A default-server workspace storage key, as the app writes it for a forward-slash directory without a trailing slash.
export function workspaceKey(directory: string, key: string) {
  const head = directory.slice(0, 12).replace(/[^a-zA-Z0-9._-]/g, "-")
  return `opencode.workspace.${head}.${checksum(directory) ?? "0"}.dat:workspace:${key}`
}

export async function expectPath(page: Page, href: string) {
  await expect(page).toHaveURL(new RegExp(`${href.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`))
}

export type TabSeed =
  | string
  | { session: string; server?: string }
  | { draft: string; directory: string; server?: string }

export type SeedInput = {
  servers?: (string | { url: string; name?: string })[]
  // Key `local` is the default server; other keys are server origins.
  projects?: Record<string, { worktree: string; expanded?: boolean }[]>
  lastProject?: Record<string, string>
  // A string is a session ID on the default server.
  tabs?: TabSeed[]
  // Keyed by session ID on the default server.
  panes?: Record<string, Record<string, unknown>>
  settings?: Record<string, unknown>
  locale?: string
  theme?: { id: string; scheme: "light" | "dark" }
  // Any other storage key. Strings are written as is, other values as JSON.
  storage?: Record<string, unknown>
}

const seeds = { next: 0 }

// Writes browser storage before the app boots, once per tab: reloads and later navigations keep what the app stored.
// Object values merge one level deep into what an earlier seed wrote, so several helpers can seed one key.
export async function seed(page: Page, input: SeedInput) {
  await page.addInitScript(
    ({ marker, entries }) => {
      if (window.top !== window) return
      if (sessionStorage.getItem(marker)) return
      sessionStorage.setItem(marker, "1")
      const plain = (value: unknown): value is Record<string, unknown> =>
        !!value && typeof value === "object" && !Array.isArray(value)
      entries.forEach(([key, value, merge]) => {
        const current: unknown = merge ? JSON.parse(localStorage.getItem(key) ?? "null") : undefined
        if (!plain(current)) return localStorage.setItem(key, value)
        const next: Record<string, unknown> = JSON.parse(value)
        const merged = Object.entries({ ...current, ...next }).map(([field, item]) => {
          const before = current[field]
          const after = next[field]
          return [field, plain(before) && plain(after) ? { ...before, ...after } : item]
        })
        localStorage.setItem(key, JSON.stringify(Object.fromEntries(merged)))
      })
    },
    { marker: `opencode.e2e.seed.${seeds.next++}`, entries: storageEntries(input) },
  )
}

function storageEntries(input: SeedInput): [string, string, boolean][] {
  const server = {
    ...(input.servers
      ? {
          list: input.servers.map((item) =>
            typeof item === "string" ? item : { type: "http", displayName: item.name, http: { url: item.url } },
          ),
        }
      : {}),
    ...(input.projects ? { projects: input.projects } : {}),
    ...(input.lastProject ? { lastProject: input.lastProject } : {}),
  }
  const values: Record<string, unknown> = {
    ...(Object.keys(server).length ? { "opencode.global.dat:server": server } : {}),
    ...(input.tabs ? { "opencode.window.browser.dat:tabs": input.tabs.map(tabEntry) } : {}),
    ...(input.panes
      ? {
          "opencode.window.browser.dat:tabs.panes": Object.fromEntries(
            Object.entries(input.panes).map(([sessionID, pane]) => [tabKey(sessionID), pane]),
          ),
        }
      : {}),
    ...(input.settings ? { "settings.v3": input.settings } : {}),
    ...(input.locale ? { "opencode.global.dat:language": { locale: input.locale } } : {}),
    ...(input.theme ? { "opencode-theme-id": input.theme.id, "opencode-color-scheme": input.theme.scheme } : {}),
    ...input.storage,
  }
  return Object.entries(values).map(([key, value]) => [
    key,
    typeof value === "string" ? value : JSON.stringify(value),
    !!value && typeof value === "object" && !Array.isArray(value),
  ])
}

function tabEntry(tab: TabSeed) {
  if (typeof tab === "string") return { type: "session", server: SERVER, sessionId: tab }
  if ("session" in tab) return { type: "session", server: tab.server ?? SERVER, sessionId: tab.session }
  return { type: "draft", draftID: tab.draft, server: tab.server ?? SERVER, directory: tab.directory }
}

export function project(input: { id: string; directory: string; name?: string } & Record<string, unknown>) {
  const { directory, ...rest } = input
  return {
    worktree: directory,
    canonical: directory,
    name: directory.split(/[\\/]/).at(-1),
    vcs: "git",
    time: { created: T0, updated: T0 },
    sandboxes: [] as string[],
    ...rest,
  }
}

export function session(
  input: { id: string; directory: string; title?: string; projectID?: string; created?: number } & Record<
    string,
    unknown
  >,
) {
  const { created = T0, ...rest } = input
  return {
    slug: input.id,
    title: input.id,
    version: "dev",
    time: { created, updated: created },
    ...rest,
  }
}

export type ModelSeed = { id: string; name: string } & Record<string, unknown>

// A connected `opencode` provider whose first model is the default.
export function provider(...models: ModelSeed[]) {
  const all = models.length ? models : [{ id: "test", name: "Test" }]
  return {
    all: [
      {
        id: "opencode",
        name: "OpenCode",
        models: Object.fromEntries(all.map((model) => [model.id, { limit: { context: 200_000 }, ...model }])),
      },
    ],
    connected: ["opencode"],
    default: { providerID: "opencode", modelID: all[0]!.id },
  }
}

export const NO_PROVIDER = { all: [], connected: [], default: {} }

// Pages oldest-first history the way the server does: newest `limit` items before the cursor.
export function pageMessagesFrom(messages: Record<string, SessionMessageInfo[]>) {
  return (sessionID: string, limit: number, before?: string) => {
    const items = messages[sessionID] ?? []
    const end = before
      ? Math.max(
          0,
          items.findIndex((message) => message.id === before),
        )
      : items.length
    const start = Math.max(0, end - limit)
    return { items: items.slice(start, end), cursor: start > 0 ? items[start]!.id : undefined }
  }
}

// Holds matching requests (never CORS preflights) until `release()`, then passes them to earlier routes such as the mock server.
export async function holdRoute(
  page: Page,
  url: string | RegExp | ((url: URL) => boolean),
  options: { method?: string } = {},
) {
  const released = Promise.withResolvers<void>()
  const arrived = Promise.withResolvers<Request>()
  const requests: Request[] = []
  await page.route(url, async (route) => {
    const method = route.request().method()
    if (method === "OPTIONS" || (options.method && method !== options.method)) return route.fallback()
    requests.push(route.request())
    arrived.resolve(route.request())
    await released.promise
    await route.fallback().catch(() => undefined)
  })
  return { requests, arrived: arrived.promise, release: () => released.resolve() }
}
