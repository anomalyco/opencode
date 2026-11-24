/** @jsxImportSource @opentui/solid */
import { expect, jest, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { ConfigProvider } from "../../src/config"
import { ClientProvider, useClient } from "../../src/context/client"
import { DataProvider } from "../../src/context/data"
import { LocationProvider, useLocation } from "../../src/context/location"
import { createApi, createEventStream, createFetch, directory, json } from "../fixture/tui-client"
import { TestTuiContexts } from "../fixture/tui-environment"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"

async function wait(fn: () => boolean, timeout = 5_000) {
  const startedAt = Date.now()
  while (!fn()) {
    if (Date.now() - startedAt > timeout) throw new Error("timed out waiting for the client to connect")
    await Bun.sleep(10)
  }
}

async function advance(ms: number) {
  for (let i = 0; i < 50; i++) await Promise.resolve()
  jest.advanceTimersByTime(ms)
  for (let i = 0; i < 50; i++) await Promise.resolve()
}

test("keeps checking a missing location until its folder is back or the session is left", async () => {
  const away = "/mnt/away"
  const gone = "/mnt/gone"
  const checks: Record<string, number> = { [away]: 0, [gone]: 0 }
  let mounted = false
  const calls = createFetch((url) => {
    if (url.pathname !== "/api/agent") return
    const location = url.searchParams.get("location[directory]")
    if (!location || !(location in checks)) return
    checks[location]++
    if (location === away && mounted) return
    return json(
      { _tag: "LocationNotFoundError", message: "Location does not exist", location: { directory: location } },
      { status: 404 },
    )
  }, createEventStream())

  let location!: ReturnType<typeof useLocation>
  let client!: ReturnType<typeof useClient>
  function Probe() {
    location = useLocation()
    client = useClient()
    return <box />
  }

  const app = await testRender(() => (
    <TestTuiContexts>
      <ConfigProvider config={createTuiResolvedConfig({ animations: false })}>
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

  try {
    await wait(() => client.connection.status() === "connected")
    jest.useFakeTimers()

    location.set({ directory: away })
    await advance(0)
    expect(checks[away]).toBe(1)
    expect(location.error?.location.directory).toBe(away)

    // Still missing: the error stays up while the folder is checked again.
    await advance(15_000)
    expect(checks[away]).toBe(2)
    expect(location.error?.location.directory).toBe(away)

    mounted = true
    await advance(15_000)
    expect(checks[away]).toBe(3)
    expect(location.error).toBeUndefined()
    await advance(60_000)
    expect(checks[away]).toBe(3)

    // Leaving a missing location stops its checks.
    location.set({ directory: gone })
    await advance(0)
    expect(location.error?.location.directory).toBe(gone)
    location.set({ directory })
    await advance(60_000)
    expect(checks[gone]).toBe(1)
    expect(location.error).toBeUndefined()
  } finally {
    jest.useRealTimers()
    app.renderer.destroy()
  }
})
