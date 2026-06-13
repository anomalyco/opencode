import { describe, expect, test } from "bun:test"
import { createStore } from "solid-js/store"
import { QueryClient } from "@tanstack/solid-query"
import type { BackgroundTaskJob, Config, OpencodeClient, Project } from "@cedric/sdk/v2/client"
import type { NormalizedProviderListResponse } from "@cedric/ui/context"
import { bootstrapDirectory, loadPathQuery, loadProvidersQuery } from "./bootstrap"
import type { State, VcsCache } from "./types"
import { ServerScope } from "@/utils/server-scope"

const provider = { all: new Map(), connected: [], default: {} } satisfies NormalizedProviderListResponse

function testState() {
  return createStore<State>({
    status: "loading",
    agent: [],
    command: [],
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
    background_job: [],
    session_working(id: string) {
      return this.session_status[id]?.type !== "idle"
    },
    session_diff: {},
    todo: {},
    permission: {},
    question: {},
    mcp_ready: true,
    mcp: {},
    lsp_ready: true,
    lsp: [],
    vcs: undefined,
    limit: 5,
    message: {},
    part: {},
    part_text_accum_delta: {},
  })
}

function testClient(input?: {
  mcpReads?: string[]
  backgroundJobs?: BackgroundTaskJob[]
  backgroundJobRetry?: (input: { sessionID: string }) => Promise<{ data?: BackgroundTaskJob }>
}) {
  return {
    app: { agents: async () => ({ data: [{ name: "build", mode: "primary" }] }) },
    config: { get: async () => ({ data: {} }) },
    session: { status: async () => ({ data: {} }) },
    vcs: { get: async () => ({ data: undefined }) },
    command: {
      list: async () => {
        input?.mcpReads?.push("command")
        return { data: [] }
      },
    },
    permission: { list: async () => ({ data: [] }) },
    question: { list: async () => ({ data: [] }) },
    mcp: {
      status: async () => {
        input?.mcpReads?.push("status")
        return { data: {} }
      },
    },
    provider: { list: async () => ({ data: { all: [], connected: [], default: {} } }) },
    experimental: {
      session: {
        backgroundJobs: async () => ({ data: input?.backgroundJobs ?? [] }),
        backgroundJobRetry: input?.backgroundJobRetry ?? (async () => ({ data: undefined })),
      },
    },
  } as unknown as OpencodeClient
}

function bootstrapInput(input: {
  sdk: OpencodeClient
  store: State
  setStore: ReturnType<typeof testState>[1]
}) {
  return {
    directory: "/project",
    scope: ServerScope.local,
    mcp: false,
    global: {
      config: {} satisfies Config,
      path: { state: "", config: "", worktree: "/project", directory: "/project", home: "/home" },
      project: [{ id: "project", worktree: "/project" } as Project],
      provider,
    },
    sdk: input.sdk,
    store: input.store,
    setStore: input.setStore,
    vcsCache: { setStore() {} } as unknown as VcsCache,
    loadSessions() {},
    translate: (key: string) => key,
    queryClient: new QueryClient(),
  }
}

describe("bootstrapDirectory", () => {
  test("marks a loading directory partial during bootstrap and complete after success", async () => {
    const mcpReads: string[] = []
    const [store, setStore] = testState()

    await bootstrapDirectory(bootstrapInput({ sdk: testClient({ mcpReads }), store, setStore }))

    expect(store.status).toBe("partial")

    await new Promise((resolve) => setTimeout(resolve, 80))

    expect(store.status).toBe("complete")
    expect(mcpReads).toEqual([])
  })

  test("retries restart-orphaned background jobs during bootstrap", async () => {
    const [store, setStore] = testState()
    const retried: string[] = []
    const stopped = {
      id: "child",
      sessionID: "child",
      parentSessionID: "parent",
      status: "error",
      startedAt: 10,
      updatedAt: 20,
      completedAt: 20,
      retryable: true,
      error: "Background task stopped before completion because Cedric restarted.",
    } satisfies BackgroundTaskJob
    const running = {
      ...stopped,
      status: "running",
      updatedAt: 30,
      completedAt: undefined,
      retryable: undefined,
      error: undefined,
    } satisfies BackgroundTaskJob

    await bootstrapDirectory(
      bootstrapInput({
        sdk: testClient({
          backgroundJobs: [stopped],
          backgroundJobRetry: async (input) => {
            retried.push(input.sessionID)
            return { data: running }
          },
        }),
        store,
        setStore,
      }),
    )

    await new Promise((resolve) => setTimeout(resolve, 80))

    expect(retried).toEqual(["child"])
    expect(store.background_job).toMatchObject([{ id: "child", status: "running", updatedAt: 30 }])
  })
})

describe("query keys", () => {
  test("partitions identical directories by server scope", () => {
    const client = {} as OpencodeClient
    const remote = "https://debian.example" as typeof ServerScope.local

    expect([...loadPathQuery(ServerScope.local, "/repo", client).queryKey]).toEqual(["local", "/repo", "path"])
    expect([...loadPathQuery(remote, "/repo", client).queryKey]).toEqual(["https://debian.example", "/repo", "path"])
    expect([...loadProvidersQuery(remote, null, client).queryKey]).toEqual([
      "https://debian.example",
      null,
      "providers",
    ])
  })
})
