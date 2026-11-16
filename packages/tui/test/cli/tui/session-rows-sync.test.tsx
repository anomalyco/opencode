/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { createEffect, createSignal, Show } from "solid-js"
import { ConfigProvider } from "../../../src/config"
import { ClientProvider, useClient } from "../../../src/context/client"
import { DataProvider, useData } from "../../../src/context/data"
import { createSessionRows } from "../../../src/routes/session/rows"
import { createApi, createEventStream, createFetch, json } from "../../fixture/tui-client"
import { tmpdir } from "../../fixture/fixture"
import { TestTuiContexts } from "../../fixture/tui-environment"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"

test.each(["cached", "cold"] as const)(
  "projects %s history and completes sync with one request",
  async (mode) => {
    await using state = await tmpdir()
    const sessionID = "session-row-sync"
    const events = createEventStream()
    const response = Promise.withResolvers<void>()
    const changed = mode === "cold"
    let requests = 0
    const calls = createFetch(async (url) => {
      if (url.pathname !== `/api/session/${sessionID}/message`) return
      requests++
      if (changed) await response.promise
      return json({
        data: [
          changed
            ? {
                id: "msg_001",
                type: "assistant",
                agent: "build",
                model: { id: "model", providerID: "provider" },
                time: { created: 1 },
                content: [{ type: "text", text: "Changed content" }],
              }
            : { id: "msg_001", type: "user", text: "Cached content", time: { created: 1 } },
        ],
        cursor: {},
      })
    }, events)
    const connected = Promise.withResolvers<ReturnType<typeof useData>>()
    const synced = Promise.withResolvers<ReturnType<typeof createSessionRows>>()
    const [mounted, setMounted] = createSignal(false)
    let completions = 0

    function Rows() {
      const rows = createSessionRows(
        () => sessionID,
        () => {
          completions++
          synced.resolve(rows)
        },
      )
      return <box />
    }

    function Probe() {
      const data = useData()
      const client = useClient()
      createEffect(() => {
        if (client.connection.status() === "connected") connected.resolve(data)
      })
      return (
        <Show when={mounted()}>
          <Rows />
        </Show>
      )
    }

    const app = await testRender(
      () => (
        <TestTuiContexts paths={{ state: state.path, home: state.path }}>
          <ClientProvider api={createApi(calls.fetch)}>
            <ConfigProvider config={createTuiResolvedConfig()}>
              <DataProvider directory={process.cwd()}>
                <Probe />
              </DataProvider>
            </ConfigProvider>
          </ClientProvider>
        </TestTuiContexts>
      ),
      { width: 100, height: 30 },
    )
    try {
      const data = await connected.promise
      if (mode === "cached") await data.session.message.sync(sessionID)
      setMounted(true)
      response.resolve()
      const rows = await synced.promise
      expect(completions).toBe(1)
      expect(rows.map((row) => row.type)).toEqual(mode === "cached" ? ["message"] : ["part"])
      expect(data.session.message.list(sessionID)).toHaveLength(1)
      expect(requests).toBe(1)
    } finally {
      response.resolve()
      app.renderer.destroy()
    }
  },
)
