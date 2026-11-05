/** @jsxImportSource @opentui/solid */
import type { LocationRef } from "@opencode/client"
import { testRender } from "@opentui/solid"
import { test } from "bun:test"
import { onMount } from "solid-js"
import { useConnected } from "../../src/component/use-connected"
import { ClientProvider } from "../../src/context/client"
import { DataProvider, useData } from "../../src/context/data"
import { LocationProvider, useLocation } from "../../src/context/location"
import { createApi, createFetch, json } from "../fixture/tui-client"
import { TestTuiContexts } from "../fixture/tui-environment"

test("reads connections from the active location instead of the default location", async () => {
  const active: LocationRef = { directory: "/remote/project" }
  const calls = createFetch(async (url, request) => {
    if (url.pathname !== "/api/integration") return undefined
    const directory =
      url.searchParams.get("location[directory]") ??
      decodeURIComponent(request.headers.get("x-opencode-directory") ?? process.cwd())
    const connected = directory === active.directory
    return json({
      location: { directory, project: { id: "proj_test", directory, canonical: directory } },
      data: [
        {
          id: "openai",
          name: "OpenAI",
          methods: [{ type: "key", label: "API key" }],
          connections: connected ? [{ type: "env", name: "OPENAI_API_KEY" }] : [],
        },
      ],
    })
  })

  function Probe() {
    const data = useData()
    const location = useLocation()
    const connected = useConnected()
    onMount(() => {
      location.set(active)
      void data.location.integration.sync(active)
    })
    return <text>{connected() ? "connected" : "disconnected"}</text>
  }

  const app = await testRender(
    () => (
      <TestTuiContexts>
        <ClientProvider api={createApi(calls.fetch)}>
          <DataProvider directory={process.cwd()}>
            <LocationProvider>
              <Probe />
            </LocationProvider>
          </DataProvider>
        </ClientProvider>
      </TestTuiContexts>
    ),
    { width: 40, height: 3 },
  )

  try {
    app.renderer.start()
    await app.waitForFrame((frame) => frame.includes("connected") && !frame.includes("disconnected"))
  } finally {
    app.renderer.destroy()
  }
})
