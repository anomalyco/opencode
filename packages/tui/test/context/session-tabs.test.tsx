/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import type { OpenCodeEvent } from "@opencode-ai/client"
import { testRender } from "@opentui/solid"
import { mkdtempSync, rmSync, watch } from "fs"
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

async function renderSessionTabs(initialSessionID: string, options?: { state?: string; title?: string }) {
  const state = options?.state ?? mkdtempSync(path.join(tmpdir(), "opencode-session-tabs-"))
  const events = createEventStream()
  const calls = createFetch((url) => {
    if (url.pathname !== `/api/session/${initialSessionID}`) return
    return json({
      data: {
        id: initialSessionID,
        title: options?.title,
        projectID: "project",
        location: { directory },
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { created: 0, updated: 0 },
      },
    })
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
      if (!options?.state) rmSync(state, { recursive: true, force: true })
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
  const state = mkdtempSync(path.join(tmpdir(), "opencode-session-tabs-shared-"))
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
    rmSync(state, { recursive: true, force: true })
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
