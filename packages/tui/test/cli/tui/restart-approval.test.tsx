/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { ConfigProvider } from "../../../src/config"
import { ClientProvider } from "../../../src/context/client"
import { DataProvider, useData } from "../../../src/context/data"
import { Keymap } from "../../../src/context/keymap"
import { RestartApprovalProvider, useRestartApproval } from "../../../src/context/restart-approval"
import { ThemeProvider } from "../../../src/context/theme"
import { DialogProvider } from "../../../src/ui/dialog"
import { ToastProvider } from "../../../src/ui/toast"
import { emptyThemeSource } from "../../fixture/fixture"
import { createApi, createEventStream, createFetch, json } from "../../fixture/tui-client"
import { TestTuiContexts } from "../../fixture/tui-environment"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"

const directory = "/tmp/opencode/restart-approval"
const title = "Restart service with running agents?"

test("restart request opens approval dialog and deciding resolves the intent", async () => {
  const fixture = await renderApproval()
  try {
    await fixture.data.session.sync("ses_1")
    fixture.events.emit({
      id: "evt_restart_requested",
      type: "server.restart.requested",
      created: 1,
      data: { active: ["ses_1", "ses_2"] },
    })
    const frame = await fixture.app.waitForFrame((frame) => frame.includes(title) && frame.includes("Lane one"))
    expect(frame).toContain("ses_2")

    await fixture.approval.decide("idle")

    await fixture.app.waitFor(() => fixture.resolves.length === 1)
    expect(fixture.resolves).toEqual([{ decision: "idle" }])
  } finally {
    fixture.app.renderer.destroy()
  }
})

test("resolution from another surface dismisses the dialog", async () => {
  const fixture = await renderApproval()
  try {
    fixture.events.emit({
      id: "evt_restart_requested",
      type: "server.restart.requested",
      created: 1,
      data: { active: ["ses_1"] },
    })
    await fixture.app.waitForFrame((frame) => frame.includes(title))
    fixture.events.emit({
      id: "evt_restart_resolved",
      type: "server.restart.resolved",
      created: 2,
      data: { decision: "now" },
    })
    await fixture.app.waitForFrame((frame) => !frame.includes(title))
    expect(fixture.resolves).toEqual([])
  } finally {
    fixture.app.renderer.destroy()
  }
})

test("an expired request dismisses the dialog", async () => {
  const fixture = await renderApproval()
  try {
    fixture.events.emit({
      id: "evt_restart_requested",
      type: "server.restart.requested",
      created: 1,
      data: { active: ["ses_1"] },
    })
    await fixture.app.waitForFrame((frame) => frame.includes(title))
    fixture.events.emit({
      id: "evt_restart_expired",
      type: "server.restart.expired",
      created: 2,
      data: {},
    })
    await fixture.app.waitForFrame((frame) => !frame.includes(title))
    expect(fixture.resolves).toEqual([])
  } finally {
    fixture.app.renderer.destroy()
  }
})

test("a stale resolve dismisses silently without an error toast", async () => {
  const fixture = await renderApproval({ resolveFails: true })
  try {
    fixture.events.emit({
      id: "evt_restart_requested",
      type: "server.restart.requested",
      created: 1,
      data: { active: ["ses_1"] },
    })
    await fixture.app.waitForFrame((frame) => frame.includes(title))

    await fixture.approval.decide("now")

    await fixture.app.waitFor(() => fixture.resolves.length === 1)
    const frame = await fixture.app.waitForFrame((frame) => !frame.includes(title))
    expect(frame).not.toContain("Failed to resolve restart")
  } finally {
    fixture.app.renderer.destroy()
  }
})

async function renderApproval(input: { resolveFails?: boolean } = {}) {
  const resolves: unknown[] = []
  const events = createEventStream()
  const calls = createFetch(async (url, request) => {
    if (url.pathname === "/api/server/restart/resolve") {
      const payload = await request.json()
      resolves.push(payload)
      if (input.resolveFails)
        return json({ _tag: "InvalidRequestError", message: "No pending service restart request" }, { status: 400 })
      return json({ decision: payload.decision })
    }
    if (url.pathname === "/api/session/ses_1") {
      return json({
        data: {
          id: "ses_1",
          projectID: "proj_test",
          location: { directory },
          title: "Lane one",
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          time: { created: 1, updated: 1 },
        },
      })
    }
    return undefined
  }, events)
  let data!: ReturnType<typeof useData>
  let approval!: ReturnType<typeof useRestartApproval>

  function Probe() {
    data = useData()
    approval = useRestartApproval()
    return null
  }

  const app = await testRender(
    () => (
      <TestTuiContexts cwd={directory}>
        <ConfigProvider config={createTuiResolvedConfig()}>
          <Keymap.Provider>
            <ToastProvider>
              <ClientProvider api={createApi(calls.fetch)}>
                <DataProvider directory={directory}>
                  <ThemeProvider mode="dark" source={emptyThemeSource}>
                    <DialogProvider>
                      <RestartApprovalProvider>
                        <Probe />
                      </RestartApprovalProvider>
                    </DialogProvider>
                  </ThemeProvider>
                </DataProvider>
              </ClientProvider>
            </ToastProvider>
          </Keymap.Provider>
        </ConfigProvider>
      </TestTuiContexts>
    ),
    { width: 100, height: 30, kittyKeyboard: true },
  )
  app.renderer.start()
  await app.waitFor(() => approval !== undefined)

  return { app, data, approval, events, resolves }
}
