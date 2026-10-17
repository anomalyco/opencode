/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { ConfigProvider } from "../../../src/config"
import { ClientProvider } from "../../../src/context/client"
import { DataProvider, useData } from "../../../src/context/data"
import { LocationProvider, useLocation } from "../../../src/context/location"
import { Keymap } from "../../../src/context/keymap"
import { createApi, createEventStream, createFetch, json } from "../../fixture/tui-client"
import { TestTuiContexts } from "../../fixture/tui-environment"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"

const directory = "/tmp/opencode/missing-clone"

test("transient location sync failure does not flag the location as missing", async () => {
  const fixture = await renderLocation("transient")
  try {
    fixture.location.set({ directory })
    await fixture.app.waitFor(() => fixture.reads.includes(directory))
    // Let the sync rejection settle through LocationProvider's catch.
    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(fixture.location.error).toBeUndefined()
  } finally {
    fixture.app.renderer.destroy()
  }
})

test("typed LocationNotFoundError flags the location as missing", async () => {
  const fixture = await renderLocation("not-found")
  try {
    fixture.location.set({ directory })
    await fixture.app.waitFor(() => fixture.location.error !== undefined)

    expect(fixture.location.error?.location.directory).toBe(directory)
  } finally {
    fixture.app.renderer.destroy()
  }
})

async function renderLocation(mode: "transient" | "not-found") {
  const reads: string[] = []
  const calls = createFetch(async (url) => {
    if (url.pathname === "/api/location") {
      const requested = url.searchParams.get("location[directory]") ?? ""
      reads.push(requested)
      if (requested === directory) {
        if (mode === "not-found")
          return json(
            {
              _tag: "LocationNotFoundError",
              location: { directory },
              message: `Location not found: ${directory}`,
            },
            { status: 404 },
          )
        return json({ message: "Location unavailable" }, { status: 503 })
      }
    }
    return undefined
  }, createEventStream())
  let data!: ReturnType<typeof useData>
  let location!: ReturnType<typeof useLocation>

  function Probe() {
    data = useData()
    location = useLocation()
    return null
  }

  const app = await testRender(
    () => (
      <TestTuiContexts cwd={directory}>
        <ConfigProvider config={createTuiResolvedConfig()}>
          <Keymap.Provider>
            <ClientProvider api={createApi(calls.fetch)}>
              <DataProvider directory={directory}>
                <LocationProvider>
                  <Probe />
                </LocationProvider>
              </DataProvider>
            </ClientProvider>
          </Keymap.Provider>
        </ConfigProvider>
      </TestTuiContexts>
    ),
    { width: 100, height: 30, kittyKeyboard: true },
  )
  app.renderer.start()
  await app.waitFor(() => location !== undefined)

  return { app, data, location, reads }
}
