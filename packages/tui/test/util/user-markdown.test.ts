import { describe, expect, test } from "bun:test"
import { getTreeSitterClient, type SimpleHighlight } from "@opentui/core"
import { forgivingMarkdown } from "../../src/util/user-markdown"

async function highlights(text: string) {
  const client = getTreeSitterClient()
  await client.initialize()
  const result = await client.highlightOnce(text, "markdown")
  return forgivingMarkdown(text, result.highlights ?? [])
}

const groups = (text: string, kept: SimpleHighlight[]) =>
  kept.map(([start, end, group]) => [text.slice(start, end), group] as const)

describe("forgivingMarkdown", () => {
  test("colors what people mean by markdown", async () => {
    const text = [
      "# Title",
      "### Third",
      "1. ble",
      "2. blah",
      "- bullet",
      "run `bun test` **now** and *then*",
      "",
      "| a | b |",
      "|---|---|",
      "| 1 | 2 |",
      "",
      "```ts",
      "const x = 1",
      "```",
    ].join("\n")
    const kept = groups(text, await highlights(text))
    expect(kept).toContainEqual(["# Title\n", "markup.heading.1"])
    expect(kept).toContainEqual(["### Third\n", "markup.heading.3"])
    expect(kept).toContainEqual(["1. ", "markup.list"])
    expect(kept).toContainEqual(["2. ", "markup.list"])
    expect(kept).toContainEqual(["- ", "markup.list"])
    expect(kept).toContainEqual(["`bun test`", "markup.raw"])
    expect(kept).toContainEqual(["**now**", "markup.strong"])
    expect(kept).toContainEqual(["*then*", "markup.italic"])
    expect(kept).toContainEqual(["a ", "markup.heading"])
    expect(kept).toContainEqual(["const", "keyword"])
    expect(kept.some(([, group]) => group === "spell" || group === "nospell")).toBe(false)
  })

  test("leaves what people write by accident plain", async () => {
    const text = ["done", "---", "", "    aligned with four spaces", "", "> quoted", "not quoted", "", "2*3*4"].join("\n")
    const kept = groups(text, await highlights(text))
    expect(kept.filter(([, group]) => group.startsWith("markup.heading"))).toEqual([])
    expect(kept.filter(([, group]) => group === "markup.raw.block")).toEqual([])
    expect(kept.filter(([, group]) => group === "markup.quote")).toEqual([["> quoted\n", "markup.quote"]])
    expect(kept.filter(([, group]) => group === "markup.italic")).toEqual([])
    expect(kept.filter(([text]) => text === "*")).toEqual([])
  })

  test("keeps fenced code blocks", async () => {
    const text = "~~~\nplain fence\n~~~"
    const kept = groups(text, await highlights(text))
    expect(kept.some(([, group]) => group === "markup.raw.block")).toBe(true)
  })
})
