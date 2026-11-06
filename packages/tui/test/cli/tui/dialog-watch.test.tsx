/** @jsxImportSource @opentui/solid */
import { TextareaRenderable } from "@opentui/core"
import type { SessionWatchInfo } from "@opencode/client"
import { SessionWatch } from "@opencode/schema/session-watch"
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { Schema } from "effect"
import { onMount } from "solid-js"
import { DialogWatch } from "../../../src/component/dialog-watch"
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

test("watch dialog selects multiple members, edits text and saves", async () => {
  let saved: SessionWatchInfo | undefined
  const calls = createFetch(async (url, request) => {
    if (url.pathname === "/api/session")
      return json({
        data: ["ses_watch", "ses_one", "ses_two"].map((id) => ({
          id,
          title: id,
          projectID: "global",
          location: { directory: "/project" },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          time: { created: 0, updated: 0 },
        })),
        cursor: {},
      })
    if (url.pathname !== "/api/session/ses_watch/watch") return
    if (request.method === "GET") return json({ data: null })
    const input = Schema.decodeUnknownSync(SessionWatch.Input)(await request.json())
    saved = { ...input, members: [...input.members], sessionID: "ses_watch" }
    return json({ data: saved })
  }, createEventStream())
  function Open() {
    const dialog = useDialog()
    onMount(() => dialog.replace(() => <DialogWatch sessionID="ses_watch" />))
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
    await app.waitForFrame((frame) => frame.includes("ses_one") && frame.includes("ses_two"))
    app.mockInput.pressKey(" ")
    await app.waitForFrame((frame) => frame.includes("1人"))
    app.mockInput.pressArrow("down")
    await app.waitForFrame((frame) => frame.includes("> [ ] ses_two"))
    app.mockInput.pressKey(" ")
    await app.waitForFrame((frame) => frame.includes("2人"))
    app.mockInput.pressTab()
    await app.waitFor(() => app.renderer.currentFocusedEditor instanceof TextareaRenderable)
    const editor = app.renderer.currentFocusedEditor
    if (!(editor instanceof TextareaRenderable)) throw new Error("Expected notification editor")
    editor.setText("Stopped: {member}")
    app.mockInput.pressEnter({ ctrl: true })
    await app.waitFor(() => saved !== undefined)
    expect(saved).toMatchObject({ members: ["ses_one", "ses_two"], text: "Stopped: {member}", enabled: true })
  } finally {
    app.renderer.destroy()
  }
})
