/** @jsxImportSource @opentui/solid */
import { afterAll, expect, test } from "bun:test"
import type { OpenCodeEvent } from "@opencode-ai/client"
import { testRender } from "@opentui/solid"
import { mkdtempSync, readdirSync, rmSync, watch } from "fs"
import { tmpdir } from "os"
import path from "path"
import { ConfigProvider } from "../../src/config"
import { ClientProvider, useClient } from "../../src/context/client"
import { DataProvider, useData } from "../../src/context/data"
import { RouteProvider, useRoute } from "../../src/context/route"
import { TuiAppProvider } from "../../src/context/runtime"
import { SessionTabsProvider, useSessionTabs } from "../../src/context/session-tabs"
import { NEW_SESSION_TAB_TITLE } from "../../src/context/session-tabs-model"
import { StorageProvider } from "../../src/context/storage"
import { createApi, createEventStream, createFetch, directory, json } from "../fixture/tui-client"
import { TestTuiContexts } from "../fixture/tui-environment"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"

async function wait(fn: () => boolean | Promise<boolean>, timeout = 2_000) {
  const start = Date.now()
  while (!(await fn())) {
    if (Date.now() - start > timeout) throw new Error("timed out waiting for condition")
    await Bun.sleep(10)
  }
}

// State directories are removed after the whole suite instead of per test: persistence writes are
// fire-and-forget behind a file lock, so a teardown-time removal races any still-queued write.
const stateDirs: string[] = []

afterAll(async () => {
  for (const dir of stateDirs) {
    // Drain any lock still held by a late write before deleting the tree beneath it.
    await wait(() => {
      try {
        return readdirSync(path.join(dir, "test", "locks")).length === 0
      } catch {
        return true
      }
    }).catch(() => undefined)
    rmSync(dir, { recursive: true, force: true })
  }
})

function stateDir(prefix: string) {
  const dir = mkdtempSync(path.join(tmpdir(), prefix))
  stateDirs.push(dir)
  return dir
}

type SessionFixture = { parentID?: string; title?: string; updated?: number }

async function renderSessionTabs(
  initialSessionID: string,
  options?: { state?: string; title?: string; sessions?: Record<string, SessionFixture> },
) {
  const state = options?.state ?? stateDir("opencode-session-tabs-")
  const events = createEventStream()
  const calls = createFetch((url) => {
    if (url.pathname === "/api/session" && url.searchParams.has("parentID")) {
      const parentID = url.searchParams.get("parentID")
      return json({
        data: Object.entries(options?.sessions ?? {}).flatMap(([id, fixture]) =>
          fixture.parentID === parentID ? [session(id, fixture)] : [],
        ),
        cursor: {},
      })
    }
    const match = /^\/api\/session\/([^/]+)$/.exec(url.pathname)
    if (!match) return
    const id = match[1]!
    const fixture = options?.sessions?.[id] ?? (id === initialSessionID ? { title: options?.title } : undefined)
    if (!fixture) return
    return json({ data: session(id, fixture) })

    function session(id: string, fixture: SessionFixture) {
      return {
        id,
        parentID: fixture.parentID,
        title: fixture.title,
        projectID: "project",
        location: { directory },
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { created: 0, updated: fixture.updated ?? 0 },
      }
    }
  }, events)
  let tabs!: ReturnType<typeof useSessionTabs>
  let route!: ReturnType<typeof useRoute>
  let client!: ReturnType<typeof useClient>
  let data!: ReturnType<typeof useData>

  function Probe() {
    tabs = useSessionTabs()
    route = useRoute()
    client = useClient()
    data = useData()
    return <box />
  }

  const app = await testRender(() => (
    <TestTuiContexts paths={{ state }}>
      <TuiAppProvider value={{ name: "test", version: "test", channel: "test" }}>
        <StorageProvider>
          <ConfigProvider config={createTuiResolvedConfig({ tabs: { enabled: true } })}>
            <RouteProvider initialRoute={{ type: "session", sessionID: initialSessionID }}>
              <ClientProvider api={createApi(calls.fetch)}>
                <DataProvider>
                  <SessionTabsProvider>
                    <Probe />
                  </SessionTabsProvider>
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
    state,
    emit: (event: OpenCodeEvent) => events.emit({ ...event, location: { directory } }),
    destroy() {
      app.renderer.destroy()
    },
  }
}

test("stores session tabs globally by default", async () => {
  const setup = await renderSessionTabs("first")

  try {
    const file = path.join(setup.state, "test", "tui", "tabs.json")
    await wait(() => Bun.file(file).size > 0)
    expect(await Bun.file(file).json()).toEqual({
      global: { tabs: [{ sessionID: "first" }], unread: {} },
      cwd: {},
    })
  } finally {
    setup.destroy()
  }
})

test("concurrent TUIs do not alternate shared tab titles from divergent session caches", async () => {
  const state = stateDir("opencode-session-tabs-shared-")
  let titled: Awaited<ReturnType<typeof renderSessionTabs>> | undefined
  let untitled: Awaited<ReturnType<typeof renderSessionTabs>> | undefined

  try {
    titled = await renderSessionTabs("shared", { state, title: "Generated title" })
    untitled = await renderSessionTabs("shared", { state })
    const file = path.join(state, "test", "tui", "tabs.json")
    await titled.data.session.sync("shared")
    await wait(async () => {
      if (!(await Bun.file(file).exists())) return false
      return (await Bun.file(file).json()).global.tabs[0]?.title === "Generated title"
    })
    const observed = ["Generated title"]
    const pending = new Set<Promise<void>>()
    const watcher = watch(path.dirname(file), (_, name) => {
      if (name !== path.basename(file)) return
      const read = Bun.file(file)
        .json()
        .then((value) => {
          const title = value.global.tabs[0]?.title
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
    titled?.destroy()
    untitled?.destroy()
  }
})

test("user prompt admissions pulse an already-busy background tab", async () => {
  const setup = await renderSessionTabs("background")
  const admitted = (sessionID: string, inputID: string): OpenCodeEvent => ({
    id: `evt_${inputID}`,
    created: Date.now(),
    type: "session.input.admitted",
    durable: { aggregateID: sessionID, seq: Number(inputID.replace(/\D/g, "")), version: 1 },
    data: {
      sessionID,
      inputID,
      input: { type: "user", data: { text: inputID }, delivery: "steer" },
    },
  })

  try {
    await wait(() => setup.tabs.tabs().some((tab) => tab.sessionID === "background"))
    setup.route.navigate({ type: "session", sessionID: "active" })
    await wait(() => setup.tabs.current() === "active" && setup.tabs.tabs().length === 2)

    setup.emit({
      id: "evt_context",
      created: Date.now(),
      type: "session.input.admitted",
      durable: { aggregateID: "background", seq: 0, version: 1 },
      data: {
        sessionID: "background",
        inputID: "msg_context",
        input: { type: "synthetic", data: { text: "editor context" }, delivery: "steer" },
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
    setup.destroy()
  }
})

test("tracks live inbox recency beyond cached session metadata", async () => {
  const setup = await renderSessionTabs("background")

  try {
    expect(setup.tabs.updated("background")).toBe(0)
    setup.emit({
      id: "evt_admitted",
      created: 100,
      type: "session.input.admitted",
      durable: { aggregateID: "background", seq: 1, version: 1 },
      data: {
        sessionID: "background",
        inputID: "msg_1",
        input: { type: "user", data: { text: "work" }, delivery: "steer" },
      },
    })
    await wait(() => setup.tabs.updated("background") === 100)

    setup.emit({
      id: "evt_succeeded",
      created: 200,
      type: "session.execution.succeeded",
      durable: { aggregateID: "background", seq: 2, version: 1 },
      data: { sessionID: "background" },
    })
    await wait(() => setup.tabs.updated("background") === 200)
  } finally {
    setup.destroy()
  }
})

test("tracks child activity before family hydration and after restart", async () => {
  const state = stateDir("opencode-session-tabs-recency-")
  const sessions: Record<string, SessionFixture> = { child: { parentID: "parent" } }
  const first = await renderSessionTabs("parent", { state, sessions })

  try {
    first.emit({
      id: "evt_child_succeeded",
      created: 200,
      type: "session.execution.succeeded",
      durable: { aggregateID: "child", seq: 1, version: 1 },
      data: { sessionID: "child" },
    })
    expect(first.tabs.updated("parent")).toBe(0)
    await first.data.session.sync("child")
    await wait(() => first.tabs.updated("parent") === 200)
  } finally {
    first.destroy()
  }

  sessions.child.updated = 200
  const second = await renderSessionTabs("parent", { state, sessions })
  try {
    expect(second.tabs.updated("parent")).toBe(0)
    await second.data.session.sync("parent", { children: true })
    await wait(() => second.tabs.updated("parent") === 200)
  } finally {
    second.destroy()
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
    setup.destroy()
  }
})

test("navigates the inbox without changing sessions and confirms done twice", async () => {
  const setup = await renderSessionTabs("first")

  try {
    await wait(() => setup.tabs.current() === "first")
    setup.route.navigate({ type: "session", sessionID: "second" })
    await wait(() => setup.tabs.current() === "second" && setup.tabs.tabs().length === 2)
    setup.route.navigate({ type: "session", sessionID: "first" })
    await wait(() => setup.tabs.current() === "first")

    expect(setup.tabs.navigation.focus()).toBe(true)
    expect(setup.tabs.navigation.selected()).toBe("first")
    setup.tabs.navigation.move(1)
    expect(setup.tabs.navigation.selected()).toBe("second")
    expect(setup.tabs.current()).toBe("first")

    setup.tabs.navigation.done()
    expect(setup.tabs.navigation.pendingDone()).toBe("second")
    expect(setup.tabs.tabs().map((tab) => tab.sessionID)).toEqual(["first", "second"])
    setup.tabs.navigation.done()
    await wait(() => setup.tabs.tabs().length === 1)

    expect(setup.tabs.tabs().map((tab) => tab.sessionID)).toEqual(["first"])
    expect(setup.tabs.current()).toBe("first")
    expect(setup.tabs.navigation.selected()).toBe("first")
  } finally {
    setup.destroy()
  }
})

test("keeps inbox focus aligned with history after marking the current session done", async () => {
  const setup = await renderSessionTabs("first")

  try {
    await wait(() => setup.tabs.current() === "first")
    setup.route.navigate({ type: "session", sessionID: "second" })
    await wait(() => setup.tabs.current() === "second")
    setup.route.navigate({ type: "session", sessionID: "third" })
    await wait(() => setup.tabs.current() === "third")
    setup.route.navigate({ type: "session", sessionID: "first" })
    await wait(() => setup.tabs.current() === "first" && setup.tabs.tabs().length === 3)

    setup.tabs.navigation.focus()
    setup.tabs.navigation.done()
    setup.tabs.navigation.done()
    await wait(() => setup.tabs.tabs().length === 2)

    expect(setup.tabs.current()).toBe("third")
    expect(setup.tabs.navigation.selected()).toBe("third")
  } finally {
    setup.destroy()
  }
})
