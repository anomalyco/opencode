/** @jsxImportSource @opentui/solid */
import { CodeRenderable, Renderable, ScrollBoxRenderable } from "@opentui/core"
import { testRender } from "@opentui/solid"
import type { SessionMessageAssistantTool } from "@opencode/client/promise"
import { expect, test } from "bun:test"
import { createSignal, onMount } from "solid-js"
import { ConfigProvider } from "../../src/config"
import { Keymap } from "../../src/context/keymap"
import { ThemeProvider } from "../../src/context/theme"
import { DialogExecute } from "../../src/routes/session/dialog-execute"
import { DialogProvider, useDialog } from "../../src/ui/dialog"
import { ToastProvider } from "../../src/ui/toast"
import { emptyThemeSource } from "../fixture/fixture"
import { TestTuiContexts } from "../fixture/tui-environment"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"

async function setup(code: string, output = "{}", width = 80, height = 30) {
  const [part, setPart] = createSignal<SessionMessageAssistantTool>({
    type: "tool",
    id: "call_execute",
    name: "execute",
    time: { created: 0, ran: 0, completed: 255 },
    state: {
      status: "completed",
      input: { code },
      content: [{ type: "text", text: output }],
    },
  })
  const copied: string[] = []

  function Open() {
    const dialog = useDialog()
    onMount(() => dialog.replace(() => <DialogExecute part={part()} />))
    return null
  }

  const app = await testRender(
    () => (
      <TestTuiContexts clipboard={{ read: async () => undefined, write: async (text) => void copied.push(text) }}>
        <ConfigProvider config={createTuiResolvedConfig()}>
          <Keymap.Provider>
            <ThemeProvider mode="dark" source={emptyThemeSource}>
              <ToastProvider>
                <DialogProvider>
                  <Open />
                </DialogProvider>
              </ToastProvider>
            </ThemeProvider>
          </Keymap.Provider>
        </ConfigProvider>
      </TestTuiContexts>
    ),
    { width, height, kittyKeyboard: true },
  )
  app.renderer.start()
  await app.waitForFrame((frame) => frame.includes("copy code"))
  await app.waitForVisualIdle()
  return {
    ...app,
    copied,
    part,
    setPart,
    async [Symbol.asyncDispose]() {
      app.renderer.destroy()
    },
  }
}

function blocks(root: Renderable): CodeRenderable[] {
  return root.getChildren().flatMap((child) => (child instanceof CodeRenderable ? [child] : blocks(child)))
}

function gutter(app: Awaited<ReturnType<typeof setup>>, block: CodeRenderable) {
  return app
    .captureCharFrame()
    .split("\n")
    .slice(block.y, block.y + block.height)
    .map((row) => row.slice(0, block.x).trim())
}

test.each([50, 80, 140])("wraps long code and numbers only source lines at %s columns", async (width) => {
  const code = `const url = "https://example.com/${"segment/".repeat(30)}end";\nreturn url;`
  await using app = await setup(code, "{}", width)
  await app.waitForFrame((frame) => frame.includes("return url;"))
  expect(app.captureCharFrame()).toContain('end";')
  const block = blocks(app.renderer.root)[0]!
  expect(block.virtualLineCount).toBeGreaterThan(2)
  expect(gutter(app, block)).toEqual(["1", ...Array.from({ length: block.virtualLineCount - 2 }, () => ""), "2"])
  expect(block.plainText).toBe(code)
})

test("keeps code and JSON gutters aligned without numbering JSON continuations", async () => {
  const code = Array.from({ length: 10 }, (_, i) => `const value${i} = ${i};`).join("\n")
  const output = JSON.stringify({ url: `https://example.com/${"segment/".repeat(12)}end` }, null, 2)
  await using app = await setup(code, output, 80, 50)
  await app.waitForFrame((frame) => frame.includes('"url"'))
  const [source, json] = blocks(app.renderer.root)
  expect(source).toBeDefined()
  expect(json).toBeDefined()
  expect(json!.x).toBe(source!.x)
  expect(json!.virtualLineCount).toBeGreaterThan(3)
  expect(gutter(app, json!)).toEqual(["1", "2", ...Array.from({ length: json!.virtualLineCount - 3 }, () => ""), "3"])
})

test("updates wrapping and source numbers after resizing", async () => {
  const code = `const url = "${"x".repeat(100)}";\nreturn url;`
  await using app = await setup(code, "{}", 140)
  await app.waitForFrame((frame) => frame.includes("return url;"))
  const block = blocks(app.renderer.root)[0]!
  const wide = block.virtualLineCount
  app.resize(50, 30)
  await app.waitFor(() => block.virtualLineCount > wide)
  await app.waitForFrame((frame) => frame.includes("return url;"))
  await app.waitForVisualIdle()
  expect(gutter(app, block)).toEqual(["1", ...Array.from({ length: block.virtualLineCount - 2 }, () => ""), "2"])
  app.resize(140, 30)
  await app.waitFor(() => block.virtualLineCount === wide)
  await app.waitForFrame((frame) => frame.includes("return url;"))
  await app.waitForVisualIdle()
  expect(gutter(app, block)).toEqual(["1", ...Array.from({ length: block.virtualLineCount - 2 }, () => ""), "2"])
})

test("copies original code and output rather than inserting soft-wrap newlines", async () => {
  const code = `const url = "${"x".repeat(160)}";\nreturn url;`
  const output = JSON.stringify({ url: "y".repeat(160) })
  await using app = await setup(code, output)
  await app.waitForFrame((frame) => frame.includes("return url;"))
  app.mockInput.pressKey("c")
  await app.waitFor(() => app.copied.length === 1)
  app.mockInput.pressKey("o")
  await app.waitFor(() => app.copied.length === 2)
  expect(app.copied).toEqual([code, output])
})

test("preserves explicit blank lines and numbers wide and tabbed text by source line", async () => {
  const code = `const label = "${"界".repeat(60)}";\n\n\treturn label;`
  await using app = await setup(code)
  await app.waitForFrame((frame) => frame.includes("return label;"))
  const block = blocks(app.renderer.root)[0]!
  expect(block.virtualLineCount).toBeGreaterThan(3)
  expect(gutter(app, block)).toEqual(["1", ...Array.from({ length: block.virtualLineCount - 3 }, () => ""), "2", "3"])
  expect(block.plainText).toBe(code)
})

test("updates rows and gutters while code arrives and output completes", async () => {
  await using app = await setup("", "", 80, 50)
  app.setPart({ ...app.part(), state: { status: "streaming", input: '{"code":' } })
  await app.waitForFrame((frame) => frame.includes("Receiving code") && frame.includes("Waiting for code"))
  app.setPart({ ...app.part(), state: { status: "running", input: { code: "const url = 1;" }, metadata: {} } })
  await app.waitForFrame((frame) => frame.includes("const url = 1;") && frame.includes("Running"))

  const code = `const url = "${"x".repeat(200)}";\nreturn url;`
  app.setPart({ ...app.part(), state: { status: "running", input: { code }, metadata: {} } })
  await app.waitForFrame((frame) => frame.includes("return url;"))
  await app.waitForVisualIdle()
  expect(gutter(app, blocks(app.renderer.root)[0]!).filter(Boolean)).toEqual(["1", "2"])

  const output = JSON.stringify(
    Array.from({ length: 8 }, (_, i) => i),
    null,
    2,
  )
  app.setPart({
    ...app.part(),
    state: { status: "completed", input: { code }, content: [{ type: "text", text: output }] },
  })
  await app.waitForFrame((frame) => frame.includes("Completed") && /\b10\s+\]/.test(frame))
  await app.waitForVisualIdle()
  const [source, json] = blocks(app.renderer.root)
  expect(source!.x).toBe(json!.x)
  expect(gutter(app, source!).filter(Boolean)).toEqual(["1", "2"])
  expect(gutter(app, json!)).toEqual(Array.from({ length: 10 }, (_, i) => String(i + 1)))
  app.mockInput.pressCtrlC()
  await app.waitForFrame((frame) => !frame.includes("copy code"))
})

test("scrolls through a wrapped line without inventing continuation numbers", async () => {
  const code = `const url = "${"x".repeat(1200)}";\nreturn url;`
  await using app = await setup(code)
  await app.waitForFrame((frame) => frame.includes("const url"))
  const scroll = app.renderer.root.findDescendantById("execute-detail-scroll")
  if (!(scroll instanceof ScrollBoxRenderable)) throw new Error("Execute scrollbox missing")
  expect(scroll.scrollHeight).toBeGreaterThan(scroll.viewport.height)
  app.mockInput.pressArrow("down")
  app.mockInput.pressArrow("down")
  await app.waitFor(() => scroll.scrollTop >= 2)
  await app.waitForFrame((frame) => !frame.includes("const url"))
  expect(
    app
      .captureCharFrame()
      .split("\n")
      .filter((row) => /^\s*\d+\s+x/.test(row)),
  ).toEqual([])
  app.mockInput.pressKey("END")
  await app.waitForFrame((frame) => frame.includes("return url;"))
  expect(app.captureCharFrame()).toMatch(/\b2\s+return url;/)
  app.mockInput.pressKey("HOME")
  await app.waitForFrame((frame) => frame.includes("const url"))
  app.mockInput.pressEscape()
  await app.waitForFrame((frame) => !frame.includes("copy code"))
})
