/** @jsxImportSource @opentui/solid */
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { testRender, useRenderer } from "@opentui/solid"
import { expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { onCleanup } from "solid-js"
import { ClipboardProvider } from "../../../src/context/clipboard"
import type { FormWithLocation } from "../../../src/context/data"
import { KVProvider } from "../../../src/context/kv"
import { SDKProvider } from "../../../src/context/sdk"
import { ThemeProvider } from "../../../src/context/theme"
import { TuiConfigProvider } from "../../../src/config/v1"
import { OpencodeKeymapProvider, registerOpencodeKeymap } from "../../../src/keymap"
import { ToastProvider } from "../../../src/ui/toast"
import { tmpdir } from "../../fixture/fixture"
import { TestTuiContexts } from "../../fixture/tui-environment"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"
import { createApi, createClient, createEventStream, createFetch } from "../../fixture/tui-sdk"

async function mountForm(root: string, width = 80) {
  const state = path.join(root, "state")
  await mkdir(state, { recursive: true })
  await Bun.write(path.join(state, "kv.json"), "{}")

  const replies: unknown[] = []
  const copied: string[] = []
  const events = createEventStream()
  const transport = createFetch(
    (url, request) =>
      url.pathname === "/api/session/ses_test/form/frm_test/reply"
        ? request.json().then((answer) => {
            replies.push(answer)
            return new Response(null, { status: 204 })
          })
        : undefined,
    events,
  )
  const config = createTuiResolvedConfig()
  const form = {
    id: "frm_test",
    sessionID: "ses_test",
    title: "Authorization required",
    fields: [
      {
        key: "authorization",
        type: "external",
        url: "https://example.com/authorize",
        title: "Authorize access",
      },
    ],
  } satisfies FormWithLocation
  const { FormPrompt } = await import("../../../src/routes/session/form")

  function Harness() {
    const renderer = useRenderer()
    const keymap = createDefaultOpenTuiKeymap(renderer)
    const off = registerOpencodeKeymap(keymap, renderer, config)
    onCleanup(off)

    return (
      <TestTuiContexts
        directory={root}
        paths={{
          home: root,
          state,
          worktree: root,
        }}
      >
        <ClipboardProvider
          value={{
            write(text) {
              copied.push(text)
              return Promise.resolve()
            },
          }}
        >
          <OpencodeKeymapProvider keymap={keymap}>
            <TuiConfigProvider config={config}>
              <SDKProvider client={createClient(transport.fetch)} api={createApi(transport.fetch)}>
                <KVProvider>
                  <ThemeProvider mode="dark" source={{ discover: () => Promise.resolve({}) }}>
                    <ToastProvider>
                      <FormPrompt form={form} />
                    </ToastProvider>
                  </ThemeProvider>
                </KVProvider>
              </SDKProvider>
            </TuiConfigProvider>
          </OpencodeKeymapProvider>
        </ClipboardProvider>
      </TestTuiContexts>
    )
  }

  const app = await testRender(() => <Harness />, { width, height: 20, kittyKeyboard: true })
  app.renderer.start()
  await app.waitForFrame((frame) => frame.includes("Authorization required"))
  return { app, copied, replies }
}

test("requires explicit acknowledgement before submitting an external field", async () => {
  await using tmp = await tmpdir()
  const prompt = await mountForm(tmp.path)
  try {
    prompt.app.mockInput.pressKey("right")
    await prompt.app.waitForFrame((frame) => frame.includes("(acknowledgement required)"))
    prompt.app.mockInput.pressEnter()
    await prompt.app.waitForFrame((frame) => frame.includes("External action must be acknowledged"))
    expect(prompt.replies).toEqual([])

    prompt.app.mockInput.pressKey("left")
    prompt.app.mockInput.pressKey("c")
    await prompt.app.waitForFrame((frame) => frame.includes("press enter to confirm"))
    expect(prompt.copied).toEqual(["https://example.com/authorize"])
    expect(prompt.replies).toEqual([])

    prompt.app.mockInput.pressEnter()
    await prompt.app.waitForFrame((frame) => frame.includes("Acknowledged"))
    expect(prompt.replies).toEqual([])

    prompt.app.mockInput.pressEnter()
    await prompt.app.waitFor(() => prompt.replies.length === 1)
    expect(prompt.replies).toEqual([{ answer: { authorization: true } }])
  } finally {
    prompt.app.renderer.destroy()
  }
})

test("includes external acknowledgements in progress", async () => {
  await using tmp = await tmpdir()
  const prompt = await mountForm(tmp.path, 32)
  try {
    expect(prompt.app.captureCharFrame()).toContain("0/1")
    expect(prompt.replies).toEqual([])
  } finally {
    prompt.app.renderer.destroy()
  }
})
