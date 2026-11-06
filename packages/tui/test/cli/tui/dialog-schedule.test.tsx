/** @jsxImportSource @opentui/solid */
import { InputRenderable, TextareaRenderable } from "@opentui/core"
import type { SessionScheduleInfo } from "@opencode/client"
import { SessionSchedule } from "@opencode/schema/session-schedule"
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { Schema } from "effect"
import { onMount } from "solid-js"
import { DialogSchedule } from "../../../src/component/dialog-schedule"
import { ConfigProvider } from "../../../src/config"
import { ClientProvider } from "../../../src/context/client"
import { Keymap } from "../../../src/context/keymap"
import { ThemeProvider } from "../../../src/context/theme"
import { DialogProvider, useDialog } from "../../../src/ui/dialog"
import { ToastProvider } from "../../../src/ui/toast"
import { emptyThemeSource } from "../../fixture/fixture"
import { createApi, createEventStream, createFetch, json } from "../../fixture/tui-client"
import { TestTuiContexts } from "../../fixture/tui-environment"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"

test("schedule dialog supports adding, editing, pausing, resuming and confirming deletion", async () => {
  let entries: SessionScheduleInfo[] = []
  const calls = createFetch(async (url, request) => {
    if (!url.pathname.startsWith("/api/session/ses_schedule/schedule")) return
    if (request.method === "GET") return json({ data: entries })
    if (request.method === "DELETE") {
      entries = []
      return new Response(null, { status: 204 })
    }
    const input = Schema.decodeUnknownSync(SessionSchedule.Input)(await request.json())
    entries = [
      {
        ...input,
        id: "schedule-test",
        sessionID: "ses_schedule",
        nextAt: input.enabled ? Date.now() + input.intervalMinutes * 60_000 : null,
      },
    ]
    return json({ data: entries[0] })
  }, createEventStream())
  function Open() {
    const dialog = useDialog()
    onMount(() => dialog.replace(() => <DialogSchedule sessionID="ses_schedule" />))
    return null
  }
  const app = await testRender(
    () => (
      <TestTuiContexts>
        <ConfigProvider config={createTuiResolvedConfig({ keybinds: { "input.select.all": "ctrl+a" } })}>
          <Keymap.Provider>
            <ToastProvider>
              <ClientProvider api={createApi(calls.fetch)}>
                <ThemeProvider mode="dark" source={emptyThemeSource}>
                  <DialogProvider>
                    <Open />
                  </DialogProvider>
                </ThemeProvider>
              </ClientProvider>
            </ToastProvider>
          </Keymap.Provider>
        </ConfigProvider>
      </TestTuiContexts>
    ),
    { width: 100, height: 35, kittyKeyboard: true },
  )
  app.renderer.start()
  try {
    await app.waitForFrame((frame) => frame.includes("n で追加"))
    app.mockInput.pressKey("n")
    await app.waitFor(() => app.renderer.currentFocusedEditor instanceof TextareaRenderable)
    await app.mockInput.typeText("Continue work")
    app.mockInput.pressEnter({ meta: true })
    await app.mockInput.typeText("Check tests")
    app.mockInput.pressTab()
    await app.waitFor(() => app.renderer.currentFocusedEditor instanceof InputRenderable)
    app.mockInput.pressArrow("right")
    app.mockInput.pressBackspace()
    await app.mockInput.typeText("2")
    app.mockInput.pressEnter({ ctrl: true })
    await app.waitForFrame((frame) => frame.includes("2分おき"))
    expect(entries[0]).toMatchObject({ text: "Continue work\nCheck tests", intervalMinutes: 2, enabled: true })
    app.mockInput.pressKey(" ")
    await app.waitForFrame((frame) => frame.includes("停止中"))
    expect(entries[0]?.enabled).toBe(false)
    app.mockInput.pressEnter()
    await app.waitForFrame((frame) => frame.includes("定期送信を編集"))
    await app.waitFor(() => app.renderer.currentFocusedEditor instanceof TextareaRenderable)
    const editor = app.renderer.currentFocusedEditor
    if (!(editor instanceof TextareaRenderable)) throw new Error("Expected the message editor")
    editor.setText("Updated")
    app.mockInput.pressEnter({ ctrl: true })
    await app.waitForFrame((frame) => frame.includes("Updated") && frame.includes("停止中"))
    expect(entries[0]?.text).toBe("Updated")
    app.mockInput.pressKey(" ")
    await app.waitForFrame((frame) => frame.includes("実行中"))
    expect(entries[0]?.enabled).toBe(true)
    app.mockInput.pressKey("d")
    await app.waitForFrame((frame) => frame.includes("もう一度 d"))
    expect(entries).toHaveLength(1)
    app.mockInput.pressKey("d")
    await app.waitForFrame((frame) => frame.includes("n で追加"))
    expect(entries).toEqual([])
  } finally {
    app.renderer.destroy()
  }
})
