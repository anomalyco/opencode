/** @jsxImportSource @opentui/solid */
import type { PermissionRequest } from "@opencode/client"
import { type Renderable, ScrollBoxRenderable } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { onMount } from "solid-js"
import { ConfigProvider } from "../../../src/config"
import { ClientProvider } from "../../../src/context/client"
import { DataProvider, useData } from "../../../src/context/data"
import { Keymap } from "../../../src/context/keymap"
import { InteractivityProvider } from "../../../src/context/interactivity"
import { LocationProvider } from "../../../src/context/location"
import { ThemeProvider } from "../../../src/context/theme"
import { PermissionPrompt } from "../../../src/routes/session/permission"
import { ToastProvider } from "../../../src/ui/toast"
import { emptyThemeSource, tmpdir } from "../../fixture/fixture"
import { createApi, createEventStream, createFetch, json } from "../../fixture/tui-client"
import { TestTuiContexts } from "../../fixture/tui-environment"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"

const PAGE_UP = "\x1b[5~"
const PAGE_DOWN = "\x1b[6~"

// Taller than the fullscreen viewport so page scrolling has room to move.
const patch = [
  "--- a/big.txt",
  "+++ b/big.txt",
  "@@ -1,40 +1,40 @@",
  ...Array.from({ length: 40 }, (_, index) => `-removed line ${index + 1}`),
  ...Array.from({ length: 40 }, (_, index) => `+added line ${index + 1}`),
].join("\n")

const request = {
  id: "per_scroll",
  sessionID: "ses_scroll",
  action: "edit",
  resources: ["big.txt"],
  metadata: { files: [{ path: "big.txt", patch }] },
} satisfies PermissionRequest

async function mountPrompt(root: string) {
  const replies: unknown[] = []
  const ready = Promise.withResolvers<void>()
  const transport = createFetch((url, message) => {
    if (url.pathname === "/api/session/ses_scroll")
      return json({
        data: {
          id: "ses_scroll",
          title: "Scroll session",
          projectID: "proj_test",
          location: { directory: root },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          time: { created: 0, updated: 0 },
        },
      })
    if (url.pathname.endsWith("/reply"))
      return message.json().then((body) => {
        replies.push(body)
        return new Response(null, { status: 204 })
      })
  }, createEventStream())

  function Prompt() {
    const data = useData()
    onMount(() => void data.session.sync("ses_scroll").then(ready.resolve, ready.reject))
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
                      <Prompt />
                    </ToastProvider>
                  </ThemeProvider>
                </LocationProvider>
              </DataProvider>
            </ClientProvider>
          </Keymap.Provider>
        </ConfigProvider>
      </TestTuiContexts>
    ),
    { width: 90, height: 24, kittyKeyboard: true },
  )
  app.renderer.start()
  await ready.promise
  await app.renderOnce()
  return { app, replies }
}

function findScrollBox(root: Renderable): ScrollBoxRenderable | undefined {
  if (root instanceof ScrollBoxRenderable) return root
  for (const child of root.getChildren()) {
    const found = findScrollBox(child)
    if (found) return found
  }
}

test("pageup and pagedown scroll the diff only while the permission prompt is fullscreen", async () => {
  await using tmp = await tmpdir()
  const { app, replies } = await mountPrompt(tmp.path)
  const height = () => findScrollBox(app.renderer.root)?.viewport.height ?? 0
  const scrollTop = () => findScrollBox(app.renderer.root)?.scrollTop ?? 0
  try {
    // Collapsed prompt: the page keys stay with the transcript.
    const collapsedHeight = height()
    app.mockInput.pressKey(PAGE_DOWN)
    await app.renderOnce()
    expect(scrollTop()).toBe(0)

    // Fullscreen: the page keys scroll the proposed diff.
    app.mockInput.pressKey("f", { ctrl: true })
    await app.waitFor(() => height() > collapsedHeight)
    app.mockInput.pressKey(PAGE_DOWN)
    await app.waitFor(() => scrollTop() > 0)
    app.mockInput.pressKey(PAGE_UP)
    await app.waitFor(() => scrollTop() === 0)

    // Collapsing remounts the diff at the top and releases the page keys again.
    app.mockInput.pressEscape()
    await app.waitFor(() => height() <= collapsedHeight)
    app.mockInput.pressKey(PAGE_DOWN)
    await app.renderOnce()
    expect(scrollTop()).toBe(0)
    expect(replies).toEqual([])
  } finally {
    app.renderer.destroy()
  }
})
