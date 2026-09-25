/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender, useRenderer } from "@opentui/solid"
import type { Renderable } from "@opentui/core"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import type { QuestionRequest } from "@opencode-ai/sdk/v2"
import { mkdir, rm } from "node:fs/promises"
import path from "node:path"
import { onCleanup } from "solid-js"
import { tmpdir } from "../../fixture/fixture"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"
import { eventSource, json } from "../../fixture/tui-sdk"
import { TestTuiContexts } from "../../fixture/tui-environment"

async function wait(fn: () => boolean, timeout = 2000) {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > timeout) throw new Error("timed out waiting for condition")
    await Bun.sleep(10)
  }
}

function findText(node: Renderable, content: string): Renderable | undefined {
  if ((node as { plainText?: string }).plainText === content) return node
  for (const child of node.getChildren()) {
    const found = findText(child, content)
    if (found) return found
  }
  return undefined
}

const request: QuestionRequest = {
  id: "question-1",
  sessionID: "session-1",
  questions: [
    {
      question: "Which database?",
      header: "Database",
      options: [
        { label: "SQLite", description: "Embedded" },
        { label: "Postgres", description: "Server" },
      ],
    },
    {
      question: "Which language?",
      header: "Language",
      options: [
        { label: "TypeScript", description: "Typed" },
        { label: "Go", description: "Fast" },
      ],
    },
  ],
}

async function mountQuestion() {
  const tmp = await tmpdir()
  const state = path.join(tmp.path, "state")
  await mkdir(state, { recursive: true })
  await Bun.write(path.join(state, "kv.json"), "{}")

  const calls: Array<{ method: string; path: string; body: unknown }> = []
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init)
    if (new URL(req.url).pathname.startsWith("/question/")) {
      const body = req.method === "GET" ? undefined : await req.json()
      calls.push({ method: req.method, path: new URL(req.url).pathname, body })
      return json({})
    }
    throw new Error(`unexpected request: ${new URL(req.url).pathname}`)
  }) as typeof globalThis.fetch

  const [
    { QuestionPrompt },
    { SDKProvider },
    { KVProvider },
    { ThemeProvider },
    { TuiConfigProvider },
    { OpencodeKeymapProvider, registerOpencodeKeymap },
  ] = await Promise.all([
    import("../../../src/routes/session/question"),
    import("../../../src/context/sdk"),
    import("../../../src/context/kv"),
    import("../../../src/context/theme"),
    import("../../../src/config"),
    import("../../../src/keymap"),
  ])

  const resolvedConfig = createTuiResolvedConfig({ leader_timeout: 1000 })

  function Harness() {
    const renderer = useRenderer()
    const keymap = createDefaultOpenTuiKeymap(renderer)
    const off = registerOpencodeKeymap(keymap, renderer, resolvedConfig)
    onCleanup(off)

    return (
      <TestTuiContexts
        paths={{
          home: tmp.path,
          state,
        }}
      >
        <SDKProvider url="http://test" directory={tmp.path} fetch={fetch} events={eventSource()}>
          <OpencodeKeymapProvider keymap={keymap}>
            <TuiConfigProvider config={resolvedConfig}>
              <KVProvider>
                <ThemeProvider mode="dark">
                  <QuestionPrompt request={request} />
                </ThemeProvider>
              </KVProvider>
            </TuiConfigProvider>
          </OpencodeKeymapProvider>
        </SDKProvider>
      </TestTuiContexts>
    )
  }

  const app = await testRender(() => <Harness />, { kittyKeyboard: true })

  async function clickTab(label: string, expectText?: string) {
    const node = findText(app.renderer.root, label)
    if (!node) throw new Error(`tab not found: ${label}`)
    await app.mockMouse.click(node.screenX + 2, node.screenY)
    // give keymap layers time to re-register after the tab switch before asserting
    await Bun.sleep(300)
    if (expectText && !app.captureCharFrame().includes(expectText)) {
      throw new Error(`tab switch failed: ${label}`)
    }
  }

  return {
    app,
    calls,
    clickTab,
    async startEditing() {
      await wait(() => app.captureCharFrame().includes("Type your own answer"))
      app.mockInput.pressKey("3")
      await wait(() => app.renderer.currentFocusedEditor != null)
      app.mockInput.typeText("custom reply")
      await Bun.sleep(400)
      const editor = () => app.renderer.currentFocusedEditor as { plainText?: string } | undefined
      await wait(() => editor()?.plainText === "custom reply")
    },
    async cleanup() {
      app.renderer.destroy()
      await rm(tmp.path, { recursive: true, force: true })
    },
  }
}

test("switching to confirm tab while editing exits edit mode and keeps keyboard working", async () => {
  const mounted = await mountQuestion()
  const { app, calls } = mounted

  try {
    await mounted.startEditing()

    await mounted.clickTab("Confirm", "Review")
    await Bun.sleep(300)
    await wait(() => app.renderer.currentFocusedEditor == null)

    app.mockInput.pressKey("h")
    await Bun.sleep(200)
    // pressTab, not pressKey("tab"): string names must match KeyCodes casing,
    // otherwise pressKey emits the literal characters as plain keys
    app.mockInput.pressTab()
    await Bun.sleep(200)
    app.mockInput.pressEnter()
    await Bun.sleep(200)

    const frame = app.captureCharFrame()
    expect(frame).toContain("Review")
    await wait(() => calls.some((call) => call.path === "/question/question-1/reply"))
    expect(calls[0]?.body).toEqual({ answers: [[], []] })
  } finally {
    await mounted.cleanup()
  }
})

test("switching to another question tab while editing exits edit mode", async () => {
  const mounted = await mountQuestion()
  const { app } = mounted

  try {
    await mounted.startEditing()

    await mounted.clickTab("Language", "Which language?")
    await Bun.sleep(300)
    await wait(() => app.renderer.currentFocusedEditor == null)

    app.mockInput.pressEnter()
    await Bun.sleep(200)
    const frame = app.captureCharFrame()
    expect(frame).toContain("Review")
    expect(frame).toContain("(not answered)")
  } finally {
    await mounted.cleanup()
  }
})

test("editing escape still exits edit mode on the same tab", async () => {
  const mounted = await mountQuestion()
  const { app, calls } = mounted

  try {
    await mounted.startEditing()

    app.mockInput.pressEscape()
    await wait(() => app.renderer.currentFocusedEditor == null)

    expect(calls).toHaveLength(0)
    const frame = app.captureCharFrame()
    expect(frame).toContain("Which database?")
    expect(frame).not.toContain("custom reply")
  } finally {
    await mounted.cleanup()
  }
})

test("tab navigation and confirm submit still work without editing", async () => {
  const mounted = await mountQuestion()
  const { app, calls } = mounted

  try {
    await wait(() => app.captureCharFrame().includes("Type your own answer"))

    app.mockInput.pressKey("1")
    await wait(() => app.captureCharFrame().includes("Which language?"))

    app.mockInput.pressKey("2")
    await wait(() => app.captureCharFrame().includes("Review"))

    app.mockInput.pressEnter()
    await wait(() => calls.some((call) => call.path === "/question/question-1/reply"))
    expect(calls[0]?.body).toEqual({
      answers: [
        ["SQLite"],
        ["Go"],
      ],
    })
  } finally {
    await mounted.cleanup()
  }
})
