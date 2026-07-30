/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import type { OpenCodeEvent } from "@opencode-ai/client"
import { testRender } from "@opentui/solid"
import { mkdtempSync, rmSync } from "fs"
import { tmpdir } from "os"
import path from "path"
import { ConfigProvider } from "../../src/config"
import { ClientProvider, useClient } from "../../src/context/client"
import { DataProvider } from "../../src/context/data"
import { RouteProvider, useRoute } from "../../src/context/route"
import { TuiAppProvider } from "../../src/context/runtime"
import { SessionTabsProvider, useSessionTabs } from "../../src/context/session-tabs"
import { StorageProvider } from "../../src/context/storage"
import { createApi, createEventStream, createFetch, directory } from "../fixture/tui-client"
import { TestTuiContexts } from "../fixture/tui-environment"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"

async function wait(fn: () => boolean, timeout = 2_000) {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > timeout) throw new Error("timed out waiting for condition")
    await Bun.sleep(10)
  }
}

test("user prompt admissions pulse an already-busy background tab", async () => {
  const state = mkdtempSync(path.join(tmpdir(), "opencode-session-tabs-"))
  const events = createEventStream()
  const calls = createFetch(undefined, events)
  let tabs!: ReturnType<typeof useSessionTabs>
  let route!: ReturnType<typeof useRoute>
  let client!: ReturnType<typeof useClient>

  function Probe() {
    tabs = useSessionTabs()
    route = useRoute()
    client = useClient()
    return <box />
  }

  const app = await testRender(() => (
    <TestTuiContexts paths={{ state }}>
      <TuiAppProvider value={{ name: "test", version: "test", channel: "test" }}>
        <StorageProvider>
          <ConfigProvider config={createTuiResolvedConfig({ tabs: { enabled: true } })}>
            <RouteProvider initialRoute={{ type: "session", sessionID: "background" }}>
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

  const emit = (event: OpenCodeEvent) => events.emit({ ...event, location: { directory } })
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
    await wait(
      () => client.connection.status() === "connected" && tabs.tabs().some((tab) => tab.sessionID === "background"),
    )
    route.navigate({ type: "session", sessionID: "active" })
    await wait(() => tabs.current() === "active" && tabs.tabs().length === 2)

    emit({
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
    expect(tabs.status("background").promptPulse).toBe(0)

    emit(admitted("background", "msg_1"))
    await wait(() => tabs.status("background").promptPulse === 1 && tabs.status("background").busy)

    emit(admitted("background", "msg_2"))
    await wait(() => tabs.status("background").promptPulse === 2)

    emit(admitted("active", "msg_3"))
    await Bun.sleep(20)
    expect(tabs.status("active").promptPulse).toBe(0)
    expect(tabs.status("background")).toMatchObject({ promptPulse: 2, busy: true })
  } finally {
    app.renderer.destroy()
    rmSync(state, { recursive: true, force: true })
  }
})
