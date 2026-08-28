import { expect, test } from "bun:test"
import { Show, createRoot, createSignal } from "solid-js"
import { messageCacheReleaseLimit } from "@opencode-ai/client/solid"
import { ConfigProvider } from "../../../src/config"
import { ClientProvider, useClient } from "../../../src/context/client"
import { DataProvider as DataProviderBase, useData } from "../../../src/context/data"
import { createSessionRows } from "../../../src/routes/session/rows"
import { createApi, createEventStream, createFetch, json } from "../../fixture/tui-client"
import { TestTuiContexts } from "../../fixture/tui-environment"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"

const sessionID = "session-switch-perf"
const destination = "session-switch-destination"
// Stands in for the shared route store: a switch writes the destination before the outgoing
// view is disposed, so teardown must not read this to learn which session it was showing.
const route = { sessionID }
const total = 5_000
const pageLimit = 20
const messages = Array.from({ length: total }, (_, index) => ({
  id: `msg_${String(index).padStart(6, "0")}`,
  type: "user" as const,
  text: `message ${index}`,
  time: { created: index },
}))

// Page k counts back from the newest message; data is newest-first, matching order "desc".
const page = (k: number) => {
  const end = total - k * pageLimit
  return messages.slice(Math.max(0, end - pageLimit), end).toReversed()
}

const events = createEventStream()
const calls = createFetch((url) => {
  if (url.pathname === `/api/session/${sessionID}/message`) {
    const k = Number(url.searchParams.get("cursor") ?? 0)
    const next = (k + 1) * pageLimit < total ? String(k + 1) : undefined
    return json({ data: page(k), cursor: { next } })
  }
  return undefined
}, events)

const config = createTuiResolvedConfig()

// The data provider stays mounted across Probe disposals, mirroring a session switch that
// remounts the session view while the app keeps its data layer.
const [present, setPresent] = createSignal(true)

type Harness = {
  data: ReturnType<typeof useData>
  client: ReturnType<typeof useClient>
  rows: ReturnType<typeof createSessionRows>
  synced: () => number
  dispose: () => void
}

function mount(): Harness {
  let syncedCount = 0
  let data!: ReturnType<typeof useData>
  let client!: ReturnType<typeof useClient>
  let rows!: ReturnType<typeof createSessionRows>
  function Probe() {
    data = useData()
    client = useClient()
    rows = createSessionRows(() => route.sessionID, () => syncedCount++)
    return null
  }

  const dispose = createRoot((dispose) => {
    // Provider-only tree: no opentui elements, so nothing needs a terminal renderer.
    const tree = (
      <TestTuiContexts>
        <ConfigProvider config={config}>
          <ClientProvider api={createApi(calls.fetch)}>
            <DataProviderBase directory={process.cwd()}>
              <Show when={present()}>
                <Probe />
              </Show>
            </DataProviderBase>
          </ClientProvider>
        </ConfigProvider>
      </TestTuiContexts>
    )
    void tree
    return dispose
  })
  return {
    get data() {
      return data
    },
    get client() {
      return client
    },
    get rows() {
      return rows
    },
    synced: () => syncedCount,
    dispose,
  }
}

async function wait(fn: () => boolean, timeout = 4_000) {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > timeout) throw new Error("timed out waiting for condition")
    await Bun.sleep(5)
  }
}

test("repaints a released session from one fresh page and stays bounded", async () => {
  route.sessionID = sessionID
  const app = mount()
  try {
    await wait(() => app.client.connection.status() === "connected")
    await wait(() => app.synced() > 0)
    expect(app.data.session.message.list(sessionID)).toHaveLength(pageLimit)

    while (app.data.session.message.more(sessionID) && app.data.session.message.list(sessionID).length < 460)
      await app.data.session.message.loadMore(sessionID)
    expect(app.data.session.message.list(sessionID).length).toBeGreaterThan(messageCacheReleaseLimit)

    route.sessionID = destination
    setPresent(false)
    await wait(() => app.data.session.message.list(sessionID).length === 0)
    expect(app.data.session.message.list(destination)).toHaveLength(0)
    expect(app.data.session.message.more(sessionID)).toBe(false)

    const reentry = performance.now()
    route.sessionID = sessionID
    setPresent(true)
    await wait(() => app.synced() >= 2)
    const elapsed = performance.now() - reentry
    console.log(`[session-switch-perf] re-entry repaint of a ${total}-message session: ${elapsed.toFixed(1)}ms`)
    expect(app.data.session.message.list(sessionID)).toHaveLength(pageLimit)
    expect(app.rows.length).toBe(pageLimit)
    expect(elapsed).toBeLessThan(5_000)
  } finally {
    app.dispose()
  }
})

test("keeps a small transcript cache across leaving the session view", async () => {
  route.sessionID = sessionID
  const app = mount()
  try {
    await wait(() => app.client.connection.status() === "connected")
    await wait(() => app.synced() > 0)
    expect(app.data.session.message.list(sessionID)).toHaveLength(pageLimit)

    setPresent(false)
    await Bun.sleep(50)
    expect(app.data.session.message.list(sessionID)).toHaveLength(pageLimit)
    expect(app.data.session.message.more(sessionID)).toBe(true)
  } finally {
    app.dispose()
  }
})
