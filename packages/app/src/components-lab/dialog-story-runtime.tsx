import type { IntegrationInfo } from "@opencode/client/promise"
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query"
import type { ParentProps } from "solid-js"
import { LocalProvider } from "@/providers/models/selection"
import { ModelsProvider } from "@/providers/models/models"
import { PlatformProvider, type Platform } from "@/runtime/platform/platform"
import { PluginRoot } from "@/runtime/plugin/root"
import { ServerProvider } from "@/runtime/server/current"
import { GlobalProvider } from "@/runtime/server/runtime"
import { ServerConnection, ServersProvider } from "@/runtime/server/registry"
import { SettingsProvider } from "@/settings/model"
import { CommandProvider } from "@/shell/commands/command"
import { ProjectIconsProvider } from "@/shell/layout/project-icons"
import { TabsProvider } from "@/shell/tabs/tabs"
import { LocationProvider } from "@/workspaces/location"

const STORY_SERVER_URL = "http://localhost:0"

const STORY_UNAUTHORIZED_URL = "http://locked.opencode.local:4096"

const STORY_HOME = "/Users/alex"

export const STORY_DIRECTORY = "/Users/alex/work/opencode"

export const STORY_SERVER: ServerConnection.Http = {
  type: "http",
  displayName: "This computer",
  http: { url: STORY_SERVER_URL },
}

export const STORY_LOCKED_SERVER: ServerConnection.Http = {
  type: "http",
  displayName: "Staging server",
  http: { url: STORY_UNAUTHORIZED_URL },
}

type DirectoryEntry = {
  name: string
  type: "file" | "directory"
}

const directoryTree = {
  "/": [{ name: "Users", type: "directory" }],
  "/Users": [{ name: "alex", type: "directory" }],
  [STORY_HOME]: [
    { name: "work", type: "directory" },
    { name: "notes", type: "directory" },
  ],
  "/Users/alex/work": [
    { name: "opencode", type: "directory" },
    { name: "docs", type: "directory" },
    { name: "website", type: "directory" },
  ],
  [STORY_DIRECTORY]: [
    { name: ".git", type: "directory" },
    { name: "apps", type: "directory" },
    { name: "docs", type: "directory" },
    { name: "packages", type: "directory" },
    { name: "package.json", type: "file" },
    { name: "README.md", type: "file" },
  ],
  [`${STORY_DIRECTORY}/apps`]: [
    { name: "desktop", type: "directory" },
    { name: "web", type: "directory" },
  ],
  [`${STORY_DIRECTORY}/docs`]: [
    { name: "architecture.md", type: "file" },
    { name: "dialogs.md", type: "file" },
  ],
  [`${STORY_DIRECTORY}/packages`]: [
    { name: "app", type: "directory" },
    { name: "core", type: "directory" },
    { name: "ui", type: "directory" },
  ],
  "/Users/alex/work/docs": [
    { name: ".git", type: "directory" },
    { name: "guides", type: "directory" },
  ],
  "/Users/alex/work/website": [
    { name: ".git", type: "directory" },
    { name: "src", type: "directory" },
  ],
} satisfies Record<string, DirectoryEntry[]>

export const STORY_PROJECTS = [
  {
    id: "prj_opencode",
    worktree: STORY_DIRECTORY,
    canonical: STORY_DIRECTORY,
    name: "opencode",
    vcs: "git" as const,
    sandboxes: ["/Users/alex/work/opencode-dialogs"],
    time: { created: Date.UTC(2026, 8, 1), updated: Date.UTC(2026, 9, 28), active: Date.UTC(2026, 9, 28) },
  },
  {
    id: "prj_docs",
    worktree: "/Users/alex/work/docs",
    canonical: "/Users/alex/work/docs",
    name: "docs",
    vcs: "git" as const,
    sandboxes: [],
    time: { created: Date.UTC(2026, 8, 5), updated: Date.UTC(2026, 9, 20), active: Date.UTC(2026, 9, 20) },
  },
  {
    id: "prj_website",
    worktree: "/Users/alex/work/website",
    canonical: "/Users/alex/work/website",
    name: "website",
    vcs: "git" as const,
    sandboxes: [],
    time: { created: Date.UTC(2026, 8, 10), updated: Date.UTC(2026, 9, 15), active: Date.UTC(2026, 9, 15) },
  },
]

const defaultProviders = [
  { id: "opencode-go", name: "OpenCode Go", package: "opencode-go", activation: "enabled" },
  { id: "opencode", name: "OpenCode Zen", package: "opencode", activation: "enabled" },
  { id: "anthropic", name: "Anthropic", package: "anthropic", activation: "enabled" },
]

const releasedRecent = Date.UTC(2026, 9, 1)

const releasedOlder = Date.UTC(2025, 1, 1)

function modelRecord(input: {
  id: string
  providerID: string
  name: string
  inputCost: number
  outputCost: number
  released?: number
  variants?: string[]
}) {
  return {
    id: input.id,
    modelID: input.id,
    providerID: input.providerID,
    name: input.name,
    capabilities: { tools: true, reasoning: true, input: ["text", "image"], output: ["text"] },
    variants: (input.variants ?? []).map((id) => ({ id, settings: {} })),
    time: { released: input.released ?? releasedRecent },
    cost: [{ input: input.inputCost, output: input.outputCost, cache: { read: 0, write: 0 } }],
    status: "active",
    enabled: true,
    limit: { context: 200_000, output: 64_000 },
  }
}

const defaultModels = [
  modelRecord({
    id: "deepseek-v4-pro",
    providerID: "opencode-go",
    name: "DeepSeek V4 Pro",
    inputCost: 1,
    outputCost: 3,
    released: releasedOlder,
  }),
  modelRecord({
    id: "glm-5",
    providerID: "opencode-go",
    name: "GLM-5",
    inputCost: 1,
    outputCost: 2,
    released: releasedOlder,
  }),
  modelRecord({
    id: "kimi-k3",
    providerID: "opencode-go",
    name: "Kimi K3",
    inputCost: 1,
    outputCost: 3,
    variants: ["fast", "thinking"],
  }),
  modelRecord({
    id: "big-pickle",
    providerID: "opencode",
    name: "Big Pickle",
    inputCost: 0,
    outputCost: 0,
  }),
  modelRecord({
    id: "claude-opus-5-5",
    providerID: "opencode",
    name: "Claude Opus 5.5",
    inputCost: 5,
    outputCost: 25,
    variants: ["high", "max"],
  }),
  modelRecord({
    id: "gpt-5-6",
    providerID: "opencode",
    name: "GPT-5.6",
    inputCost: 2.5,
    outputCost: 10,
    released: releasedOlder,
  }),
  modelRecord({
    id: "claude-sonnet-5",
    providerID: "anthropic",
    name: "Claude Sonnet 5",
    inputCost: 3,
    outputCost: 15,
    variants: ["thinking"],
  }),
]

const integrations = [
  {
    id: "anthropic",
    name: "Anthropic",
    methods: [{ type: "key", label: "API key" }],
    connections: [
      {
        type: "credential",
        id: "cred_anthropic_work",
        method: "key",
        label: "Work account",
      },
    ],
  },
  {
    id: "opencode",
    name: "OpenCode Console",
    methods: [
      { type: "oauth", id: "console", label: "OpenCode Console account" },
      { type: "key", label: "API key (service account)" },
    ],
    connections: [],
  },
  {
    id: "opencode-go",
    name: "OpenCode Go",
    methods: [{ type: "oauth", id: "go", label: "Sign in with OpenCode" }],
    connections: [],
  },
  {
    id: "openai",
    name: "OpenAI",
    methods: [
      { type: "oauth", id: "chatgpt", label: "ChatGPT Plus / Pro" },
      { type: "key", label: "API key" },
    ],
    connections: [],
  },
  {
    id: "github-copilot",
    name: "GitHub Copilot",
    methods: [{ type: "oauth", id: "copilot", label: "Sign in with GitHub" }],
    connections: [],
  },
  {
    id: "google",
    name: "Google",
    methods: [{ type: "key", label: "API key" }],
    connections: [],
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    methods: [{ type: "key", label: "API key" }],
    connections: [],
  },
] satisfies IntegrationInfo[]

function jsonResponse<T>(body: T, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function errorResponse(tag: string, message: string, status: number) {
  // SAFETY: the server's HTTP wire body for a tagged error, decoded at the OpenCode client boundary.
  // oxlint-disable-next-line anti-slop-effect/no-manual-tagged-construction -- see SAFETY above
  return jsonResponse({ _tag: tag, message }, status)
}

function noContentResponse() {
  return new Response(null, { status: 204 })
}

function locationEnvelope(directory: string) {
  const project =
    STORY_PROJECTS.find(
      (item) =>
        directory === item.worktree || directory.startsWith(`${item.worktree}/`) || item.sandboxes.includes(directory),
    ) ?? STORY_PROJECTS[0]

  return {
    directory,
    project: {
      id: project.id,
      directory: project.worktree,
      canonical: project.canonical,
    },
  }
}

const directoryEntries = new Map<string, DirectoryEntry[]>(Object.entries(directoryTree))

function listDirectoryEntries(root: string, path: string) {
  const clean = path === "/" ? "/" : path.replace(/\/+$/, "")

  const items = directoryEntries.get(clean)

  if (!items) return undefined
  const base = root === "/" ? "" : root.replace(/\/+$/, "")

  return items.map((entry) => {
    const absolute = clean === "/" ? `/${entry.name}` : `${clean}/${entry.name}`

    const relative = base && absolute.startsWith(`${base}/`) ? absolute.slice(base.length + 1) : absolute

    return {
      name: entry.name,
      path: relative,
      absolute,
      type: entry.type,
      ignored: false,
    }
  })
}

function findMatchingPaths(root: string, query: string, type: string | null) {
  const text = query.trim().toLowerCase()

  const base = root === "/" ? "" : root.replace(/\/+$/, "")

  return [...directoryEntries.entries()].flatMap(([parent, entries]) =>
    entries.flatMap((entry) => {
      if (entry.name === ".git") return []

      if (type && entry.type !== type) return []
      const absolute = parent === "/" ? `/${entry.name}` : `${parent}/${entry.name}`

      if (base && !absolute.startsWith(`${base}/`)) return []
      const relative = base ? absolute.slice(base.length + 1) : absolute.slice(1)

      if (text && !relative.toLowerCase().includes(text) && !entry.name.toLowerCase().includes(text)) return []

      return [
        {
          name: entry.name,
          path: relative,
          absolute,
          type: entry.type,
          ignored: false,
        },
      ]
    }),
  )
}

type DialogStoryRuntimeOptions = {
  servers?: ServerConnection.Any[]
}

function createStoryFetch(): typeof fetch {
  const encoder = new TextEncoder()

  const handler = async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = input instanceof Request ? input.url : input

    const url = new URL(raw, STORY_SERVER_URL)

    if (url.origin === new URL(STORY_UNAUTHORIZED_URL).origin) {
      return errorResponse("UnauthorizedError", "Authentication required", 401)
    }

    const directory =
      url.searchParams.get("location[directory]") ?? url.searchParams.get("directory") ?? STORY_DIRECTORY

    const location = locationEnvelope(directory)

    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase()

    const pathname = url.pathname

    if (pathname === "/api/event") {
      const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined)

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ id: "evt_story_1", type: "server.connected", data: {} })}\n\n`),
          )

          signal?.addEventListener("abort", () => controller.error(signal.reason), { once: true })
        },
      })

      return new Response(stream, {
        status: 200,
        headers: { "cache-control": "no-cache", "content-type": "text/event-stream" },
      })
    }

    if (pathname === "/api/info") {
      return jsonResponse({
        version: "2.0.0",
        pid: 1,
        hostname: "MacBook-Pro",
        urls: [STORY_SERVER_URL],
        paths: { tmp: "/tmp/opencode" },
      })
    }

    if (pathname === "/api/location") return jsonResponse(location)

    if (pathname === "/api/project") return jsonResponse(STORY_PROJECTS)

    if (pathname === "/api/worktree") {
      const projectID = url.searchParams.get("projectID")

      const project = STORY_PROJECTS.find((item) => item.id === projectID) ?? STORY_PROJECTS[0]

      return jsonResponse([
        { directory: project.worktree },
        ...project.sandboxes.map((sandbox) => ({ directory: sandbox, strategy: "git" })),
      ])
    }

    if (pathname === "/api/worktree/refresh") return noContentResponse()

    if (pathname === "/api/fs/list") {
      const path = url.searchParams.get("path") ?? directory

      const items = listDirectoryEntries(directory, path)

      if (!items) return errorResponse("NotFoundError", `Directory not found: ${path}`, 404)

      return jsonResponse({ location, data: items })
    }

    if (pathname === "/api/fs/find") {
      const query = url.searchParams.get("query") ?? ""

      const type = url.searchParams.get("type")

      return jsonResponse({ location, data: findMatchingPaths(directory, query, type) })
    }

    if (pathname === "/api/provider") return jsonResponse({ location, data: defaultProviders })

    if (pathname === "/api/model") return jsonResponse({ location, data: defaultModels })

    if (pathname === "/api/model/default") {
      return jsonResponse({ location, data: defaultModels.find((item) => item.id === "claude-opus-5-5") ?? null })
    }

    if (pathname === "/api/integration") return jsonResponse({ location, data: integrations })

    if (pathname.startsWith("/api/integration/")) {
      const rest = pathname.slice("/api/integration/".length).split("/")

      const integrationID = decodeURIComponent(rest[0] ?? "")

      if (rest.length === 1 && method === "GET") {
        const found = integrations.find((item) => item.id === integrationID) ?? {
          id: integrationID,
          name: integrationID,
          methods: [{ type: "key" as const, label: "API key" }],
          connections: [],
        }

        return jsonResponse({ location, data: found })
      }

      if (rest[1] === "connect" && rest[2] === "key" && method === "POST") return noContentResponse()

      if (rest[1] === "connect" && rest[2] === "oauth" && rest.length === 3 && method === "POST") {
        const now = Date.now()

        return jsonResponse({
          location,
          data: {
            attemptID: "con_story_1",
            url: "https://opencode.ai/auth/authorize",
            instructions: "",
            mode: "auto",
            time: { created: now, expires: now + 600_000 },
          },
        })
      }

      if (rest[1] === "connect" && rest[2] === "oauth" && rest[3] && method === "GET") {
        const now = Date.now()

        return jsonResponse({
          location,
          data: { status: "pending", time: { created: now, expires: now + 600_000 } },
        })
      }

      return noContentResponse()
    }

    if (pathname.startsWith("/api/credential/")) return noContentResponse()

    if (pathname === "/api/experimental/usage/limits") {
      return jsonResponse({ location, data: null })
    }

    if (pathname === "/api/agent") {
      return jsonResponse({
        location,
        data: [
          {
            id: "build",
            name: "Build",
            mode: "primary",
            hidden: false,
            request: { settings: {}, headers: {}, body: {} },
            permissions: [],
          },
        ],
      })
    }

    if (pathname === "/api/vcs") {
      return jsonResponse({ location, data: { branch: { current: "main", default: "main" } } })
    }

    if (pathname === "/api/vcs/branch") return jsonResponse({ location, data: ["main"] })

    if (pathname === "/api/session") {
      return jsonResponse({ data: [], cursor: {} })
    }

    if (pathname === "/api/session/active") return jsonResponse({ data: {} })

    if (pathname === "/api/config" || pathname === "/api/config/shell") return jsonResponse([])

    if (pathname === "/api/mcp/resource") return jsonResponse({ location, data: { resources: [], templates: [] } })

    if (pathname.startsWith("/api/experimental/media/")) return new Response(null, { status: 404 })

    return jsonResponse({ location, data: [] })
  }

  return Object.assign(handler, { preconnect: globalThis.fetch.preconnect })
}

function createMemoryStorage() {
  const namespaces = new Map<string, Map<string, string>>()

  const bucket = (name = "default") => {
    const existing = namespaces.get(name)

    if (existing) return existing
    const created = new Map<string, string>()
    namespaces.set(name, created)

    return created
  }

  return (name?: string) => {
    const store = bucket(name)

    return {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value)
      },
      removeItem: (key: string) => {
        store.delete(key)
      },
    }
  }
}

// Keep previews off the user's server and persistent storage, including in the in-app lab.
export function DialogStoryRuntime(props: ParentProps<DialogStoryRuntimeOptions>) {
  const servers = () => props.servers ?? [STORY_SERVER]

  const storage = createMemoryStorage()

  const platform: Platform = {
    platform: "web",
    openExternal() {},
    restart: async () => {},
    notify: async () => {},
    storage,
    fetch: createStoryFetch(),
  }

  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnReconnect: false,
        refetchOnWindowFocus: false,
      },
      mutations: { retry: false },
    },
  })

  return (
    <PlatformProvider value={platform}>
      <QueryClientProvider client={client}>
        <PluginRoot>
          <ServersProvider canonicalLocalServer={ServerConnection.key(STORY_SERVER)} servers={servers()}>
            <SettingsProvider>
              <TabsProvider>
                <GlobalProvider>
                  <ProjectIconsProvider>
                    <CommandProvider>
                      <ServerProvider conn={servers()[0] ?? STORY_SERVER}>
                        <ModelsProvider directory={STORY_DIRECTORY}>
                          <LocationProvider directory={STORY_DIRECTORY}>
                            <LocalProvider>{props.children}</LocalProvider>
                          </LocationProvider>
                        </ModelsProvider>
                      </ServerProvider>
                    </CommandProvider>
                  </ProjectIconsProvider>
                </GlobalProvider>
              </TabsProvider>
            </SettingsProvider>
          </ServersProvider>
        </PluginRoot>
      </QueryClientProvider>
    </PlatformProvider>
  )
}
