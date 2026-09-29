import { describe, expect, test } from "bun:test"
import { createStore } from "solid-js/store"
import { QueryClient } from "@tanstack/solid-query"
import type { Config, OpencodeClient, Project } from "@opencode-ai/sdk/v2/client"
import type {
  AgentApi,
  AgentListOutput,
  CatalogApi,
  CommandApi,
  CommandListOutput,
  ReferenceApi,
} from "@opencode-ai/client/promise"
import type { NormalizedProviderListResponse } from "@opencode-ai/session-ui/context"
import {
  bootstrapDirectory,
  loadAgentsQuery,
  loadCommands,
  loadConfigResources,
  loadGlobalConfigQuery,
  loadPathQuery,
  loadProjectsQuery,
  loadProvidersQuery,
  loadReferencesQuery,
} from "./bootstrap"
import type { State, VcsCache } from "./types"
import { ServerScope } from "@/utils/server-scope"
import type { ServerApi } from "@/utils/server"

type ProjectApi = ServerApi["project"]

const provider = { all: new Map(), connected: [], default: {} } satisfies NormalizedProviderListResponse
const api = {
  agent: { list: async () => ({ location: {}, data: [] }) },
  provider: { list: async () => ({ location: {}, data: [] }) },
  model: {
    list: async () => ({ location: {}, data: [] }),
    default: async () => ({ location: {}, data: null }),
  },
  permission: { request: { list: async () => ({ location: {}, data: [] }) } },
  project: {
    list: async () => [],
    current: async () => ({ id: "project", directory: "/project" }),
  },
  question: { request: { list: async () => ({ location: {}, data: [] }) } },
  reference: { list: async () => ({ location: {}, data: [] }) },
  vcs: { get: async () => ({ location: {}, data: {} }) },
} as unknown as ServerApi

function directoryState() {
  return createStore<State>({
    status: "loading",
    agent: [],
    command: [],
    reference: [],
    project: "",
    projectMeta: undefined,
    icon: undefined,
    provider_ready: true,
    provider,
    config: {},
    path: { state: "", config: "", worktree: "/project", directory: "/project", home: "/home" },
    session: [],
    sessionTotal: 0,
    session_status: {},
    session_working(id: string) {
      return this.session_status[id]?.type !== "idle"
    },
    session_diff: {},
    todo: {},
    permission: {},
    question: {},
    mcp_ready: true,
    mcp: {},
    mcp_resource: {},
    lsp_ready: true,
    lsp: [],
    vcs: undefined,
    limit: 5,
    message: {},
    session_message: {},
    part: {},
    part_text_accum_delta: {},
  })
}

describe("loadConfigResources", () => {
  const location = { directory: "/project", project: { id: "project", directory: "/project" } }

  test("a concurrent ordinary load joins a refresh instead of restoring cached agents", async () => {
    const [store, setStore] = directoryState()
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } })
    queryClient.setQueryData([ServerScope.local, "/project", "agents"], [{ name: "old-agent" }])
    const updated = Promise.withResolvers<AgentListOutput>()
    const started = Promise.withResolvers<void>()
    const input = {
      scope: ServerScope.local,
      directory: "/project",
      api: {
        agent: {
          list: () => {
            started.resolve()
            return updated.promise
          },
        },
        command: { list: async () => ({ location, data: [] }) },
      },
      protocol: Promise.resolve("v2" as const),
      queryClient,
      setStore,
    }
    const refresh = loadConfigResources({ ...input, refresh: true })
    await started.promise
    const ordinary = loadConfigResources(input)
    updated.resolve({ location, data: [] })
    await Promise.all([refresh, ordinary])
    expect(store.agent).toEqual([])
    queryClient.clear()
  })

  test("clears an invalid catalog rather than leaving stale selectable entries", async () => {
    const [store, setStore] = directoryState()
    setStore("agent", [{ name: "old-agent", mode: "subagent", options: {}, permission: [] }])
    setStore("command", [{ name: "deleted-command", template: "Old template" }])
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    await expect(
      loadConfigResources({
        scope: ServerScope.local,
        directory: "/project",
        api: {
          agent: {
            list: async () => {
              throw new Error("Invalid workspace configuration")
            },
          },
          command: { list: async () => ({ location, data: [] }) },
        },
        protocol: Promise.resolve("v2"),
        queryClient,
        setStore,
        refresh: true,
      }),
    ).rejects.toThrow("Invalid workspace configuration")
    expect(store.agent).toEqual([])
    expect(store.command).toEqual([])
    queryClient.clear()
  })

  test("an older in-flight catalog load cannot overwrite a newer configuration revision", async () => {
    const [store, setStore] = directoryState()
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } })
    queryClient.setQueryData([ServerScope.local, "/project", "agents"], [])
    const old = Promise.withResolvers<CommandListOutput>()
    const started = Promise.withResolvers<void>()
    const input = {
      scope: ServerScope.local,
      directory: "/project",
      protocol: Promise.resolve("v2" as const),
      queryClient,
      setStore,
    }
    const pending = loadConfigResources({
      ...input,
      api: {
        agent: { list: async () => ({ location, data: [] }) },
        command: {
          list: () => {
            started.resolve()
            return old.promise
          },
        },
      },
    })
    await started.promise
    await loadConfigResources({
      ...input,
      api: {
        agent: { list: async () => ({ location, data: [] }) },
        command: { list: async () => ({ location, data: [] }) },
      },
      refresh: true,
    })
    old.resolve({ location, data: [{ name: "deleted-command", template: "Old template" }] })
    await pending
    expect(store.command).toEqual([])
    queryClient.clear()
  })

  test("refreshes a cached agent catalog when workspace configuration changes", async () => {
    const [store, setStore] = directoryState()
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } })
    const calls: string[] = []
    queryClient.setQueryData([ServerScope.local, "/project", "agents"], [{ name: "old-agent" }])
    await loadConfigResources({
      scope: ServerScope.local,
      directory: "/project",
      api: {
        agent: {
          list: async () => {
            calls.push("agents")
            return { location, data: [] }
          },
        },
        command: {
          list: async () => {
            calls.push("commands")
            return { location, data: [] }
          },
        },
      },
      protocol: Promise.resolve("v2"),
      queryClient,
      setStore,
      refresh: true,
    })
    expect(store.agent).toEqual([])
    expect(calls.sort()).toEqual(["agents", "commands"])
    queryClient.clear()
  })
})

describe("bootstrapDirectory", () => {
  test("uses legacy MCP endpoints while refreshing a v1 directory", async () => {
    const legacyConfigReads: string[] = []
    const mcpReads: string[] = []
    const [store, setStore] = directoryState()

    await bootstrapDirectory({
      directory: "/project",
      scope: ServerScope.local,
      mcp: true,
      global: {
        config: {} satisfies Config,
        path: { state: "", config: "", worktree: "/project", directory: "/project", home: "/home" },
        project: [{ id: "project", worktree: "/project" } as Project],
        provider,
      },
      sdk: {
        app: { agents: async () => ({ data: [{ name: "build", mode: "primary" }] }) },
        config: {
          get: async () => {
            legacyConfigReads.push("directory")
            return { data: {} }
          },
        },
        session: { status: async () => ({ data: {} }) },
        vcs: { get: async () => ({ data: undefined }) },
        command: {
          list: async () => {
            mcpReads.push("command")
            return { data: [] }
          },
        },
        permission: { list: async () => ({ data: [] }) },
        question: { list: async () => ({ data: [] }) },
        v2: { reference: { list: async () => ({ data: { data: [] } }) } },
        mcp: {
          status: async () => {
            mcpReads.push("status")
            return { data: {} }
          },
        },
        experimental: {
          resource: {
            list: async () => {
              mcpReads.push("resource")
              return { data: {} }
            },
          },
        },
        provider: { list: async () => ({ data: { all: [], connected: [], default: {} } }) },
      } as unknown as OpencodeClient,
      api,
      store,
      setStore,
      vcsCache: { setStore() {} } as unknown as VcsCache,
      loadSessions() {},
      translate: (key) => key,
      queryClient: new QueryClient(),
      protocol: Promise.resolve("v1"),
    })

    expect(store.status).toBe("partial")

    await new Promise((resolve) => setTimeout(resolve, 80))

    expect(store.status).toBe("complete")
    expect(legacyConfigReads).toEqual(["directory"])
    expect(mcpReads.sort()).toEqual(["command", "resource", "status"])
  })

  test("skips legacy config while refreshing a v2 directory", async () => {
    const [store, setStore] = directoryState()

    await bootstrapDirectory({
      directory: "/project",
      scope: ServerScope.local,
      mcp: false,
      global: {
        config: {} satisfies Config,
        path: { state: "", config: "", worktree: "/project", directory: "/project", home: "/home" },
        project: [{ id: "project", worktree: "/project" } as Project],
        provider,
      },
      sdk: {
        config: {
          get: async () => {
            throw new Error("legacy directory config should not be called")
          },
        },
      } as unknown as OpencodeClient,
      api,
      store,
      setStore,
      vcsCache: { setStore() {} } as unknown as VcsCache,
      loadSessions() {},
      translate: (key) => key,
      queryClient: new QueryClient(),
      protocol: Promise.resolve("v2"),
    })

    expect(store.status).toBe("partial")

    await new Promise((resolve) => setTimeout(resolve, 80))

    expect(store.status).toBe("complete")
  })
})

describe("config queries", () => {
  test("skips legacy global config for v2 servers", async () => {
    const sdk = {
      global: {
        config: {
          get: async () => {
            throw new Error("legacy global config should not be called")
          },
        },
      },
    } as unknown as OpencodeClient

    const result = await new QueryClient().fetchQuery(
      loadGlobalConfigQuery(ServerScope.local, sdk, Promise.resolve("v2")),
    )

    expect(result).toEqual({})
  })

  test("loads legacy global config for v1 servers", async () => {
    const calls: string[] = []
    const config = { shell: "zsh" } satisfies Config
    const sdk = {
      global: {
        config: {
          get: async () => {
            calls.push("global")
            return { data: config }
          },
        },
      },
    } as unknown as OpencodeClient

    const result = await new QueryClient().fetchQuery(
      loadGlobalConfigQuery(ServerScope.local, sdk, Promise.resolve("v1")),
    )

    expect(result).toEqual(config)
    expect(calls).toEqual(["global"])
  })
})

describe("query keys", () => {
  test("partitions identical directories by server scope", () => {
    const client = {} as Parameters<typeof loadPathQuery>[2]
    const api = {} as CatalogApi
    const remote = "https://debian.example" as typeof ServerScope.local

    expect([...loadPathQuery(ServerScope.local, "/repo", client).queryKey]).toEqual(["local", "/repo", "path"])
    expect([...loadPathQuery(remote, "/repo", client).queryKey]).toEqual(["https://debian.example", "/repo", "path"])
    expect([...loadProvidersQuery(remote, null, api).queryKey]).toEqual(["https://debian.example", null, "providers"])
  })

  test("loads the current provider and model catalog", async () => {
    const calls: unknown[] = []
    const api = {
      provider: {
        list: async (input: unknown) => {
          calls.push(["provider", input])
          return { location: {}, data: [{ id: "openai", name: "OpenAI", package: "@ai-sdk/openai" }] }
        },
      },
      model: {
        list: async (input: unknown) => {
          calls.push(["model", input])
          return { location: {}, data: [] }
        },
        default: async (input: unknown) => {
          calls.push(["default", input])
          return { location: {}, data: null }
        },
      },
    } as unknown as CatalogApi

    const result = await new QueryClient().fetchQuery(loadProvidersQuery(ServerScope.local, "/repo", api))

    expect(calls).toEqual([
      ["provider", { location: { directory: "/repo" } }],
      ["model", { location: { directory: "/repo" } }],
      ["default", { location: { directory: "/repo" } }],
    ])
    expect(result.connected).toEqual(["openai"])
  })

  test("loads agents from the current location-scoped endpoint", async () => {
    const calls: unknown[] = []
    const api = {
      list: async (input: unknown) => {
        calls.push(input)
        return { location: {}, data: [] }
      },
    } as unknown as AgentApi

    const result = await new QueryClient().fetchQuery(loadAgentsQuery(ServerScope.local, "/repo", api))

    expect(calls).toEqual([{ location: { directory: "/repo" } }])
    expect(result).toEqual([])
  })

  test("preserves the complete model ID in legacy command catalogs", async () => {
    const result = await loadCommands(
      "/project",
      {
        list: async () => ({
          location: { directory: "/project", project: { id: "project", directory: "/project" } },
          data: [],
        }),
      },
      {
        command: {
          list: async () => ({
            data: [{ name: "design", template: "Design the scene", model: "test/vendor/model-b" }],
          }),
        },
      } as unknown as OpencodeClient,
      Promise.resolve("v1"),
    )
    expect(result[0].model).toEqual({ providerID: "test", id: "vendor/model-b" })
  })

  test("loads commands from the current location-scoped endpoint", async () => {
    const calls: unknown[] = []
    const api = {
      list: async (input: unknown) => {
        calls.push(input)
        return {
          location: {},
          data: [{ name: "review", template: "Review files" /* source: "command" as const */ }],
        }
      },
    } as unknown as CommandApi

    const result = await loadCommands("/repo", api)

    expect(calls).toEqual([{ location: { directory: "/repo" } }])
    expect(result).toEqual([{ name: "review", template: "Review files" /* source: "command" */ }])
  })

  test("loads projects from the current endpoint", async () => {
    const api = {
      list: async () => [
        { id: "b", worktree: "/b", time: { created: 1, updated: 1 }, sandboxes: [] },
        { id: "a", worktree: "/a", time: { created: 1, updated: 1 }, sandboxes: [] },
      ],
    } as unknown as ProjectApi

    const result = await new QueryClient().fetchQuery(loadProjectsQuery(ServerScope.local, api))

    expect(result.map((project) => project.id)).toEqual(["a", "b"])
  })

  test("loads references from the current location-scoped endpoint", async () => {
    const calls: unknown[] = []
    const api = {
      list: async (input: unknown) => {
        calls.push(input)
        return { location: {}, data: [{ name: "AGENTS.md", path: "/repo/AGENTS.md", source: "instructions" }] }
      },
    } as unknown as ReferenceApi

    const result = await new QueryClient().fetchQuery(loadReferencesQuery(ServerScope.local, "/repo", api))

    expect(calls).toEqual([{ location: { directory: "/repo" } }])
    expect(result).toHaveLength(1)
  })
})
