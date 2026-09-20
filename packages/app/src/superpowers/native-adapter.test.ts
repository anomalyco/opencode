import { expect, test } from "bun:test"
import type { OpenCodeClient } from "@opencode/client/promise"
import { ServerConnection } from "@/runtime/server/registry"
import { sessionHref } from "@/shell/routes/session"
import { scopeKey } from "./identity"
import {
  createNativeBoundary,
  createNativeExecutionAdapter,
  nativeState,
  type NativeBoundary,
  type NativeDetail,
  type NativeScope,
  type NativeSessionInfo,
} from "./native-adapter"
import type { NativeRecord } from "./native-types"

type FakePage = { data: NativeSessionInfo[]; next?: string }

const sessionInfo = (id: string, overrides: Partial<NativeSessionInfo> = {}): NativeSessionInfo => ({
  id,
  title: id,
  directory: "/root/git/demo",
  ...overrides,
})

const apiSession = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  title: id,
  location: { directory: "/root/git/demo" },
  ...overrides,
})

const scope = (overrides: Partial<NativeScope> = {}): NativeScope => ({
  serverKey: ServerConnection.Key.make("wsl:Ubuntu"),
  ownerDirectory: "/root/git/demo",
  rootSessionID: "root",
  ...overrides,
})

const target = (overrides: Partial<{ scope: NativeScope; selectedSessionID: string }> = {}) => ({
  scope: scope(),
  selectedSessionID: "grandchild",
  ...overrides,
})

const baseDetails = () =>
  new Map<string, NativeSessionInfo>([
    ["root", sessionInfo("root", { title: "Root controller", model: { id: "gpt-5-codex", providerID: "openai" } })],
    [
      "child",
      sessionInfo("child", {
        parentID: "root",
        title: "Child implementer",
        directory: "/root/git/demo/.worktrees/feature",
      }),
    ],
    [
      "idle-child",
      sessionInfo("idle-child", {
        parentID: "root",
        title: "Idle reviewer",
        model: { id: "claude-sonnet-4", providerID: "anthropic" },
      }),
    ],
    [
      "grandchild",
      sessionInfo("grandchild", {
        parentID: "child",
        title: "Grandchild worker",
        directory: "/root/git/demo/.worktrees/feature",
      }),
    ],
  ])

const basePages = () =>
  new Map<string, FakePage[]>([
    [
      "root",
      [
        {
          data: [sessionInfo("child", { parentID: "root" }), sessionInfo("idle-child", { parentID: "root" })],
        },
      ],
    ],
    ["child", [{ data: [sessionInfo("grandchild", { parentID: "child" })] }]],
  ])

function fakeBoundary(input: {
  details: Map<string, NativeSessionInfo>
  pages?: Map<string, FakePage[]>
  active?: Record<string, { type: "running" }>
  needsInput?: Set<string>
}) {
  const state = { current: 0, max: 0 }
  const calls: string[] = []
  const track = async <Value>(run: () => Promise<Value>): Promise<Value> => {
    state.current += 1
    state.max = Math.max(state.max, state.current)
    try {
      return await run()
    } finally {
      state.current -= 1
    }
  }
  const boundary: NativeBoundary = {
    detail: ({ sessionID }) =>
      track(async () => {
        calls.push(`detail:${sessionID}`)
        const info = input.details.get(sessionID)
        if (!info) throw new Error(`session not found: ${sessionID}`)
        return { info, needsInput: input.needsInput?.has(sessionID) ?? false }
      }),
    children: ({ sessionID, cursor }) =>
      track(async () => {
        calls.push(`children:${sessionID}:${cursor ?? ""}`)
        const pages = input.pages?.get(sessionID) ?? []
        return pages[cursor ? Number(cursor) : 0] ?? { data: [] }
      }),
    active: () =>
      track(async () => {
        calls.push("active")
        return input.active ?? {}
      }),
  }
  return { boundary, state, calls }
}

function deferred<Value>() {
  let resolve!: (value: Value) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<Value>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

async function waitFor(condition: () => boolean) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (condition()) return
    await new Promise((resolve) => setTimeout(resolve, 1))
  }
  throw new Error("condition was not reached")
}

test("a grandchild hydrates its real root and keeps idle distinct from completion", async () => {
  const fake = fakeBoundary({ details: baseDetails(), pages: basePages(), active: { root: { type: "running" } } })
  const adapter = createNativeExecutionAdapter({ target: () => target(), boundary: fake.boundary })
  const snapshot = await adapter.hydrate()
  expect(snapshot.scope.serverKey).toBe(ServerConnection.Key.make("wsl:Ubuntu"))
  expect(snapshot.scope.ownerDirectory).toBe("/root/git/demo")
  expect(snapshot.scope.rootSessionID).toBe("root")
  expect(snapshot.rootSessionID).toBe("root")
  expect(snapshot.nodes.map((node) => node.id)).toEqual(["root", "child", "idle-child", "grandchild"])
  expect(snapshot.nodes.find((node) => node.id === "root")?.status).toBe("running")
  expect(snapshot.nodes.find((node) => node.id === "idle-child")?.status).toBe("idle")
  expect(snapshot.complete).toBe(true)
})

test("every child page is enumerated instead of only the first", async () => {
  const details = new Map<string, NativeSessionInfo>([
    ["root", sessionInfo("root")],
    ["child-a", sessionInfo("child-a", { parentID: "root" })],
    ["child-b", sessionInfo("child-b", { parentID: "root" })],
  ])
  const pages = new Map<string, FakePage[]>([
    [
      "root",
      [
        { data: [sessionInfo("child-a", { parentID: "root" })], next: "1" },
        { data: [sessionInfo("child-b", { parentID: "root" })] },
      ],
    ],
  ])
  const fake = fakeBoundary({ details, pages })
  const adapter = createNativeExecutionAdapter({
    target: () => target({ selectedSessionID: "root" }),
    boundary: fake.boundary,
  })
  const snapshot = await adapter.hydrate()
  expect(snapshot.nodes.map((node) => node.id)).toEqual(["root", "child-a", "child-b"])
  expect(fake.calls).toContain("children:root:1")
})

test("a running child absent from background tasks is still enumerated", async () => {
  const fake = fakeBoundary({
    details: baseDetails(),
    pages: basePages(),
    active: { root: { type: "running" }, child: { type: "running" } },
  })
  const adapter = createNativeExecutionAdapter({ target: () => target(), boundary: fake.boundary })
  const snapshot = await adapter.hydrate()
  expect(snapshot.nodes.map((node) => node.id)).toEqual(["root", "child", "idle-child", "grandchild"])
  expect(snapshot.nodes.find((node) => node.id === "child")?.status).toBe("running")
})

test("a root with no children is complete", async () => {
  const fake = fakeBoundary({ details: new Map([["root", sessionInfo("root")]]) })
  const adapter = createNativeExecutionAdapter({
    target: () => target({ selectedSessionID: "root" }),
    boundary: fake.boundary,
  })
  const snapshot = await adapter.hydrate()
  expect(snapshot.rootSessionID).toBe("root")
  expect(snapshot.nodes.map((node) => node.id)).toEqual(["root"])
  expect(snapshot.complete).toBe(true)
})

test("attention is refreshed when a descendant later gains a permission", async () => {
  const needsInput = new Set<string>()
  const fake = fakeBoundary({ details: baseDetails(), pages: basePages(), needsInput })
  const adapter = createNativeExecutionAdapter({ target: () => target(), boundary: fake.boundary })
  const first = await adapter.hydrate()
  expect(first.nodes.find((node) => node.id === "child")?.needsInput).toBe(false)
  needsInput.add("child")
  const second = await adapter.hydrate()
  const child = second.nodes.find((node) => node.id === "child")
  expect(child?.needsInput).toBe(true)
  expect(nativeState(child!)).toBe("needs_input")
})

test("a new grandchild below a known child is discovered on a later hydrate", async () => {
  const details = baseDetails()
  const pages = basePages()
  const fake = fakeBoundary({ details, pages })
  const adapter = createNativeExecutionAdapter({ target: () => target(), boundary: fake.boundary })
  await adapter.hydrate()
  details.set("new-grandchild", sessionInfo("new-grandchild", { parentID: "child" }))
  pages.set("child", [
    {
      data: [sessionInfo("grandchild", { parentID: "child" }), sessionInfo("new-grandchild", { parentID: "child" })],
    },
  ])
  const snapshot = await adapter.hydrate()
  expect(snapshot.nodes.map((node) => node.id)).toContain("new-grandchild")
  expect(snapshot.complete).toBe(true)
})

test("selecting another descendant preserves the root execution scope", async () => {
  const details = baseDetails()
  const pages = basePages()
  const fake = fakeBoundary({ details, pages })
  const execution = scope()
  let selected = "grandchild"
  const adapter = createNativeExecutionAdapter({
    target: () => ({ scope: execution, selectedSessionID: selected }),
    boundary: fake.boundary,
  })
  const first = await adapter.hydrate()
  expect(first.nodes.map((node) => node.id)).toContain("grandchild")

  selected = "child"
  pages.set("child", [{ data: [] }])
  const second = await adapter.hydrate()
  expect(scopeKey(second.scope)).toBe(scopeKey(execution))
  expect(second.scope.rootSessionID).toBe("root")
  expect(second.rootSessionID).toBe("root")
  expect(second.nodes.map((node) => node.id)).toContain("grandchild")
})

test("identical session IDs on another server do not leak across a scope change", async () => {
  let serverKey = ServerConnection.Key.make("server-a")
  const first = deferred<NativeDetail>()
  const second = deferred<NativeDetail>()
  let requests = 0
  const boundary: NativeBoundary = {
    detail: () => {
      requests += 1
      return requests === 1 ? first.promise : second.promise
    },
    children: async () => ({ data: [] }),
    active: async () => ({}),
  }
  const adapter = createNativeExecutionAdapter({
    target: () => ({ scope: scope({ serverKey }), selectedSessionID: "root" }),
    boundary,
  })
  const oldHydrate = adapter.hydrate()
  serverKey = ServerConnection.Key.make("server-b")
  const newHydrate = adapter.hydrate()
  second.resolve({ info: sessionInfo("root", { title: "Server B controller" }), needsInput: false })
  await newHydrate
  first.resolve({ info: sessionInfo("root", { title: "Server A controller" }), needsInput: false })
  await oldHydrate
  const snapshot = adapter.snapshot()
  expect(snapshot.scope.serverKey).toBe(ServerConnection.Key.make("server-b"))
  expect(snapshot.nodes.find((node) => node.id === "root")?.title).toBe("Server B controller")
})

test("aborting during a scope switch discards late responses", async () => {
  const controller = new AbortController()
  const late = deferred<NativeDetail>()
  const boundary: NativeBoundary = {
    detail: () => late.promise,
    children: async () => ({ data: [] }),
    active: async () => ({}),
  }
  const adapter = createNativeExecutionAdapter({
    target: () => target({ selectedSessionID: "root" }),
    boundary,
    signal: controller.signal,
  })
  const hydrate = adapter.hydrate()
  controller.abort()
  late.resolve({ info: sessionInfo("root", { title: "Late root" }), needsInput: false })
  await hydrate
  expect(controller.signal.aborted).toBe(true)
  expect(adapter.snapshot().nodes).toEqual([])
  expect(adapter.snapshot().complete).toBe(false)
})

test("a child worktree directory never replaces the owner directory", async () => {
  const fake = fakeBoundary({ details: baseDetails(), pages: basePages() })
  const adapter = createNativeExecutionAdapter({ target: () => target(), boundary: fake.boundary })
  const snapshot = await adapter.hydrate()
  expect(snapshot.scope.ownerDirectory).toBe("/root/git/demo")
  expect(snapshot.nodes.find((node) => node.id === "child")?.directory).toBe("/root/git/demo/.worktrees/feature")
  expect(snapshot.nodes.find((node) => node.id === "grandchild")?.directory).toBe(
    "/root/git/demo/.worktrees/feature",
  )
})

test("a descendant is preserved as an unknown placeholder while its detail loads", async () => {
  const childDetail = deferred<NativeDetail>()
  const details = baseDetails()
  const boundary: NativeBoundary = {
    detail: ({ sessionID }) => {
      if (sessionID === "child") return childDetail.promise
      const info = details.get(sessionID)
      if (!info) return Promise.reject(new Error(`session not found: ${sessionID}`))
      return Promise.resolve({ info, needsInput: false })
    },
    children: ({ sessionID }) =>
      Promise.resolve(
        sessionID === "root"
          ? { data: [sessionInfo("child", { parentID: "root" }), sessionInfo("idle-child", { parentID: "root" })] }
          : { data: [] },
      ),
    active: () => Promise.resolve({ root: { type: "running" } }),
  }
  const adapter = createNativeExecutionAdapter({
    target: () => target({ selectedSessionID: "root" }),
    boundary,
  })
  const hydrate = adapter.hydrate()
  await waitFor(() => adapter.snapshot().nodes.some((node) => node.id === "child"))
  expect(adapter.snapshot().nodes.find((node) => node.id === "child")?.status).toBe("unknown")
  childDetail.resolve({ info: details.get("child")!, needsInput: false })
  const snapshot = await hydrate
  expect(snapshot.nodes.find((node) => node.id === "child")?.status).toBe("idle")
})

test("an inaccessible child becomes an error placeholder instead of disappearing", async () => {
  const details = new Map<string, NativeSessionInfo>([["root", sessionInfo("root")]])
  const boundary: NativeBoundary = {
    detail: ({ sessionID }) => {
      const info = details.get(sessionID)
      if (!info) return Promise.reject(new Error(`session not found: ${sessionID}`))
      return Promise.resolve({ info, needsInput: false })
    },
    children: ({ sessionID }) =>
      Promise.resolve(sessionID === "root" ? { data: [sessionInfo("gone", { parentID: "root" })] } : { data: [] }),
    active: () => Promise.resolve({}),
  }
  const adapter = createNativeExecutionAdapter({
    target: () => target({ selectedSessionID: "root" }),
    boundary,
  })
  const snapshot = await adapter.hydrate()
  const gone = snapshot.nodes.find((node) => node.id === "gone")
  expect(gone?.status).toBe("unknown")
  expect(gone?.error).toBe("session not found: gone")
  expect(snapshot.complete).toBe(false)
})

test("malformed cyclic ancestry terminates without fetching forever", async () => {
  let detailCalls = 0
  const boundary: NativeBoundary = {
    detail: ({ sessionID }) => {
      detailCalls += 1
      return Promise.resolve({
        info: sessionInfo(sessionID, { parentID: sessionID === "root" ? "child" : "root" }),
        needsInput: false,
      })
    },
    children: async () => ({ data: [] }),
    active: async () => ({}),
  }
  const adapter = createNativeExecutionAdapter({
    target: () => target({ selectedSessionID: "root" }),
    boundary,
  })
  const snapshot = await adapter.hydrate()
  expect(snapshot.rootSessionID).toBeUndefined()
  expect(snapshot.complete).toBe(false)
  expect(detailCalls).toBe(2)
})

test("dispose stops applying late responses", async () => {
  const late = deferred<NativeDetail>()
  const boundary: NativeBoundary = {
    detail: () => late.promise,
    children: async () => ({ data: [] }),
    active: async () => ({}),
  }
  const adapter = createNativeExecutionAdapter({
    target: () => target({ selectedSessionID: "root" }),
    boundary,
  })
  const hydrate = adapter.hydrate()
  adapter.dispose()
  late.resolve({ info: sessionInfo("root"), needsInput: false })
  await hydrate
  expect(adapter.snapshot().nodes).toEqual([])
  expect(adapter.snapshot().complete).toBe(false)
})

test("concurrent detail requests for the same session are deduplicated", async () => {
  const gate = deferred<NativeDetail>()
  let selectedCalls = 0
  const fake = fakeBoundary({ details: baseDetails(), pages: basePages() })
  const boundary: NativeBoundary = {
    detail: ({ sessionID, signal }) => {
      if (sessionID !== "grandchild") return fake.boundary.detail({ sessionID, signal })
      selectedCalls += 1
      return gate.promise
    },
    children: fake.boundary.children,
    active: fake.boundary.active,
  }
  const adapter = createNativeExecutionAdapter({ target: () => target(), boundary })
  const both = Promise.all([adapter.hydrate(), adapter.hydrate()])
  await Promise.resolve()
  expect(selectedCalls).toBe(1)
  gate.resolve({ info: baseDetails().get("grandchild")!, needsInput: false })
  await both
})

test("detail hydration never exceeds four concurrent requests", async () => {
  const details = new Map<string, NativeSessionInfo>([["root", sessionInfo("root")]])
  const children: NativeSessionInfo[] = []
  for (let index = 0; index < 6; index += 1) {
    const info = sessionInfo(`child-${index}`, { parentID: "root" })
    details.set(info.id, info)
    children.push(info)
  }
  let current = 0
  let max = 0
  const boundary: NativeBoundary = {
    detail: async ({ sessionID }) => {
      current += 1
      max = Math.max(max, current)
      await new Promise((resolve) => setTimeout(resolve, 1))
      current -= 1
      return { info: details.get(sessionID)!, needsInput: false }
    },
    children: async ({ sessionID }) => (sessionID === "root" ? { data: children } : { data: [] }),
    active: async () => ({}),
  }
  const adapter = createNativeExecutionAdapter({
    target: () => target({ selectedSessionID: "root" }),
    boundary,
  })
  await adapter.hydrate()
  expect(max).toBeLessThanOrEqual(4)
  expect(max).toBe(4)
})

test("openSession passes the supplied server key directly to the route helper", () => {
  const supplied = ServerConnection.key({
    type: "ssh",
    host: "build-box",
    id: "ssh-1",
    http: { url: "http://127.0.0.1:4096" },
  })
  const boundary: NativeBoundary = {
    detail: () => Promise.reject(new Error("unused")),
    children: async () => ({ data: [] }),
    active: async () => ({}),
  }
  const adapter = createNativeExecutionAdapter({
    target: () => ({ scope: scope({ serverKey: supplied }), selectedSessionID: "grandchild" }),
    boundary,
  })
  expect(adapter.openSession("grandchild")).toBe(sessionHref(supplied, "grandchild"))
  expect(adapter.openSession("grandchild")).toContain("/session/grandchild")
  expect(adapter.snapshot().scope.serverKey).toBe(supplied)
  const other = createNativeExecutionAdapter({
    target: () => ({
      scope: scope({ serverKey: ServerConnection.Key.make("sidecar") }),
      selectedSessionID: "grandchild",
    }),
    boundary,
  })
  expect(other.openSession("grandchild")).not.toBe(adapter.openSession("grandchild"))
})

test("native state distinguishes needs input, error, running, idle, and unknown", () => {
  const base = (overrides: Partial<NativeRecord> = {}): NativeRecord => ({
    id: "session",
    title: "Session",
    directory: "/root/git/demo",
    status: "idle",
    needsInput: false,
    ...overrides,
  })
  expect(nativeState(base({ needsInput: true }))).toBe("needs_input")
  expect(nativeState(base({ error: "unavailable" }))).toBe("error")
  expect(nativeState(base({ status: "running" }))).toBe("running")
  expect(nativeState(base({ status: "idle" }))).toBe("idle")
  expect(nativeState(base({ status: "unknown" }))).toBe("unknown")
  expect(nativeState(base({ needsInput: true, error: "unavailable", status: "running" }))).toBe("needs_input")
})

test("the native boundary follows the session list cursor", async () => {
  const requests: Array<{ parentID?: string; order?: string; cursor?: string }> = []
  const api = {
    session: {
      list: async (input: { parentID?: string; order?: string; cursor?: string }) => {
        requests.push(input)
        if (!input.cursor) return { data: [apiSession("child-a")], cursor: { next: "page-2" } }
        return { data: [apiSession("child-b")], cursor: {} }
      },
    },
  }
  const boundary = createNativeBoundary({ api: api as unknown as OpenCodeClient })
  const first = await boundary.children({ sessionID: "root" })
  expect(first.next).toBe("page-2")
  const second = await boundary.children({ sessionID: "root", cursor: first.next })
  expect(second.next).toBeUndefined()
  expect(requests).toEqual([
    { parentID: "root", order: "desc", cursor: undefined },
    { parentID: "root", order: "desc", cursor: "page-2" },
  ])
})

test("attention comes only from permissions and question forms", async () => {
  const build = (permissions: unknown[], forms: unknown[]) =>
    createNativeBoundary({
      api: {
        session: {
          get: async ({ sessionID }: { sessionID: string }) => apiSession(sessionID),
          form: { list: async () => forms },
        },
        permission: { list: async () => permissions },
      } as unknown as OpenCodeClient,
    })
  expect((await build([{ id: "permission-1" }], []).detail({ sessionID: "root" })).needsInput).toBe(true)
  expect(
    (
      await build(
        [],
        [{ id: "form-1", sessionID: "root", title: "Attention", metadata: { kind: "question" } }],
      ).detail({ sessionID: "root" })
    ).needsInput,
  ).toBe(true)
  expect(
    (
      await build(
        [],
        [{ id: "form-2", sessionID: "root", title: "Other", metadata: { kind: "panel" } }],
      ).detail({ sessionID: "root" })
    ).needsInput,
  ).toBe(false)
})
