import { afterEach, expect, test } from "bun:test"
import { getTreeSitterClient, treeSitterToTextChunks } from "@opentui/core"
import { testRender, type JSX } from "@opentui/solid"
import { StyledOutput } from "../../../src/routes/session"
import { DEFAULT_THEMES, generateSyntax, resolveTheme } from "../../../src/theme"
import { toolCodeTheme } from "../../../src/theme/tool-code"
import { forgivingMarkdown } from "../../../src/util/user-markdown"

let setup: Awaited<ReturnType<typeof testRender>> | undefined

afterEach(() => {
  setup?.renderer.destroy()
  setup = undefined
})

const text = [
  "## Plan for the release, written quickly before the meeting starts",
  "1. ble - run `bun test --timeout 30000 test/cli/tui/user-text.test.tsx` and check it",
  "2. blah",
  "- a bullet with **bold** text and a [link](https://example.com/a/really/long/path/to/wrap)",
  "",
  "| col | value |",
  "|-----|-------|",
  "| a   | 1     |",
  "",
  "```ts",
  "const answer = 42",
  "```",
  "done",
  "---",
  "    four spaces",
].join("\n")
const theme = toolCodeTheme(resolveTheme(DEFAULT_THEMES.opencode, "dark"))

async function chunks() {
  const client = getTreeSitterClient()
  await client.initialize()
  const result = await client.highlightOnce(text, "markdown")
  return treeSitterToTextChunks(text, forgivingMarkdown(text, result.highlights ?? []), generateSyntax(theme), {
    enabled: false,
  })
}

async function frame(width: number, node: () => JSX.Element) {
  setup?.renderer.destroy()
  setup = await testRender(() => <box paddingLeft={2}>{node()}</box>, { width, height: 40 })
  await setup.renderOnce()
  return setup.captureCharFrame()
}

for (const width of [40, 80, 160]) {
  test(`a colored user message wraps exactly like the plain text at ${width} columns`, async () => {
    const colored = await chunks()
    const plain = await frame(width, () => <text fg={theme.text}>{text}</text>)
    const styled = await frame(width, () => <StyledOutput content={text} chunks={colored} fg={theme.text} />)
    expect(styled).toBe(plain)
    expect(plain).toContain("## Plan")
    expect(plain).toContain("`bun test")
  })
}

test("colors markdown and leaves the text as typed", async () => {
  const colored = await chunks()
  expect(colored.map((chunk) => chunk.text).join("")).toBe(text)
  const color = (part: string) => colored.find((chunk) => chunk.text.includes(part))?.fg
  expect(color("Plan for the release")?.equals(theme.text)).toBe(false)
  expect(color("bun test")?.equals(theme.markdownCode)).toBe(true)
  expect(color("const")?.equals(theme.text)).toBe(false)
  expect(color("done")?.equals(theme.text)).toBe(true)
  expect(color("four spaces")?.equals(theme.text)).toBe(true)
})
