/** @jsxImportSource @opentui/solid */
import type { AutomationInfo } from "@opencode/client"
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { onMount } from "solid-js"
import { DialogAutomations } from "../../../src/component/dialog-automations"
import { ConfigProvider } from "../../../src/config"
import { ClientProvider } from "../../../src/context/client"
import { DataProvider } from "../../../src/context/data"
import { Keymap } from "../../../src/context/keymap"
import { LocationProvider } from "../../../src/context/location"
import { RouteProvider, useRoute } from "../../../src/context/route"
import { ThemeProvider } from "../../../src/context/theme"
import { DialogProvider, useDialog } from "../../../src/ui/dialog"
import { ToastProvider } from "../../../src/ui/toast"
import { emptyThemeSource } from "../../fixture/fixture"
import { createApi, createEventStream, createFetch, directory, json } from "../../fixture/tui-client"
import { TestTuiContexts } from "../../fixture/tui-environment"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"

test("lists automations grouped by session, pauses/resumes with space, inspects on enter, and deletes with ctrl+d", async () => {
  const fixture = await renderAutomations()

  try {
    await fixture.app.waitForFrame((frame) => frame.includes("PR #60478 CI watch"))
    const initial = fixture.app.captureCharFrame()
    expect(initial).toContain("This session")
    expect(initial).toContain("Other sessions")
    expect(initial).toContain("Morning brief")
    expect(initial).toContain("until $ gh pr checks 60478")

    // Space pauses the active automation in this session, then space resumes it.
    fixture.app.mockInput.pressKey(" ")
    await fixture.app.waitForFrame((frame) => frame.includes("Paused ○"))
    expect(fixture.paused).toEqual(["aut_ci_watch"])

    fixture.app.mockInput.pressKey(" ")
    await fixture.app.waitForFrame((frame) => frame.includes("Active"))
    expect(fixture.resumed).toEqual(["aut_ci_watch"])

    // Move down to the other session's automation, press Enter to inspect, and 'o' to open its session.
    fixture.app.mockInput.pressArrow("down")
    await fixture.app.waitForFrame((frame) => frame.includes("cron 0 9 * * 1-5"))
    fixture.app.mockInput.pressEnter()
    await fixture.app.waitForFrame((frame) => frame.includes("Wake prompt:"))
    expect(fixture.app.captureCharFrame()).toContain("Summarize overnight Slack and GitHub activity")

    fixture.app.mockInput.pressEscape()
    await fixture.app.waitForFrame((frame) => frame.includes("This session"))

    // Two-step ctrl+d deletes the selected automation.
    fixture.app.mockInput.pressKey("d", { ctrl: true })
    await fixture.app.waitForFrame((frame) => frame.includes("again to delete"))
    fixture.app.mockInput.pressKey("d", { ctrl: true })
    await fixture.app.waitForFrame((frame) => !frame.includes("Morning brief"))
    expect(fixture.deleted).toEqual(["aut_morning"])
  } finally {
    fixture.app.renderer.destroy()
  }
})

test("ctrl+o jumps directly to another session's automation", async () => {
  const fixture = await renderAutomations()

  try {
    await fixture.app.waitForFrame((frame) => frame.includes("Morning brief"))
    fixture.app.mockInput.pressArrow("down")
    await fixture.app.waitForFrame((frame) => frame.includes("Summarize overnight Slack"))
    fixture.app.mockInput.pressKey("o", { ctrl: true })
    await fixture.app.waitForFrame(() => fixture.route.data.type === "session" && fixture.route.data.sessionID === "ses_other")
    expect(fixture.route.data).toEqual({ type: "session", sessionID: "ses_other" })
  } finally {
    fixture.app.renderer.destroy()
  }
})

async function renderAutomations() {
  const events = createEventStream()
  const now = Date.now()
  let rows: AutomationInfo[] = [
    {
      id: "aut_ci_watch",
      sessionID: "ses_current",
      name: "PR #60478 CI watch",
      when: { type: "every", every: "30 seconds" },
      tz: "America/Los_Angeles",
      until: { type: "shell", run: "gh pr checks 60478" },
      action: { type: "prompt", prompt: "Report green CI and summarize check timings." },
      status: "active",
      nextDueAt: now + 25_000,
      runCount: 0,
      lastFiredAt: now - 5_000,
      lastOutcome: "checked",
      lastOutput: "pending: unit (linux)",
      time: { created: now - 60_000, updated: now - 5_000 },
    },
    {
      id: "aut_morning",
      sessionID: "ses_other",
      name: "Morning brief",
      when: { type: "cron", cron: "0 9 * * 1-5" },
      tz: "America/Los_Angeles",
      action: { type: "prompt", prompt: "Summarize overnight Slack and GitHub activity." },
      status: "active",
      nextDueAt: now + 3_600_000,
      runCount: 4,
      time: { created: now - 120_000, updated: now - 30_000 },
    },
  ]

  const paused: string[] = []
  const resumed: string[] = []
  const deleted: string[] = []
  let route!: ReturnType<typeof useRoute>

  const calls = createFetch((url, request) => {
    if (url.pathname === "/api/experimental/automation" && request.method === "GET") {
      return json({ data: rows })
    }
    const pauseMatch = url.pathname.match(/^\/api\/experimental\/automation\/([^/]+)\/pause$/)
    if (pauseMatch && request.method === "POST") {
      const id = decodeURIComponent(pauseMatch[1]!)
      paused.push(id)
      rows = rows.map((row) => (row.id === id ? { ...row, status: "paused" } : row))
      const updated = rows.find((row) => row.id === id)!
      return json({ data: updated })
    }
    const resumeMatch = url.pathname.match(/^\/api\/experimental\/automation\/([^/]+)\/resume$/)
    if (resumeMatch && request.method === "POST") {
      const id = decodeURIComponent(resumeMatch[1]!)
      resumed.push(id)
      rows = rows.map((row) => (row.id === id ? { ...row, status: "active" } : row))
      const updated = rows.find((row) => row.id === id)!
      return json({ data: updated })
    }
    const deleteMatch = url.pathname.match(/^\/api\/experimental\/automation\/([^/]+)$/)
    if (deleteMatch && request.method === "DELETE") {
      const id = decodeURIComponent(deleteMatch[1]!)
      deleted.push(id)
      rows = rows.filter((row) => row.id !== id)
      return new Response(null, { status: 204 })
    }
    return undefined
  }, events)

  function Probe() {
    const dialog = useDialog()
    route = useRoute()
    onMount(() => {
      dialog.replace(() => <DialogAutomations />)
    })
    return null
  }

  const app = await testRender(
    () => (
      <TestTuiContexts>
        <ConfigProvider config={createTuiResolvedConfig()}>
          <Keymap.Provider>
            <ToastProvider>
              <RouteProvider initialRoute={{ type: "session", sessionID: "ses_current" }}>
                <ClientProvider api={createApi(calls.fetch)}>
                  <DataProvider directory={directory}>
                    <LocationProvider>
                      <ThemeProvider mode="dark" source={emptyThemeSource}>
                        <DialogProvider>
                          <Probe />
                        </DialogProvider>
                      </ThemeProvider>
                    </LocationProvider>
                  </DataProvider>
                </ClientProvider>
              </RouteProvider>
            </ToastProvider>
          </Keymap.Provider>
        </ConfigProvider>
      </TestTuiContexts>
    ),
    { width: 110, height: 32, kittyKeyboard: true },
  )
  app.renderer.start()
  return {
    app,
    paused,
    resumed,
    deleted,
    get route() {
      return route
    },
  }
}
