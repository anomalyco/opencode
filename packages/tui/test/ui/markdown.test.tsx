import { afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test"
import { SyntaxStyle } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { createSignal } from "solid-js"
import { createRequire } from "node:module"

const opened: string[] = []
const opener = await import(createRequire(import.meta.resolve("@opencode/util/open")).resolve("open"))
const { Markdown } = await import("../../src/ui/markdown")
const renderers: Awaited<ReturnType<typeof testRender>>["renderer"][] = []
const syntax = SyntaxStyle.fromStyles({ default: { fg: "#ffffff" } })
const url = "https://example.com/docs"

beforeEach(() => {
  spyOn(opener, "default").mockImplementation(async (url: string) => {
    opened.push(url)
    return undefined
  })
})

afterEach(() => {
  renderers.splice(0).forEach((renderer) => renderer.destroy())
  opened.length = 0
  mock.restore()
})

test.each([false, true])("opens a rendered Markdown link with mouse capture (ctrl=%s)", async (ctrl) => {
  const app = await testRender(() => <Markdown syntaxStyle={syntax} content={`[Source](${url})`} conceal />, {
    width: 60,
    height: 8,
  })
  renderers.push(app.renderer)
  app.renderer.start()
  await app.waitForFrame((frame) => frame.includes("Source"))
  expect(app.renderer.getLinkAt(2, 0)).toBe(url)
  await app.mockMouse.click(2, 0, 0, { modifiers: { ctrl } })
  expect(opened).toEqual([url])
})

test("does not open links on selection, non-primary clicks, or an unmatched release", async () => {
  const app = await testRender(() => <Markdown syntaxStyle={syntax} content={`[Source](${url}) plain`} conceal />, {
    width: 60,
    height: 8,
  })
  renderers.push(app.renderer)
  app.renderer.start()
  await app.waitForFrame((frame) => frame.includes("Source"))
  await app.mockMouse.click(2, 0, 2)
  await app.mockMouse.click(2, 0, 1)
  await app.mockMouse.click(2, 0, 0, { modifiers: { shift: true } })
  await app.mockMouse.click(2, 0, 0, { modifiers: { alt: true } })
  await app.mockMouse.drag(1, 0, 4, 0)
  await app.mockMouse.release(2, 0)
  expect(opened).toEqual([])
  expect(app.renderer.getSelection()?.getSelectedText()).toBeTruthy()
})

test.each([
  url,
  `[Source][docs]\n\n[docs]: ${url}`,
  `[A long link label that wraps onto the next line](${url})`,
  `| Documentation |\n| --- |\n| [Source](${url}) |`,
])("opens links at their rendered position: %s", async (content) => {
  const app = await testRender(
    () => (
      <box paddingLeft={3} paddingTop={2}>
        <Markdown syntaxStyle={syntax} content={content} conceal internalBlockMode="top-level" />
      </box>
    ),
    { width: 30, height: 14 },
  )
  renderers.push(app.renderer)
  app.renderer.start()
  await app.waitForFrame(() =>
    Array.from({ length: 14 }, (_, y) => Array.from({ length: 30 }, (_, x) => app.renderer.getLinkAt(x, y)))
      .flat()
      .includes(url),
  )
  const cells = Array.from({ length: 14 }, (_, y) => Array.from({ length: 30 }, (_, x) => ({ x, y })))
    .flat()
    .filter(({ x, y }) => app.renderer.getLinkAt(x, y) === url)
  const cell = cells.at(-1)!
  await app.mockMouse.click(cell.x, cell.y)
  expect(opened).toEqual([url])
})

test("does not open a link that changes between press and release", async () => {
  const [content, setContent] = createSignal(`[Source](${url})`)
  const app = await testRender(() => <Markdown syntaxStyle={syntax} content={content()} conceal />, {
    width: 60,
    height: 8,
  })
  renderers.push(app.renderer)
  app.renderer.start()
  await app.waitForFrame((frame) => frame.includes("Source"))
  await app.mockMouse.pressDown(2, 0)
  setContent("[Source](https://example.com/other)")
  await app.waitForFrame(() => app.renderer.getLinkAt(2, 0) === "https://example.com/other")
  await app.mockMouse.release(2, 0)
  expect(opened).toEqual([])
})

test("ignores plain text and stops handled link clicks from reaching the parent", async () => {
  const app = await testRender(
    () => (
      <box onMouseUp={() => opened.push("parent")}>
        <Markdown syntaxStyle={syntax} content={`plain\n\n[Source](${url})`} conceal />
      </box>
    ),
    { width: 60, height: 8 },
  )
  renderers.push(app.renderer)
  app.renderer.start()
  await app.waitForFrame((frame) => frame.includes("Source"))
  await app.mockMouse.click(2, 0)
  expect(opened).toEqual(["parent"])
  opened.length = 0
  await app.mockMouse.click(2, 2)
  expect(opened).toEqual([url])
})

test.each(["file:///tmp/example.txt", "javascript:alert(1)", "mailto:hello@example.com"])(
  "does not pass unsupported link targets to the system opener: %s",
  async (href) => {
    const app = await testRender(() => <Markdown syntaxStyle={syntax} content={`[Source](${href})`} conceal />, {
      width: 60,
      height: 8,
    })
    renderers.push(app.renderer)
    app.renderer.start()
    await app.waitForFrame((frame) => frame.includes("Source"))
    await app.mockMouse.click(2, 0)
    expect(opened).toEqual([])
  },
)
