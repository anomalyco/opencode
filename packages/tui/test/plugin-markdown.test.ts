import { expect, test } from "bun:test"
import { SyntaxStyle, TextRenderable, type MarkdownOptions, type RenderNodeContext } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { combineMarkdownRenderers } from "../src/plugin/context"

const code = (language: string) => ({ type: "code" as const, lang: language, text: "content", raw: "" })
const context: RenderNodeContext = {
  syntaxStyle: SyntaxStyle.fromStyles({ default: { fg: "#ffffff" } }),
  conceal: false,
  concealCode: false,
  defaultRender: () => null,
}

test("dispatches Markdown code blocks by normalized language", async () => {
  const { renderer } = await createTestRenderer({ width: 20, height: 4 })
  const expected = new TextRenderable(renderer, { content: "expected" })
  const render = (() => expected) satisfies NonNullable<MarkdownOptions["renderNode"]>
  const combined = combineMarkdownRenderers([{ mermaid: render }])!

  expect(combined(code("mermaid title=example"), context)).toBe(expected)
  expect(combined(code("typescript"), context)).toBeUndefined()
  renderer.destroy()
})

test("later Markdown renderer registrations take precedence", async () => {
  const { renderer } = await createTestRenderer({ width: 20, height: 4 })
  const first = new TextRenderable(renderer, { content: "first" })
  const second = new TextRenderable(renderer, { content: "second" })
  const combined = combineMarkdownRenderers([{ mermaid: () => first }, { mermaid: () => second }])!

  expect(combined(code("mermaid"), context)).toBe(second)
  expect(combineMarkdownRenderers([])).toBeUndefined()
  renderer.destroy()
})
