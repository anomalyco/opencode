import { afterEach, expect, test } from "bun:test"
import { getTreeSitterClient, treeSitterToTextChunks } from "@opentui/core"
import { testRender, type JSX } from "@opentui/solid"
import { messageChunks, StyledOutput } from "../../../src/routes/session"
import { DEFAULT_THEMES, generateSyntax, resolveTheme } from "../../../src/theme"
import { toolCodeTheme, yamlColors } from "../../../src/theme/tool-code"
import { messageSegments } from "../../../src/util/message-blocks"
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

const metadata = [
  "[vibeterm_metadata]",
  "call: vibeterm_spawn_session",
  "process_id: 2597181",
  "sent_at_local: 2026-10-14T08:04:13.949-05:00 (America/Chicago) with a long value that has to wrap",
  "[/vibeterm_metadata]",
  "",
  "## Then do this",
  "1. `bun test`",
].join("\n")

async function blockChunks(markdown: boolean) {
  const segments = messageSegments(metadata, [{ open: "[vibeterm_*]", close: "[/vibeterm_*]", format: "yaml" }])
  const client = getTreeSitterClient()
  await client.initialize()
  const highlights = await Promise.all(
    segments.map(async (segment) => {
      if (segment.kind !== "text" || !markdown) return undefined
      const part = metadata.slice(segment.start, segment.end)
      return forgivingMarkdown(part, (await client.highlightOnce(part, "markdown")).highlights ?? [])
    }),
  )
  return messageChunks(metadata, segments, highlights, theme, generateSyntax(theme))
}

for (const width of [40, 80, 160]) {
  test(`a message with a yaml block wraps exactly like the plain text at ${width} columns`, async () => {
    const colored = await blockChunks(true)
    const plain = await frame(width, () => <text fg={theme.text}>{metadata}</text>)
    const styled = await frame(width, () => <StyledOutput content={metadata} chunks={colored} fg={theme.text} />)
    expect(styled).toBe(plain)
    expect(plain).toContain("[vibeterm_metadata]")
  })
}

test("draws a yaml block in its own colors, with or without markdown", async () => {
  const colors = yamlColors(theme)
  for (const markdown of [true, false]) {
    const colored = await blockChunks(markdown)
    expect(colored.map((chunk) => chunk.text).join("")).toBe(metadata)
    const color = (part: string) => colored.find((chunk) => chunk.text === part)?.fg
    expect(color("[vibeterm_metadata]\n")).toEqual(colors.fold)
    expect(color("[/vibeterm_metadata]")).toEqual(colors.fold)
    expect(color("call")).toEqual(colors.key)
    expect(color("vibeterm_spawn_session")).toEqual(colors.string)
    expect(color("2597181")).toEqual(colors.number)
    expect(colored.some((chunk) => chunk.text.includes("Then do this") && !chunk.fg?.equals(theme.text))).toBe(
      markdown,
    )
  }
})

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
