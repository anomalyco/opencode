/** @jsxImportSource @opentui/solid */
import { expect, jest, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { ClientProvider, useClient } from "../../src/context/client"
import { DataProvider } from "../../src/context/data"
import { LocationProvider, useLocation } from "../../src/context/location"
import { createApi, createEventStream, createFetch, directory, json } from "../fixture/tui-client"
import { TestTuiContexts } from "../fixture/tui-environment"

async function wait(fn: () => boolean, timeout = 5_000, label = "condition") {
  const startedAt = Date.now()
  while (!fn()) {
    if (Date.now() - startedAt > timeout) throw new Error(`timed out waiting for ${label}`)
    await Bun.sleep(10)
  }
}

const other = "/cold-other"
const busy = "/cold-busy"
const missing = "/cold-missing"

test("retries other failures three times, 503s until the cold-start timeout, and 404s never", async () => {
  const events = createEventStream()
  const attempts: Record<string, number> = { [other]: 0, [busy]: 0, [missing]: 0 }
  const calls = createFetch((url) => {
    if (url.pathname !== "/api/agent") return
    const location = url.searchParams.get("location[directory]")
    if (!location || !(location in attempts)) return
    attempts[location]++
    if (location === busy)
      return json(
        { _tag: "ServiceUnavailableError", message: "Location plugins did not finish activating", service: "plugin" },
        { status: 503 },
      )
    if (location === missing)
      return json(
        { _tag: "LocationNotFoundError", message: "Location does not exist", location: { directory: location } },
        { status: 404 },
      )
    return new Response(null, { status: 500 })
  }, events)

  let location!: ReturnType<typeof useLocation>
  let client!: ReturnType<typeof useClient>
  function Probe() {
    location = useLocation()
    client = useClient()
    return <box />
  }

  const app = await testRender(() => (
    <TestTuiContexts>
      <ClientProvider api={createApi(calls.fetch)}>
        <DataProvider directory={directory}>
          <LocationProvider>
            <Probe />
          </LocationProvider>
        </DataProvider>
      </ClientProvider>
    </TestTuiContexts>
  ))

  async function advance(ms: number) {
    for (let i = 0; i < 50; i++) await Promise.resolve()
    jest.advanceTimersByTime(ms)
    for (let i = 0; i < 50; i++) await Promise.resolve()
  }

  try {
    await wait(() => client.connection.status() === "connected")
    jest.useFakeTimers()

    // A persistent non-503 failure keeps the original three attempts, then surfaces and stops.
    location.set({ directory: other })
    await advance(0)
    expect(attempts[other]).toBe(1)
    await advance(1_000)
    expect(attempts[other]).toBe(2)
    await advance(2_000)
    expect(attempts[other]).toBe(3)
    await advance(10_000)
    expect(attempts[other]).toBe(3)

    // LocationNotFoundError is terminal on the first attempt and is surfaced as the missing location.
    location.set({ directory: missing })
    await advance(0)
    expect(attempts[missing]).toBe(1)
    await advance(10_000)
    expect(attempts[missing]).toBe(1)
    expect(location.error?.location.directory).toBe(missing)

    // 503s while plugins activate keep retrying past three attempts until the five-minute window ends.
    location.set({ directory: busy })
    await advance(0)
    expect(attempts[busy]).toBe(1)
    await advance(1_000)
    await advance(2_000)
    await advance(4_000)
    expect(attempts[busy]).toBe(4)
    for (let elapsed = 7_000; elapsed < 5 * 60 * 1000; elapsed += 5_000) await advance(5_000)
    const total = attempts[busy]
    expect(total).toBeGreaterThan(4)
    await advance(30_000)
    expect(attempts[busy]).toBe(total)
  } finally {
    jest.useRealTimers()
    app.renderer.destroy()
  }
})
