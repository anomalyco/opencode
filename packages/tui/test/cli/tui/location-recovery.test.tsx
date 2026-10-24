/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { onMount } from "solid-js"
import { ClientProvider, useClient } from "../../../src/context/client"
import { DataProvider, useData } from "../../../src/context/data"
import { LocationProvider, useLocation } from "../../../src/context/location"
import { createApi, createEventStream, createFetch, directory, json } from "../../fixture/tui-client"
import { TestTuiContexts } from "../../fixture/tui-environment"

const target = "/tmp/opencode/other-clone"

async function wait(predicate: () => boolean, timeout = 20_000) {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeout) throw new Error("timed out waiting for condition")
    await Bun.sleep(10)
  }
}

function notFound() {
  return json(
    {
      _tag: "LocationNotFoundError",
      location: { directory: target },
      message: `Location not found: ${target}`,
    },
    { status: 404 },
  )
}

function render(fail: (url: URL) => Response | undefined) {
  const calls = createFetch(fail, createEventStream())
  const connected = Promise.withResolvers<void>()
  let location!: ReturnType<typeof useLocation>
  let client!: ReturnType<typeof useClient>

  function Probe() {
    location = useLocation()
    client = useClient()
    // The client syncs the current location again once the server connects, so wait for that
    // event before asking for a location of its own.
    onMount(() => client.event.on("server.connected", () => connected.resolve()))
    return null
  }

  const app = testRender(
    () => (
      <TestTuiContexts cwd={directory}>
        <ClientProvider api={createApi(calls.fetch)}>
          <DataProvider directory={directory}>
            <LocationProvider>
              <Probe />
            </LocationProvider>
          </DataProvider>
        </ClientProvider>
      </TestTuiContexts>
    ),
    { width: 100, height: 30, kittyKeyboard: true },
  )
  return {
    app,
    connected: connected.promise,
    get location() {
      return location
    },
  }
}

test("a location the server reports as missing is asked once", async () => {
  let requests = 0
  const fixture = render((url) => {
    if (url.pathname !== "/api/location") return undefined
    if (url.searchParams.get("location[directory]") !== target) return undefined
    requests++
    return notFound()
  })
  const app = await fixture.app
  try {
    await fixture.connected
    fixture.location.set({ directory: target })
    await wait(() => fixture.location.error !== undefined)
    // A missing folder cannot be fixed by retrying, so the client asks once.
    expect(requests).toBe(1)
    expect(fixture.location.error?.location.directory).toBe(target)
  } finally {
    app.renderer.destroy()
  }
})

test("a location that fails for another reason is retried", async () => {
  let requests = 0
  const fixture = render((url) => {
    if (url.pathname !== "/api/location") return undefined
    if (url.searchParams.get("location[directory]") !== target) return undefined
    requests++
    return json({ message: "Location unavailable" }, { status: 503 })
  })
  const app = await fixture.app
  try {
    await fixture.connected
    fixture.location.set({ directory: target })
    await wait(() => requests >= 3)
    // The folder may still be there, so the client does not report the location as missing.
    expect(requests).toBe(3)
    expect(fixture.location.error).toBeUndefined()
  } finally {
    app.renderer.destroy()
  }
})

test("a location sync reads the location once", async () => {
  let reads = 0
  const calls = createFetch((url) => {
    if (url.pathname !== "/api/location") return undefined
    if (url.searchParams.get("location[directory]") !== target) return undefined
    reads++
    return json({
      location: { directory: target, project: { id: "proj_test", directory: target, canonical: target } },
    })
  }, createEventStream())
  let data!: ReturnType<typeof useData>

  function Probe() {
    data = useData()
    return null
  }

  const app = await testRender(
    () => (
      <TestTuiContexts cwd={directory}>
        <ClientProvider api={createApi(calls.fetch)}>
          <DataProvider directory={directory}>
            <Probe />
          </DataProvider>
        </ClientProvider>
      </TestTuiContexts>
    ),
    { width: 100, height: 30, kittyKeyboard: true },
  )
  try {
    // The client reads the location before its resources, so one sync is one location read.
    await data.location.sync({ directory: target })
    expect(reads).toBe(1)
  } finally {
    app.renderer.destroy()
  }
})
