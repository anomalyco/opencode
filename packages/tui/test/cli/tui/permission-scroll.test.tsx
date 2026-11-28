/** @jsxImportSource @opentui/solid */
import type { PermissionRequest } from "@opencode/client"
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { onMount } from "solid-js"
import { ConfigProvider } from "../../../src/config"
import { ClientProvider } from "../../../src/context/client"
import { DataProvider, useData } from "../../../src/context/data"
import { InteractivityProvider } from "../../../src/context/interactivity"
import { Keymap } from "../../../src/context/keymap"
import { LocationProvider } from "../../../src/context/location"
import { ThemeProvider } from "../../../src/context/theme"
import { PermissionPrompt } from "../../../src/routes/session/permission"
import { DialogProvider } from "../../../src/ui/dialog"
import { ToastProvider } from "../../../src/ui/toast"
import { emptyThemeSource, tmpdir } from "../../fixture/fixture"
import { createApi, createEventStream, createFetch, json } from "../../fixture/tui-client"
import { TestTuiContexts } from "../../fixture/tui-environment"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"

const PATTERNS = Array.from({ length: 10 }, (_, index) => `pattern-${index + 1} *`)

const request = {
  id: "per_scroll",
  sessionID: "ses_scroll",
  action: "shell",
  resources: ["echo scrolled"],
  save: PATTERNS,
} satisfies PermissionRequest

async function mountPrompt(root: string, height: number) {
  const ready = Promise.withResolvers<void>()
  const sessionPages: string[] = []
  const transport = createFetch((url) => {
    if (url.pathname === "/api/session/ses_scroll")
      return json({
        data: {
          id: "ses_scroll",
          title: "Scrolled session",
          projectID: "proj_test",
          location: { directory: root },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          time: { created: 0, updated: 0 },
        },
      })
  }, createEventStream())

  function Prompt() {
    const data = useData()
    onMount(() => void data.session.sync("ses_scroll").then(ready.resolve, ready.reject))
    // The session screen binds pageup/pagedown before the prompt exists; the prompt has to win while it is open.
    Keymap.createLayer(() => ({
      mode: "base",
      commands: [
        {
          id: "session.page.up",
          bind: "pageup",
          title: "Page up",
          group: "Session",
          run: () => {
            sessionPages.push("up")
          },
        },
        {
          id: "session.page.down",
          bind: "pagedown",
          title: "Page down",
          group: "Session",
          run: () => {
            sessionPages.push("down")
          },
        },
      ],
    }))
    return (
      <InteractivityProvider enabled={true}>
        <PermissionPrompt request={request} />
      </InteractivityProvider>
    )
  }

  const app = await testRender(
    () => (
      <TestTuiContexts directory={root} paths={{ home: root, state: root, worktree: root }}>
        <ConfigProvider config={createTuiResolvedConfig({ animations: false })}>
          <Keymap.Provider>
            <ClientProvider api={createApi(transport.fetch)}>
              <DataProvider directory={root}>
                <LocationProvider>
                  <ThemeProvider mode="dark" source={emptyThemeSource}>
                    <ToastProvider>
                      <DialogProvider>
                        <Prompt />
                      </DialogProvider>
                    </ToastProvider>
                  </ThemeProvider>
                </LocationProvider>
              </DataProvider>
            </ClientProvider>
          </Keymap.Provider>
        </ConfigProvider>
      </TestTuiContexts>
    ),
    { width: 90, height, kittyKeyboard: true },
  )
  app.renderer.start()
  await ready.promise
  await app.renderOnce()
  return { app, sessionPages }
}

test("the always-allow list scrolls instead of clipping its patterns", async () => {
  await using tmp = await tmpdir()
  const { app, sessionPages } = await mountPrompt(tmp.path, 24)
  try {
    app.mockInput.pressArrow("right")
    await app.renderOnce()

    const collapsed = app.captureCharFrame()
    expect(collapsed).toContain("This will always allow the following patterns for this project.")
    expect(collapsed).toContain(PATTERNS[0])
    expect(collapsed).not.toContain(PATTERNS[PATTERNS.length - 1])

    for (let index = 0; index < PATTERNS.length; index++) app.mockInput.pressKey("\u001b[6~")
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain(PATTERNS[PATTERNS.length - 1])
    // The prompt's layer owns pagedown while it is open, so the session must not page the transcript.
    expect(sessionPages).toEqual([])
  } finally {
    app.renderer.destroy()
  }
})
