import { afterEach, describe, expect, test } from "bun:test"
import { BoxRenderable, MarkdownRenderable, RGBA, SyntaxStyle, TextRenderable, type Renderable } from "@opentui/core"
import { createTestRenderer, type TestRendererSetup } from "@opentui/core/testing"
import {
  clearHighlights,
  findMatches,
  highlightMatches,
  matchRow,
  moveCurrent,
  searchable,
  staleMatches,
  type SearchMatch,
} from "../../src/routes/session/search"

const style = {
  match: { fg: RGBA.fromHex("#000000"), bg: RGBA.fromHex("#ff0000") },
  current: { fg: RGBA.fromHex("#000000"), bg: RGBA.fromHex("#00ff00") },
}

let setup: TestRendererSetup | undefined

afterEach(() => {
  setup?.renderer.destroy()
  setup = undefined
})

async function render(width: number, build: (root: BoxRenderable, ctx: TestRendererSetup["renderer"]) => void) {
  setup = await createTestRenderer({ width, height: 60 })
  const root = new BoxRenderable(setup.renderer, { flexDirection: "column" })
  setup.renderer.root.add(root)
  build(root, setup.renderer)
  await settle()
  return root
}

// Markdown concealment runs asynchronously in tree-sitter, so wait for the frame to stop changing.
async function settle() {
  let previous = ""
  for (let pass = 0; pass < 100; pass++) {
    await setup!.renderOnce()
    const frame = setup!.captureCharFrame()
    if (frame === previous && pass > 3) return
    previous = frame
    await Bun.sleep(20)
  }
}

function painted(color: RGBA) {
  return setup!
    .captureSpans()
    .lines.flatMap((line, row) =>
      line.spans.filter((span) => (span.bg as RGBA).equals(color)).map((span) => ({ row, text: span.text })),
    )
}

function search(root: Renderable, query: string) {
  return findMatches(root, query, setup!.renderer.widthMethod)
}

async function highlight(matches: SearchMatch[], current = -1) {
  highlightMatches(matches, current, style)
  await setup!.renderOnce()
  await setup!.renderOnce()
}

describe("session search", () => {
  test("highlights exact cells across newlines, wrapping, tabs and wide characters", async () => {
    const root = await render(40, (root, ctx) => {
      const text = new TextRenderable(ctx, {
        content: "first apple\n🍎 日本 apple ✓ → …\n\n\ttabbed apple\nthis line is long enough to wrap before the apple here",
      })
      searchable.add(text)
      root.add(text)
    })

    const matches = search(root, "apple")
    await highlight(matches)

    const hits = painted(style.match.bg)
    expect(hits.map((hit) => hit.text)).toEqual(["apple", "apple", "apple", "apple"])
    expect(matches.map(matchRow)).toEqual(hits.map((hit) => hit.row))
  })

  test("searches rendered markdown text, lists and tables without raw markers", async () => {
    const root = await render(60, (root, ctx) => {
      const markdown = new MarkdownRenderable(ctx, {
        syntaxStyle: SyntaxStyle.fromStyles({ default: { fg: "#ffffff" } }),
        content: [
          "Paragraph with **bold apple** and `code apple`.",
          "",
          "- list apple",
          "",
          "| name | fruit |",
          "| --- | --- |",
          "| a | green apple |",
          "| b | red apple |",
          "",
          "# Heading apple",
        ].join("\n"),
        internalBlockMode: "top-level",
        tableOptions: { style: "grid" },
        conceal: true,
        streaming: true,
      })
      searchable.add(markdown)
      root.add(markdown)
    })

    expect(search(root, "with bold apple")).toHaveLength(1)
    const matches = search(root, "apple")
    await highlight(matches)

    const hits = painted(style.match.bg)
    expect(hits.map((hit) => hit.text)).toEqual(Array(matches.length).fill("apple"))
    expect(matches).toHaveLength(6)
    expect(matches.map(matchRow)).toEqual(hits.map((hit) => hit.row))
  })

  test("only searches registered renderables", async () => {
    const root = await render(40, (root, ctx) => {
      const user = new TextRenderable(ctx, { content: "user apple" })
      searchable.add(user)
      root.add(user)
      root.add(new TextRenderable(ctx, { content: "tool output apple" }))
    })

    expect(search(root, "apple")).toHaveLength(1)
  })

  test("uses smart case", async () => {
    const root = await render(40, (root, ctx) => {
      const text = new TextRenderable(ctx, { content: "Apple apple APPLE" })
      searchable.add(text)
      root.add(text)
    })

    expect(search(root, "apple")).toHaveLength(3)
    expect(search(root, "Apple")).toHaveLength(1)
    expect(search(root, "a.p")).toHaveLength(0)
  })

  test("reports visible matches whose text buffer was rebuilt", async () => {
    let text: TextRenderable | undefined
    let markdown: MarkdownRenderable | undefined
    const root = await render(30, (root, ctx) => {
      text = new TextRenderable(ctx, { content: "one apple\nsecond line that wraps around twice, apple" })
      markdown = new MarkdownRenderable(ctx, {
        syntaxStyle: SyntaxStyle.fromStyles({ default: { fg: "#ffffff" } }),
        content: "Some **bold** apple\n\n| fruit |\n| --- |\n| apple |",
        internalBlockMode: "top-level",
        tableOptions: { style: "grid" },
        conceal: true,
        streaming: true,
      })
      searchable.add(text)
      searchable.add(markdown)
      root.add(text)
      root.add(markdown)
    })

    const matches = search(root, "apple")
    expect(matches).toHaveLength(4)
    await highlight(matches)
    expect(staleMatches(matches, 0, 60)).toBe(false)

    text!.content = "one apple\nsecond line that wraps around twice, apple"
    await setup!.renderOnce()
    expect(staleMatches(matches, 0, 60)).toBe(true)
    expect(staleMatches(matches, 30, 60)).toBe(false)

    const fresh = search(root, "apple")
    await highlight(fresh)
    expect(staleMatches(fresh, 0, 60)).toBe(false)
    markdown!.content = "Some **bold** apple!\n\n| fruit |\n| --- |\n| apple |"
    await settle()
    expect(staleMatches(fresh, 0, 60)).toBe(true)
  })

  test("moves the current highlight and clears everything", async () => {
    const root = await render(40, (root, ctx) => {
      const text = new TextRenderable(ctx, { content: "one apple\ntwo apple" })
      searchable.add(text)
      root.add(text)
    })

    const matches = search(root, "apple")
    await highlight(matches, 0)
    expect(painted(style.current.bg).map((hit) => hit.row)).toEqual([0])
    expect(painted(style.match.bg).map((hit) => hit.row)).toEqual([1])

    moveCurrent(matches, 0, 1, style)
    await setup!.renderOnce()
    expect(painted(style.current.bg).map((hit) => hit.row)).toEqual([1])
    expect(painted(style.match.bg).map((hit) => hit.row)).toEqual([0])

    clearHighlights(matches)
    await setup!.renderOnce()
    expect(painted(style.current.bg)).toEqual([])
    expect(painted(style.match.bg)).toEqual([])
  })
})
