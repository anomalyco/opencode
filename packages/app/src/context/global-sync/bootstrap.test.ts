import { describe, expect, test } from "bun:test"
import { createStore } from "solid-js/store"
import { QueryClient } from "@tanstack/solid-query"
import type { Config, McpStatus, OpencodeClient, Project } from "@opencode-ai/sdk/v2/client"
import type { NormalizedProviderListResponse } from "@opencode-ai/ui/context"
import { bootstrapDirectory } from "./bootstrap"
import type { State, VcsCache } from "./types"

const provider = { all: new Map(), connected: [], default: {} } satisfies NormalizedProviderListResponse
const path = { state: "", config: "", worktree: "/project", directory: "/project", home: "/home" }

function createState(input?: { mcp?: Record<string, McpStatus>; command?: State["command"] }) {
  return createStore<State>({
    status: "loading",
    agent: [],
    command: input?.command ?? [],
    project: "",
    projectMeta: undefined,
    icon: undefined,
    provider_ready: true,
    provider,
    config: {},
    path,
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
    mcp: input?.mcp ?? {},
    lsp_ready: true,
    lsp: [],
    vcs: undefined,
    limit: 5,
    message: {},
    part: {},
    part_text_accum_delta: {},
  })
}

function createSdk(input?: { mcp?: Record<string, McpStatus>; command?: State["command"]; reads?: string[] }) {
  return {
    app: { agents: async () => ({ data: [{ name: "build", mode: "primary" }] }) },
    config: { get: async () => ({ data: {} }) },
    project: { current: async () => ({ data: { id: "project" } }) },
    session: { status: async () => ({ data: {} }) },
    vcs: { get: async () => ({ data: undefined }) },
    command: {
      list: async () => {
        input?.reads?.push("command")
        return { data: input?.command ?? [] }
      },
    },
    permission: { list: async () => ({ data: [] }) },
    question: { list: async () => ({ data: [] }) },
    mcp: {
      status: async () => {
        input?.reads?.push("status")
        return { data: input?.mcp ?? {} }
      },
    },
    provider: { list: async () => ({ data: { all: [], connected: [], default: {} } }) },
  } as unknown as OpencodeClient
}

async function bootstrap(input: {
  store: State
  setStore: ReturnType<typeof createState>[1]
  sdk: OpencodeClient
  mcp: boolean
}) {
  await bootstrapDirectory({
    directory: "/project",
    mcp: input.mcp,
    global: {
      config: {} satisfies Config,
      path,
      project: [{ id: "project", worktree: "/project" } as Project],
      provider,
    },
    sdk: input.sdk,
    store: input.store,
    setStore: input.setStore,
    vcsCache: { setStore() {} } as unknown as VcsCache,
    loadSessions() {},
    translate: (key) => key,
    queryClient: new QueryClient(),
  })
}

async function waitForComplete(store: State) {
  await new Promise((resolve) => setTimeout(resolve, 80))
  expect(store.status).toBe("complete")
}

describe("bootstrapDirectory", () => {
  test("marks a loading directory partial during bootstrap and complete after success", async () => {
    const mcpReads: string[] = []
    const [store, setStore] = createState()

    await bootstrap({
      store,
      setStore,
      mcp: false,
      sdk: createSdk({ reads: mcpReads }),
    })

    expect(store.status).toBe("partial")

    await waitForComplete(store)
    expect(mcpReads).toEqual([])
  })

  test("hydrates connected MCP status during MCP bootstrap", async () => {
    // given
    const [store, setStore] = createState()

    // when
    await bootstrap({
      store,
      setStore,
      mcp: true,
      sdk: createSdk({ mcp: { qa: { status: "connected" } } }),
    })
    await waitForComplete(store)

    // then
    expect(store.mcp).toEqual({ qa: { status: "connected" } })
  })

  test("clears stale MCP status when bootstrap returns no configured MCPs", async () => {
    // given
    const [store, setStore] = createState({ mcp: { stale: { status: "connected" } } })

    // when
    await bootstrap({
      store,
      setStore,
      mcp: true,
      sdk: createSdk({ mcp: {} }),
    })
    await waitForComplete(store)

    // then
    expect(store.mcp).toEqual({})
  })

  test("hydrates MCP status without dropping command results from the same bootstrap function", async () => {
    // given
    const [store, setStore] = createState()

    // when
    await bootstrap({
      store,
      setStore,
      mcp: true,
      sdk: createSdk({
        command: [{ name: "dev", template: "bun dev", hints: [] }],
        mcp: { qa: { status: "connected" } },
      }),
    })
    await waitForComplete(store)

    // then
    expect(store.command).toEqual([{ name: "dev", template: "bun dev", hints: [] }])
    expect(store.mcp).toEqual({ qa: { status: "connected" } })
  })
})
