/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import type { OpenCodeEvent } from "@opencode-ai/client"
import { testRender } from "@opentui/solid"
import { mkdirSync, watch } from "fs"
import path from "path"
import { ConfigProvider, useConfig } from "../../src/config"
import { ClientProvider, useClient } from "../../src/context/client"
import { DataProvider, useData } from "../../src/context/data"
import { LocationProvider } from "../../src/context/location"
import { RouteProvider, useRoute } from "../../src/context/route"
import { TuiAppProvider } from "../../src/context/runtime"
import { SessionTabsProvider, useSessionTabs } from "../../src/context/session-tabs"
import { NEW_SESSION_TAB_TITLE } from "../../src/context/session-tabs-model"
import { StorageProvider, useStorage } from "../../src/context/storage"
import { createApi, createEventStream, createFetch, directory, json } from "../fixture/tui-client"
import { TestTuiContexts } from "../fixture/tui-environment"
import { tmpdir } from "../fixture/fixture"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"

async function wait(fn: () => boolean | Promise<boolean>, timeout = 2_000, label = "condition") {
  const start = Date.now()
  while (!(await fn())) {
    if (Date.now() - start > timeout) throw new Error(`timed out waiting for ${label}`)
    await Bun.sleep(10)
  }
}

async function renderSessionTabs(
  initialSessionID: string,
  options?: {
    state?: string
    title?: string
    home?: boolean
    persisted?: string[]
    sessionGate?: Promise<void>
    sessionDirectories?: Record<string, string>
    sessionParents?: Record<string, string>
    sessionTimes?: Record<string, { idle?: number; viewed?: number }>
    sessionOutcomes?: Record<string, "succeeded" | "failed" | "interrupted">
    newLocation?: "launch" | "inherit"
    launchDirectory?: string
    tabsEnabled?: boolean
    viewFailures?: number
    preview?: boolean
  },
) {
  const temporary = options?.state ? undefined : await tmpdir()
  const state = options?.state ?? temporary!.path
  if (options?.persisted) {
    const file = path.join(state, "test", "tui", "tabs.json")
    mkdirSync(path.dirname(file), { recursive: true })
    await Bun.write(
      file,
      JSON.stringify({
        global: { tabs: [], unread: { ses_legacy: "error" } },
        cwd: {
          [directory]: {
            tabs: options.persisted.map((sessionID) => ({ sessionID })),
            unread: { ses_legacy: "activity" },
          },
        },
      }),
    )
  }
  const events = createEventStream()
  const sessions: string[] = []
  const views: string[] = []
  const viewWatermarks: number[] = []
  const locations: string[] = []
  const vcsLocations: string[] = []
  const sessionTimes = Object.fromEntries(
    Object.entries(options?.sessionTimes ?? {}).map(([sessionID, time]) => [sessionID, { ...time }]),
  )
  const calls = createFetch(async (url, request) => {
    if (url.pathname === "/api/location") {
      const requested = url.searchParams.get("location[directory]") ?? directory
      locations.push(requested)
      return json({
        directory: requested,
        project: { id: "project", directory: requested, canonical: directory },
      })
    }
    if (url.pathname === "/api/vcs") {
      const requested = url.searchParams.get("location[directory]") ?? directory
      vcsLocations.push(requested)
      return json({
        location: { directory: requested },
        data: { branch: { current: "main", default: "main" } },
      })
    }
    if (url.pathname === "/api/session" && url.searchParams.has("parentID")) {
      const parentID = url.searchParams.get("parentID")
      const children = Object.entries(options?.sessionParents ?? {})
        .filter(([, parent]) => parent === parentID)
        .map(([sessionID]) => sessionInfo(sessionID))
      return json({ data: children, cursor: {} })
    }
    const viewed = url.pathname.match(/^\/api\/session\/([^/]+)\/view$/)?.[1]
    if (viewed && request.method === "POST") {
      views.push(viewed)
      const payload: unknown = await request.json()
      if (typeof payload !== "object" || payload === null || !("idle" in payload) || typeof payload.idle !== "number")
        throw new Error("Expected an idle watermark")
      viewWatermarks.push(payload.idle)
      if (views.length <= (options?.viewFailures ?? 0)) return new Response(null, { status: 503 })
      const time = (sessionTimes[viewed] ??= {})
      time.viewed = Math.min(payload.idle, time.idle ?? payload.idle)
      return new Response(null, { status: 204 })
    }
    const sessionID = url.pathname.match(/^\/api\/session\/([^/]+)$/)?.[1]
    if (!sessionID) return undefined
    sessions.push(sessionID)
    await options?.sessionGate
    return json({ data: sessionInfo(sessionID) })
  }, events)

  function sessionInfo(sessionID: string) {
    return {
      id: sessionID,
      parentID: options?.sessionParents?.[sessionID],
      title: sessionID === initialSessionID ? options?.title : undefined,
      projectID: "project",
      location: { directory: options?.sessionDirectories?.[sessionID] ?? directory },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      outcome: options?.sessionOutcomes?.[sessionID],
      time: { created: 0, updated: 0, ...sessionTimes[sessionID] },
    }
  }
  let tabs!: ReturnType<typeof useSessionTabs>
  let route!: ReturnType<typeof useRoute>
  let client!: ReturnType<typeof useClient>
  let data!: ReturnType<typeof useData>
  let storage!: ReturnType<typeof useStorage>
  let config!: ReturnType<typeof useConfig>
  let configuration = {
    tabs: { enabled: options?.tabsEnabled ?? true },
    experimental: options?.preview ? { "session-preview-tabs": true } : undefined,
    session: { new_location: options?.newLocation ?? "launch" },
  }

  function Probe() {
    tabs = useSessionTabs()
    route = useRoute()
    client = useClient()
    data = useData()
    storage = useStorage()
    config = useConfig()
    return <box />
  }

  const app = await testRender(() => (
    <TestTuiContexts paths={{ state }}>
      <TuiAppProvider value={{ name: "test", version: "test", channel: "test" }}>
        <StorageProvider>
          <ConfigProvider
            config={createTuiResolvedConfig(configuration)}
            service={{
              get: async () => configuration,
              update: async (update) => {
                configuration = structuredClone(configuration)
                update(configuration)
                return configuration
              },
            }}
          >
            <RouteProvider
              initialRoute={options?.home ? { type: "home" } : { type: "session", sessionID: initialSessionID }}
            >
              <ClientProvider api={createApi(calls.fetch)}>
                <DataProvider directory={options?.launchDirectory ?? directory}>
                  <LocationProvider>
                    <SessionTabsProvider>
                      <Probe />
                    </SessionTabsProvider>
                  </LocationProvider>
                </DataProvider>
              </ClientProvider>
            </RouteProvider>
          </ConfigProvider>
        </StorageProvider>
      </TuiAppProvider>
    </TestTuiContexts>
  ))

  await wait(() => client.connection.status() === "connected")
  return {
    tabs,
    route,
    data,
    sessions,
    views,
    viewWatermarks,
    locations,
    vcsLocations,
    state,
    setSessionTime(sessionID: string, time: { idle?: number; viewed?: number }) {
      sessionTimes[sessionID] = time
    },
    emit: (event: OpenCodeEvent) => events.emit({ ...event, location: { directory } }),
    focus: () => app.renderer.emit("focus"),
    blur: () => app.renderer.emit("blur"),
    flush: () => storage.flush(),
    setPreviews: (enabled: boolean) =>
      config.update((draft) => {
        draft.experimental ??= {}
        draft.experimental["session-preview-tabs"] = enabled
      }),
    async destroy() {
      app.renderer.destroy()
      await storage.flush()
      await temporary?.[Symbol.asyncDispose]()
    },
  }
}

function admitted(sessionID: string, inboxID: string): OpenCodeEvent {
  return {
    id: `evt_${inboxID}`,
    created: Date.now(),
    type: "session.inbox.enqueued",
    durable: { aggregateID: sessionID, seq: Number(inboxID.replace(/\D/g, "")), version: 1 },
    data: {
      sessionID,
      inboxID,
      item: { type: "user", payload: { text: inboxID }, delivery: "steer" },
    },
  }
}

test("loads persisted tab metadata concurrently on connect", async () => {
  let release!: () => void
  const sessionGate = new Promise<void>((resolve) => (release = resolve))
  const setup = await renderSessionTabs("first", {
    home: true,
    persisted: ["first", "second"],
    sessionGate,
  })

  try {
    await wait(() => setup.sessions.length === 2)
    expect(setup.sessions.toSorted()).toEqual(["first", "second"])
    release()
    await wait(() => setup.data.session.get("first") !== undefined && setup.data.session.get("second") !== undefined)
  } finally {
    release()
    await setup.destroy()
  }
})

test("loads VCS metadata for each persisted tab location", async () => {
  const other = `${directory}/other-worktree`
  const setup = await renderSessionTabs("first", {
    home: true,
    persisted: ["first", "second"],
    sessionDirectories: { second: other },
  })

  try {
    await wait(() => setup.locations.includes(other))
    await wait(() => setup.vcsLocations.includes(other))
  } finally {
    await setup.destroy()
  }
})

test("loads location metadata when an open session moves", async () => {
  const destination = `${directory}/moved-worktree`
  const setup = await renderSessionTabs("first")

  try {
    await wait(() => setup.locations.includes(directory) && setup.vcsLocations.includes(directory))
    setup.emit({
      id: "evt_moved",
      created: 1,
      type: "session.moved",
      durable: { aggregateID: "first", seq: 1, version: 1 },
      data: {
        sessionID: "first",
        location: { directory: destination },
        projectID: "project",
      },
    })

    await wait(() => setup.data.session.get("first")?.location.directory === destination)
    await wait(() => setup.locations.includes(destination))
    await wait(() => setup.vcsLocations.includes(destination))
  } finally {
    await setup.destroy()
  }
})

test("replaces session previews without replacing permanent tabs or opening existing tabs again", async () => {
  const setup = await renderSessionTabs("first", { persisted: ["first", "permanent"], preview: true })

  try {
    await wait(() => setup.tabs.tabs().length === 2)
    setup.route.navigate({ type: "session", sessionID: "preview-one" })
    await wait(
      () => setup.tabs.tabs().some((tab) => tab.sessionID === "preview-one") && setup.tabs.isPreview("preview-one"),
    )

    setup.tabs.select("permanent")
    await wait(() => setup.tabs.current() === "permanent")
    expect(setup.tabs.tabs().map((tab) => tab.sessionID)).toEqual(["first", "permanent", "preview-one"])

    setup.route.navigate({ type: "session", sessionID: "preview-two" })
    await wait(
      () => setup.tabs.tabs().some((tab) => tab.sessionID === "preview-two") && setup.tabs.isPreview("preview-two"),
    )
    expect(setup.tabs.tabs().map((tab) => tab.sessionID)).toEqual(["first", "permanent", "preview-two"])

    setup.tabs.promote("preview-two")
    expect(setup.tabs.isPreview("preview-two")).toBe(false)

    setup.route.navigate({ type: "session", sessionID: "preview-three" })
    await wait(
      () => setup.tabs.tabs().some((tab) => tab.sessionID === "preview-three") && setup.tabs.isPreview("preview-three"),
    )
    expect(setup.tabs.tabs().map((tab) => tab.sessionID)).toEqual([
      "first",
      "permanent",
      "preview-two",
      "preview-three",
    ])
  } finally {
    await setup.destroy()
  }
})

test("server-wide prompt admissions do not promote a local session preview", async () => {
  const setup = await renderSessionTabs("preview", { preview: true })

  try {
    await wait(() => setup.tabs.tabs().some((tab) => tab.sessionID === "preview") && setup.tabs.isPreview("preview"))
    setup.emit({
      id: "evt_synthetic",
      created: Date.now(),
      type: "session.inbox.enqueued",
      durable: { aggregateID: "preview", seq: 1, version: 1 },
      data: {
        sessionID: "preview",
        inboxID: "msg_synthetic",
        item: { type: "synthetic", payload: { text: "editor context" }, delivery: "steer" },
      },
    })
    await Bun.sleep(20)
    expect(setup.tabs.isPreview("preview")).toBe(true)

    setup.emit(admitted("preview", "msg_2"))
    await wait(() => setup.data.session.pending.list("preview").length === 2)
    expect(setup.tabs.isPreview("preview")).toBe(true)

    setup.tabs.promote("preview")
    expect(setup.tabs.isPreview("preview")).toBe(false)
  } finally {
    await setup.destroy()
  }
})

test("promotes a local preview before its tab has finished persisting", async () => {
  const setup = await renderSessionTabs("permanent", { persisted: ["permanent"], preview: true })

  try {
    await wait(() => setup.tabs.tabs().some((tab) => tab.sessionID === "permanent"))
    setup.route.navigate({ type: "session", sessionID: "preview" })

    expect(setup.tabs.isPreview("preview")).toBe(true)
    expect(setup.tabs.tabs().some((tab) => tab.sessionID === "preview")).toBe(false)

    setup.tabs.promote("preview")
    expect(setup.tabs.isPreview("preview")).toBe(false)
    await wait(() => setup.tabs.tabs().some((tab) => tab.sessionID === "preview"))

    setup.route.navigate({ type: "session", sessionID: "next" })
    await wait(() => setup.tabs.tabs().some((tab) => tab.sessionID === "next"))
    expect(setup.tabs.tabs().map((tab) => tab.sessionID)).toEqual(["permanent", "preview", "next"])
  } finally {
    await setup.destroy()
  }
})

test("reopens a previously permanent session as a preview after a user prompt", async () => {
  const setup = await renderSessionTabs("permanent", { persisted: ["permanent"], preview: true })

  try {
    await wait(() => setup.tabs.tabs().some((tab) => tab.sessionID === "permanent"))
    setup.emit(admitted("permanent", "msg_1"))
    await wait(() => setup.data.session.pending.list("permanent").length > 0)

    setup.tabs.close("permanent")
    await wait(() => setup.tabs.tabs().length === 0)
    setup.route.navigate({ type: "session", sessionID: "permanent" })
    await wait(
      () => setup.tabs.tabs().some((tab) => tab.sessionID === "permanent") && setup.tabs.isPreview("permanent"),
    )
  } finally {
    await setup.destroy()
  }
})

test("keeps an explicitly promoted home session permanent when admission arrives before navigation", async () => {
  const setup = await renderSessionTabs("created", { home: true, preview: true })

  try {
    setup.tabs.promote("created")
    setup.emit(admitted("created", "msg_1"))
    await wait(() => setup.data.session.pending.list("created").length > 0)
    setup.route.navigate({ type: "session", sessionID: "created" })
    await wait(() => setup.tabs.tabs().some((tab) => tab.sessionID === "created"))
    expect(setup.tabs.isPreview("created")).toBe(false)
  } finally {
    await setup.destroy()
  }
})

test("stores preview tab membership without persisting preview identity", async () => {
  const setup = await renderSessionTabs("preview", { preview: true })

  try {
    await wait(() => setup.tabs.tabs().some((tab) => tab.sessionID === "preview") && setup.tabs.isPreview("preview"))
    await setup.flush()
    const stored = await Bun.file(path.join(setup.state, "test", "tui", "tabs.json")).json()

    expect(stored.cwd[directory].tabs).toHaveLength(1)
    expect(stored.cwd[directory].tabs[0].sessionID).toBe("preview")
    expect(stored.cwd[directory].tabs[0]).not.toHaveProperty("preview")
    expect(await Bun.file(path.join(setup.state, "test", "tui", "session-tab-preview.json")).exists()).toBe(false)
  } finally {
    await setup.destroy()
  }
})

test("unrelated user admissions do not pre-promote an unopened local session", async () => {
  const setup = await renderSessionTabs("remote", { home: true, preview: true })

  try {
    setup.emit(admitted("remote", "msg_1"))
    await wait(() => setup.data.session.pending.list("remote").length > 0)

    setup.route.navigate({ type: "session", sessionID: "remote" })
    await wait(() => setup.tabs.tabs().some((tab) => tab.sessionID === "remote"))

    expect(setup.tabs.isPreview("remote")).toBe(true)
  } finally {
    await setup.destroy()
  }
})

test("each client replaces only its own preview in shared tab storage", async () => {
  await using temporary = await tmpdir()
  const clients: Awaited<ReturnType<typeof renderSessionTabs>>[] = []

  try {
    const first = await renderSessionTabs("first", { state: temporary.path, preview: true })
    clients.push(first)
    await wait(() => first.tabs.tabs().some((tab) => tab.sessionID === "first"))

    const second = await renderSessionTabs("first", { state: temporary.path, preview: true })
    clients.push(second)
    expect(second.tabs.isPreview("first")).toBe(false)

    second.route.navigate({ type: "session", sessionID: "second" })
    await wait(() => first.tabs.tabs().some((tab) => tab.sessionID === "second"))
    expect(first.tabs.isPreview("first")).toBe(true)
    expect(second.tabs.isPreview("second")).toBe(true)

    first.route.navigate({ type: "session", sessionID: "third" })
    await wait(() => second.tabs.tabs().some((tab) => tab.sessionID === "third"))

    expect(second.tabs.tabs().map((tab) => tab.sessionID)).toEqual(["third", "second"])
    expect(first.tabs.isPreview("third")).toBe(true)
    expect(second.tabs.isPreview("second")).toBe(true)
  } finally {
    await Promise.allSettled(clients.map((client) => client.destroy()))
  }
})

test("reopening a closed preview makes it permanent without replacing the current preview", async () => {
  const setup = await renderSessionTabs("permanent", { persisted: ["permanent"], preview: true })

  try {
    await wait(() => setup.tabs.tabs().some((tab) => tab.sessionID === "permanent"))
    setup.route.navigate({ type: "session", sessionID: "closed-preview" })
    await wait(() => setup.tabs.tabs().some((tab) => tab.sessionID === "closed-preview"))
    expect(setup.tabs.isPreview("closed-preview")).toBe(true)

    setup.tabs.close("closed-preview")
    await wait(() => setup.tabs.current() === "permanent" && setup.tabs.tabs().length === 1)
    setup.route.navigate({ type: "session", sessionID: "current-preview" })
    await wait(() => setup.tabs.tabs().some((tab) => tab.sessionID === "current-preview"))

    setup.tabs.reopen()
    await wait(() => setup.tabs.current() === "closed-preview" && setup.tabs.tabs().length === 3)
    await setup.flush()

    expect(setup.tabs.tabs().map((tab) => tab.sessionID)).toEqual(["permanent", "closed-preview", "current-preview"])
    expect(setup.tabs.isPreview("closed-preview")).toBe(false)
    expect(setup.tabs.isPreview("current-preview")).toBe(true)
  } finally {
    await setup.destroy()
  }
})

test("moving a preview promotes it before opening another preview", async () => {
  const setup = await renderSessionTabs("first", { persisted: ["first", "last"], preview: true })

  try {
    await wait(() => setup.tabs.tabs().length === 2)
    setup.route.navigate({ type: "session", sessionID: "moved-preview" })
    await wait(() => setup.tabs.tabs().some((tab) => tab.sessionID === "moved-preview"))

    setup.tabs.move("moved-preview", 0)
    expect(setup.tabs.isPreview("moved-preview")).toBe(false)
    await wait(() => setup.tabs.tabs()[0]?.sessionID === "moved-preview")

    setup.route.navigate({ type: "session", sessionID: "next-preview" })
    await wait(() => setup.tabs.tabs().some((tab) => tab.sessionID === "next-preview"))

    expect(setup.tabs.tabs().map((tab) => tab.sessionID)).toEqual(["moved-preview", "first", "last", "next-preview"])
    expect(setup.tabs.isPreview("next-preview")).toBe(true)
  } finally {
    await setup.destroy()
  }
})

test("disabling previews clears local identity and prevents stale replacement after re-enabling", async () => {
  const setup = await renderSessionTabs("first", { preview: true })

  try {
    await wait(() => setup.tabs.tabs().some((tab) => tab.sessionID === "first") && setup.tabs.isPreview("first"))

    await setup.setPreviews(false)
    expect(setup.tabs.isPreview("first")).toBe(false)

    await setup.setPreviews(true)
    expect(setup.tabs.isPreview("first")).toBe(false)
    setup.route.navigate({ type: "session", sessionID: "next" })
    await wait(() => setup.tabs.tabs().some((tab) => tab.sessionID === "next"))

    expect(setup.tabs.tabs().map((tab) => tab.sessionID)).toEqual(["first", "next"])
    expect(setup.tabs.isPreview("next")).toBe(true)
  } finally {
    await setup.destroy()
  }
})

test("stores session tabs for the current working directory by default", async () => {
  const setup = await renderSessionTabs("first")

  try {
    const file = path.join(setup.state, "test", "tui", "tabs.json")
    await wait(async () => {
      if (!(await Bun.file(file).exists())) return false
      const stored = await Bun.file(file).json()
      return stored.cwd[directory]?.tabs.some((tab: { sessionID: string }) => tab.sessionID === "first")
    })
    const stored = await Bun.file(file).json()
    expect(stored.global).toEqual({ tabs: [], unread: {} })
    expect(Object.keys(stored.cwd)).toEqual([directory])
    expect(stored.cwd[directory].tabs.map((tab: { sessionID: string }) => tab.sessionID)).toEqual(["first"])
    expect(stored.cwd[directory].unread).toEqual({})
  } finally {
    await setup.destroy()
  }
})

test("keeps scroll anchors for open session tabs", async () => {
  const setup = await renderSessionTabs("first")

  try {
    await wait(() => setup.tabs.current() === "first")
    await wait(() => setup.tabs.tabs().some((tab) => tab.sessionID === "first"))
    setup.tabs.setScrollAnchor("first", { messageID: "msg_1", screenY: -3 })

    expect(setup.tabs.scrollAnchor("first")).toEqual({ messageID: "msg_1", screenY: -3 })

    setup.tabs.close("first")
    await wait(() => setup.tabs.tabs().every((tab) => tab.sessionID !== "first"))
    expect(setup.tabs.scrollAnchor("first")).toBeUndefined()
  } finally {
    await setup.destroy()
  }
})

test("derives unread state from server session times", async () => {
  const setup = await renderSessionTabs("first", {
    home: true,
    persisted: ["first", "second"],
    sessionTimes: { second: { idle: 2 } },
  })
  try {
    await wait(() => setup.tabs.status("second").unread === "activity")
    expect(setup.tabs.status("first").unread).toBeUndefined()
  } finally {
    await setup.destroy()
  }
})

test("marks unread failed sessions with error styling", async () => {
  const setup = await renderSessionTabs("first", {
    home: true,
    persisted: ["first", "second"],
    sessionTimes: { first: { idle: 2 }, second: { idle: 2 } },
    sessionOutcomes: { second: "failed" },
  })
  try {
    await wait(() => setup.tabs.status("second").unread === "error")
    expect(setup.tabs.status("first").unread).toBe("activity")
  } finally {
    await setup.destroy()
  }
})

test("acknowledges viewed sessions even when tabs are disabled", async () => {
  const setup = await renderSessionTabs("first", {
    tabsEnabled: false,
    sessionTimes: { first: { idle: 2 } },
  })
  try {
    setup.focus()
    await setup.data.session.sync("first")
    await wait(() => setup.views.includes("first"))
    expect(setup.tabs.tabs()).toEqual([])
  } finally {
    await setup.destroy()
  }
})

test("empties legacy persisted unread records for rollback compatibility", async () => {
  const setup = await renderSessionTabs("first", { persisted: ["first"] })
  try {
    const file = path.join(setup.state, "test", "tui", "tabs.json")
    // Normalize rewrites the active scope; legacy values must not survive, but older clients require the field.
    await wait(async () => {
      const stored = await Bun.file(file).json()
      return Object.keys(stored.cwd[directory].unread).length === 0
    })
  } finally {
    await setup.destroy()
  }
})

test("refreshes server session times after terminal events", async () => {
  const setup = await renderSessionTabs("first", { home: true, persisted: ["first"] })
  try {
    // Terminal events refresh only already-loaded sessions, so ensure the initial sync landed.
    await wait(() => setup.data.session.get("first") !== undefined)
    setup.setSessionTime("first", { idle: 2 })
    setup.emit({
      id: "evt_done_first",
      created: 2,
      type: "session.execution.succeeded",
      durable: { aggregateID: "first", seq: 1, version: 1 },
      data: { sessionID: "first" },
    })
    await wait(() => setup.tabs.status("first").unread === "activity")
  } finally {
    await setup.destroy()
  }
})

test("views a selected unread session only while focused", async () => {
  const setup = await renderSessionTabs("first", {
    home: true,
    persisted: ["first"],
    sessionTimes: { first: { idle: 2 } },
  })
  try {
    setup.blur()
    setup.route.navigate({ type: "session", sessionID: "first" })
    await wait(() => setup.tabs.current() === "first" && setup.tabs.status("first").unread === "activity")
    await Bun.sleep(20)
    expect(setup.views).toEqual([])

    setup.focus()
    await wait(() => setup.views.includes("first"))
    setup.emit({
      id: "evt_viewed_first",
      created: 3,
      type: "session.viewed",
      durable: { aggregateID: "first", seq: 2, version: 1 },
      data: { sessionID: "first", idle: 2 },
    })
    await wait(() => setup.tabs.status("first").unread === undefined)
    expect(setup.views).toEqual(["first"])
    expect(setup.viewWatermarks).toEqual([2])
  } finally {
    await setup.destroy()
  }
})

test("does not acknowledge an unread session until focus is confirmed", async () => {
  const setup = await renderSessionTabs("first", { sessionTimes: { first: { idle: 2 } } })
  try {
    await wait(() => setup.tabs.status("first").unread === "activity")
    await Bun.sleep(20)
    expect(setup.views).toEqual([])

    setup.focus()
    await wait(() => setup.views.includes("first"))
  } finally {
    await setup.destroy()
  }
})

test("retries a failed view acknowledgement", async () => {
  const setup = await renderSessionTabs("first", {
    sessionTimes: { first: { idle: 2 } },
    viewFailures: 1,
  })
  try {
    setup.focus()
    await wait(() => setup.views.length === 2)
    expect(setup.views).toEqual(["first", "first"])
    expect(setup.viewWatermarks).toEqual([2, 2])
  } finally {
    await setup.destroy()
  }
})

test("ignores subagent unread state on the root tab", async () => {
  const setup = await renderSessionTabs("root", {
    home: true,
    persisted: ["root"],
    sessionParents: { child: "root" },
    sessionTimes: { child: { idle: 2 } },
  })
  try {
    await wait(() => setup.data.session.get("child") !== undefined)
    expect(setup.tabs.status("root").unread).toBeUndefined()

    setup.route.navigate({ type: "session", sessionID: "root" })
    await Bun.sleep(20)
    expect(setup.views).toEqual([])

    // A background subagent completion wakes the parent; the parent's own idle transition
    // then carries the unread signal and is the only state acknowledged.
    setup.focus()
    setup.setSessionTime("root", { idle: 3 })
    setup.emit({
      id: "evt_done_root",
      created: 3,
      type: "session.execution.succeeded",
      durable: { aggregateID: "root", seq: 1, version: 1 },
      data: { sessionID: "root" },
    })
    await wait(() => setup.views.includes("root"))
    expect(setup.views).toEqual(["root"])
  } finally {
    await setup.destroy()
  }
})

test("distinguishes family questions and permissions without clearing them on selection", async () => {
  const setup = await renderSessionTabs("root", {
    home: true,
    persisted: ["root"],
    sessionParents: { child: "root" },
  })
  try {
    await wait(() => setup.data.session.get("child") !== undefined)
    expect(setup.tabs.status("root").attention).toBe(false)

    setup.emit({
      id: "evt_question",
      created: 1,
      type: "form.created",
      data: {
        form: {
          id: "frm_question",
          sessionID: "child",
          title: "Choose an approach",
          fields: [{ key: "approach", type: "string", title: "Approach" }],
        },
      },
    })
    await wait(() => setup.tabs.status("root").attention === "question")

    setup.tabs.select("root")
    await wait(() => setup.tabs.current() === "root")
    expect(setup.tabs.status("root").attention).toBe("question")

    setup.emit({
      id: "evt_permission",
      created: 2,
      type: "permission.asked",
      data: { id: "per_command", sessionID: "root", action: "shell", resources: ["bun run test"] },
    })
    await wait(() => setup.tabs.status("root").attention === "permission")
    expect(setup.tabs.status("child").attention).toBe("permission")

    setup.emit({
      id: "evt_permission_reply",
      created: 3,
      type: "permission.replied",
      data: { sessionID: "root", requestID: "per_command", reply: "once" },
    })
    await wait(() => setup.tabs.status("root").attention === "question")

    setup.emit({
      id: "evt_question_reply",
      created: 4,
      type: "form.replied",
      data: { sessionID: "child", id: "frm_question", answer: {} },
    })
    await wait(() => setup.tabs.status("root").attention === false)
  } finally {
    await setup.destroy()
  }
})

test("concurrent TUIs do not alternate shared tab titles from divergent session caches", async () => {
  await using temporary = await tmpdir()
  const state = temporary.path
  let titled: Awaited<ReturnType<typeof renderSessionTabs>> | undefined
  let untitled: Awaited<ReturnType<typeof renderSessionTabs>> | undefined

  try {
    titled = await renderSessionTabs("shared", { state, title: "Generated title" })
    untitled = await renderSessionTabs("shared", { state })
    const file = path.join(state, "test", "tui", "tabs.json")
    await titled.data.session.sync("shared")
    await wait(async () => {
      if (!(await Bun.file(file).exists())) return false
      return (await Bun.file(file).json()).cwd[directory]?.tabs[0]?.title === "Generated title"
    })
    const observed = ["Generated title"]
    const pending = new Set<Promise<void>>()
    const watcher = watch(path.dirname(file), (_, name) => {
      if (name !== path.basename(file)) return
      const read = Bun.file(file)
        .json()
        .then((value) => {
          const title = value.cwd[directory]?.tabs[0]?.title
          if (title && observed.at(-1) !== title) observed.push(title)
        })
        .catch(() => undefined)
        .finally(() => pending.delete(read))
      pending.add(read)
    })
    try {
      await untitled.data.session.sync("shared")
      await Bun.sleep(500)
    } finally {
      watcher.close()
      await Promise.allSettled(pending)
    }

    expect(observed).toEqual(["Generated title"])
  } finally {
    if (titled) await titled.destroy()
    if (untitled) await untitled.destroy()
  }
})

test("closing a tab is not undone by another TUI viewing the same session", async () => {
  await using temporary = await tmpdir()
  const clients: Awaited<ReturnType<typeof renderSessionTabs>>[] = []

  try {
    const first = await renderSessionTabs("shared", { state: temporary.path })
    clients.push(first)
    const second = await renderSessionTabs("shared", { state: temporary.path })
    clients.push(second)
    await wait(() => first.tabs.tabs().some((tab) => tab.sessionID === "shared"))
    await wait(() => second.tabs.tabs().some((tab) => tab.sessionID === "shared"))
    first.tabs.close()
    await wait(() => first.route.data.type === "home")
    await wait(() => !second.tabs.tabs().some((tab) => tab.sessionID === "shared"))
    await Promise.all([first.flush(), second.flush()])

    const stored = await Bun.file(path.join(temporary.path, "test", "tui", "tabs.json")).json()
    expect(stored.cwd[directory].tabs).toEqual([])

    second.route.navigate({ type: "home" })
    await wait(() => second.route.data.type === "home")
    second.route.navigate({ type: "session", sessionID: "shared" })
    await wait(() => first.tabs.tabs().some((tab) => tab.sessionID === "shared"))
  } finally {
    await Promise.allSettled(clients.map((client) => client.destroy()))
  }
})

test("user prompt admissions pulse an already-busy background tab", async () => {
  const setup = await renderSessionTabs("background")

  try {
    await wait(() => setup.tabs.tabs().some((tab) => tab.sessionID === "background"))
    setup.route.navigate({ type: "session", sessionID: "active" })
    await wait(() => setup.tabs.current() === "active" && setup.tabs.tabs().length === 2)

    setup.emit({
      id: "evt_context",
      created: Date.now(),
      type: "session.inbox.enqueued",
      durable: { aggregateID: "background", seq: 0, version: 1 },
      data: {
        sessionID: "background",
        inboxID: "msg_context",
        item: { type: "synthetic", payload: { text: "editor context" }, delivery: "steer" },
      },
    })
    await Bun.sleep(20)
    expect(setup.tabs.status("background").promptPulse).toBe(0)

    setup.emit(admitted("background", "msg_1"))
    await wait(() => setup.tabs.status("background").promptPulse === 1 && setup.tabs.status("background").busy)

    setup.emit(admitted("background", "msg_2"))
    await wait(() => setup.tabs.status("background").promptPulse === 2)

    setup.emit(admitted("active", "msg_3"))
    await Bun.sleep(20)
    expect(setup.tabs.status("active").promptPulse).toBe(0)
    expect(setup.tabs.status("background")).toMatchObject({ promptPulse: 2, busy: true })
  } finally {
    await setup.destroy()
  }
})

test("tracks a temporary new session tab across close and creation", async () => {
  const setup = await renderSessionTabs("first")

  try {
    await wait(() => setup.tabs.current() === "first")
    setup.route.navigate({ type: "session", sessionID: "second" })
    await wait(() => setup.tabs.current() === "second" && setup.tabs.tabs().length === 2)
    setup.route.navigate({ type: "session", sessionID: "first" })
    await wait(() => setup.tabs.current() === "first")

    setup.route.navigate({ type: "home" })
    await wait(() => setup.tabs.newTab() && setup.tabs.current() === undefined)
    expect(setup.tabs.tabs().map((tab) => tab.sessionID)).toEqual(["first", "second"])
    setup.tabs.close()
    await wait(() => setup.route.data.type === "session")

    expect(setup.route.data).toEqual({ type: "session", sessionID: "first" })

    setup.route.navigate({ type: "home" })
    await wait(() => setup.tabs.newTab())
    setup.route.navigate({ type: "session", sessionID: "third" })
    expect(setup.tabs.newTab()).toBe(true)
    await wait(() => setup.tabs.current() === "third" && setup.tabs.tabs().some((tab) => tab.sessionID === "third"))

    expect(setup.tabs.newTab()).toBe(false)
    expect(setup.tabs.tabs().find((tab) => tab.sessionID === "third")?.title).toBe(NEW_SESSION_TAB_TITLE)
  } finally {
    await setup.destroy()
  }
})

test("add opens the new session tab in the resolved server launch directory", async () => {
  const launchDirectory = `${directory}/server`
  const setup = await renderSessionTabs("first", {
    launchDirectory,
    sessionDirectories: { first: `${directory}/worktree` },
  })

  try {
    await wait(() => setup.tabs.current() === "first" && setup.data.session.get("first") !== undefined)
    setup.tabs.add()
    expect(setup.route.data).toEqual({ type: "home", location: { directory: launchDirectory } })
    await wait(() => setup.tabs.newTab())
    expect(setup.tabs.tabs().map((tab) => tab.sessionID)).toEqual(["first"])
  } finally {
    await setup.destroy()
  }
})

test("add inherits the current session location when configured", async () => {
  const worktree = `${directory}/worktree`
  const setup = await renderSessionTabs("first", {
    newLocation: "inherit",
    sessionDirectories: { first: worktree },
  })

  try {
    await wait(() => setup.tabs.current() === "first" && setup.data.session.get("first") !== undefined)
    setup.tabs.add()
    expect(setup.route.data).toEqual({ type: "home", location: { directory: worktree } })
  } finally {
    await setup.destroy()
  }
})
