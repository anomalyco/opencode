/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { createEffect } from "solid-js"
import { ConfigProvider } from "../../src/config"
import { ClientProvider, useClient } from "../../src/context/client"
import { DataProvider, useData } from "../../src/context/data"
import { LocationProvider, useLocation } from "../../src/context/location"
import { createApi, createEventStream, createFetch, directory, json } from "../fixture/tui-client"
import { TestTuiContexts } from "../fixture/tui-environment"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"
import { useToast } from "../../src/ui/toast"

test.each([
  { endpoint: "location", reconnect: false },
  { endpoint: "agent", reconnect: false },
  { endpoint: "agent", reconnect: true },
])("a late failure cannot replace the new sync's state (%o)", async ({ endpoint, reconnect }) => {
  // Keep the held lookup separate from the client's launch-directory preload.
  const source = `${directory}/old`
  const requested = Promise.withResolvers<void>()
  const response = Promise.withResolvers<Response>()
  const events = createEventStream()
  let requests = 0
  let connections = 0
  const calls = createFetch((url) => {
    if (url.pathname === "/api/event") connections++
    const target = url.searchParams.get("location[directory]") ?? directory
    if (target === source && url.pathname === `/api/${endpoint}` && ++requests === 1) {
      requested.resolve()
      return response.promise
    }
    const location = { directory: target, project: { id: "project", directory: target, canonical: target } }
    if (url.pathname === "/api/location") return json(location)
    if (url.pathname === "/api/agent") return json({ location, data: [] })
    return undefined
  }, events)
  let location!: ReturnType<typeof useLocation>
  let data!: ReturnType<typeof useData>
  let toast!: ReturnType<typeof useToast>
  function Probe() {
    const client = useClient()
    location = useLocation()
    data = useData()
    toast = useToast()
    location.set({ directory: source })
    createEffect(() => {
      // Connection status changes before the buffered server.connected event is published.
      // Deliver the old HTTP failure in that gap, not after an arbitrary timer.
      if (client.connection.status() === "connected" && reconnect && connections > 1)
        response.resolve(json({ message: "Old location sync failed" }, { status: 500 }))
    })
    return <box />
  }
  const app = await testRender(() => (
    <TestTuiContexts>
      <ConfigProvider config={createTuiResolvedConfig()}>
        <ClientProvider api={createApi(calls.fetch)}>
          <DataProvider directory={directory}>
            <LocationProvider>
              <Probe />
            </LocationProvider>
          </DataProvider>
        </ClientProvider>
      </ConfigProvider>
    </TestTuiContexts>
  ))
  app.renderer.start()
  try {
    await requested.promise
    const target = reconnect ? source : "/other"
    if (reconnect) {
      events.disconnect()
      await app.waitFor(() => connections > 1, { maxPasses: 120 })
    }
    if (!reconnect) location.set({ directory: target })
    if (!reconnect) response.resolve(json({ message: "Old location sync failed" }, { status: 500 }))
    await app.waitFor(() => data.location.agent.list({ directory: target }) !== undefined)
    await app.waitForVisualIdle()
    expect(location.ref).toEqual({ directory: target })
    expect(location.current?.directory).toBe(target)
    expect(location.error).toBeUndefined()
    expect(toast.currentToast).toBeNull()
  } finally {
    response.resolve(json({ message: "Old location sync failed" }, { status: 500 }))
    app.renderer.destroy()
  }
})

test("catalog failures preserve resolved info and an old Retry cannot sync a different location", async () => {
  const requests: string[] = []
  const causes: unknown[] = []
  const failure = Promise.withResolvers<Response>()
  const calls = createFetch((url) => {
    const target = url.searchParams.get("location[directory]") ?? directory
    requests.push(`${target}:${url.pathname}`)
    const location = { directory: target, project: { id: "project", directory: target, canonical: target } }
    if (url.pathname === "/api/location") return json(location)
    if (url.pathname === "/api/agent" && target === directory) return failure.promise
    if (url.pathname === "/api/agent") return json({ location, data: [] })
    return undefined
  }, createEventStream())
  let location!: ReturnType<typeof useLocation>
  let data!: ReturnType<typeof useData>
  let toast!: ReturnType<typeof useToast>
  function Probe() {
    location = useLocation()
    data = useData()
    toast = useToast()
    location.set({ directory })
    return <box />
  }
  const app = await testRender(() => (
    <TestTuiContexts
      log={(_, message, tags) => {
        if (message === "Session data sync failed") causes.push(tags.cause)
      }}
    >
      <ConfigProvider config={createTuiResolvedConfig()}>
        <ClientProvider api={createApi(calls.fetch)}>
          <DataProvider directory={directory}>
            <LocationProvider>
              <Probe />
            </LocationProvider>
          </DataProvider>
        </ClientProvider>
      </ConfigProvider>
    </TestTuiContexts>
  ))
  app.renderer.start()
  try {
    await app.waitFor(() => requests.includes(`${directory}:/api/agent`))
    const original = data.location.agent.sync({ directory }).catch((cause: unknown) => cause)
    failure.resolve(json({ message: "Agent catalog temporarily unavailable" }, { status: 500 }))
    await app.waitFor(() => toast.currentToast !== null)
    expect(causes).toEqual([await original])
    expect(causes[0]).toBe(await original)
    expect(location.current?.directory).toBe(directory)
    expect(location.error).toBeUndefined()
    const retry = toast.currentToast?.action?.run
    expect(retry).toBeDefined()
    location.set({ directory: "/other" })
    await app.waitFor(() => data.location.agent.list({ directory: "/other" }) !== undefined)
    const before = requests.length
    retry?.()
    await app.waitForVisualIdle()
    expect(requests).toHaveLength(before)
    expect(location.ref).toEqual({ directory: "/other" })
    expect(location.error).toBeUndefined()
  } finally {
    failure.resolve(json({ message: "Agent catalog temporarily unavailable" }, { status: 500 }))
    app.renderer.destroy()
  }
})
