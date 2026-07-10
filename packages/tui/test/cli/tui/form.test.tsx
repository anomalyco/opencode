/** @jsxImportSource @opentui/solid */
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { testRender, useRenderer } from "@opentui/solid"
import { beforeEach, expect, mock, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { onCleanup } from "solid-js"
import { ClipboardProvider } from "../../../src/context/clipboard"
import type { FormWithLocation } from "../../../src/context/data"
import { KVProvider } from "../../../src/context/kv"
import { SDKProvider } from "../../../src/context/sdk"
import { ThemeProvider } from "../../../src/context/theme"
import { TuiConfigProvider } from "../../../src/config"
import { OpencodeKeymapProvider, registerOpencodeKeymap } from "../../../src/keymap"
import { ToastProvider } from "../../../src/ui/toast"
import { tmpdir } from "../../fixture/fixture"
import { TestTuiContexts } from "../../fixture/tui-environment"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"
import { createApi, createClient, createEventStream, createFetch } from "../../fixture/tui-sdk"

const opened: string[] = []
let failOpen = false

await mock.module("open", () => ({
  default: (url: string) => {
    opened.push(url)
    return failOpen ? Promise.reject(new Error("open failed")) : Promise.resolve()
  },
}))

beforeEach(() => {
  opened.length = 0
  failOpen = false
})

async function wait(fn: () => boolean, timeout = 2000) {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > timeout) throw new Error("timed out waiting for condition")
    await Bun.sleep(10)
  }
}

async function mountForm(width = 80) {
  const tmp = await tmpdir()
  const state = path.join(tmp.path, "state")
  await mkdir(state, { recursive: true })
  await Bun.write(path.join(state, "kv.json"), "{}")

  const events = createEventStream()
  const replies: unknown[] = []
  const copied: string[] = []
  const transport = createFetch(undefined, events)
  const fetch = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init)
      if (new URL(request.url).pathname === "/api/session/ses_test/form/frm_test/reply") {
        replies.push(await request.clone().json())
        return new Response(null, { status: 204 })
      }
      return transport.fetch(request)
    },
    { preconnect: globalThis.fetch.preconnect },
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
        directory={tmp.path}
        paths={{
          home: tmp.path,
          state,
          worktree: tmp.path,
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
              <SDKProvider client={createClient(fetch)} api={createApi(fetch)}>
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
  await wait(() => app.captureCharFrame().includes("Authorization required"))
  return {
    app,
    copied,
    replies,
    async cleanup() {
      app.renderer.destroy()
      await tmp[Symbol.asyncDispose]()
    },
  }
}

test("requires explicit acknowledgement after a successful browser launch", async () => {
  const prompt = await mountForm()
  try {
    prompt.app.mockInput.pressKey("right")
    await wait(() => prompt.app.captureCharFrame().includes("(acknowledgement required)"))
    prompt.app.mockInput.pressEnter()
    await wait(() => prompt.app.captureCharFrame().includes("External action must be acknowledged"))
    expect(prompt.replies).toEqual([])
    expect(prompt.app.captureCharFrame()).toContain("External action must be acknowledged")

    prompt.app.mockInput.pressKey("left")
    failOpen = true
    prompt.app.mockInput.pressEnter()
    await wait(() => prompt.app.captureCharFrame().includes("Could not open the browser"))
    expect(prompt.app.captureCharFrame()).not.toContain("press enter to confirm")

    failOpen = false
    prompt.app.mockInput.pressEnter()
    await wait(() => prompt.app.captureCharFrame().includes("press enter to confirm"))
    expect(opened).toEqual(["https://example.com/authorize", "https://example.com/authorize"])
    expect(prompt.replies).toEqual([])

    prompt.app.mockInput.pressEnter()
    await wait(() => prompt.app.captureCharFrame().includes("Acknowledged"))
    expect(prompt.replies).toEqual([])

    prompt.app.mockInput.pressEnter()
    await wait(() => prompt.replies.length === 1)
    expect(prompt.replies).toEqual([{ answer: { authorization: true } }])
  } finally {
    await prompt.cleanup()
  }
})

test("includes external acknowledgements in progress", async () => {
  const prompt = await mountForm(32)
  try {
    expect(prompt.app.captureCharFrame()).toContain("0/1")
    expect(prompt.replies).toEqual([])
  } finally {
    await prompt.cleanup()
  }
})

test("requires explicit acknowledgement after copying an external URL", async () => {
  const prompt = await mountForm()
  try {
    prompt.app.mockInput.pressKey("c")
    await wait(() => prompt.copied.length === 1 && prompt.app.captureCharFrame().includes("press enter to confirm"))
    expect(prompt.copied).toEqual(["https://example.com/authorize"])
    expect(opened).toEqual([])
    expect(prompt.app.captureCharFrame()).toContain("press enter to confirm")
    expect(prompt.replies).toEqual([])

    prompt.app.mockInput.pressEnter()
    await wait(() => prompt.app.captureCharFrame().includes("Acknowledged"))
    expect(prompt.replies).toEqual([])

    prompt.app.mockInput.pressEnter()
    await wait(() => prompt.replies.length === 1)
    expect(prompt.replies).toEqual([{ answer: { authorization: true } }])
  } finally {
    await prompt.cleanup()
  }
})
