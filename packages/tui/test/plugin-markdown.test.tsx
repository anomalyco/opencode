import { expect, test } from "bun:test"
import {
  CodeRenderable,
  MarkdownRenderable,
  SyntaxStyle,
  TextRenderable,
  type MarkdownCodeBlockRenderer,
} from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { render } from "@opentui/solid"
import { createRoot, createSignal } from "solid-js"
import { createMarkdownRenderer } from "../src/plugin/markdown"

test("unrelated plugin toggles preserve mounted Markdown blocks", async () => {
  const output = await createTestRenderer({ width: 80, height: 12, remote: true, useThread: false })
  const handler: MarkdownCodeBlockRenderer = () =>
    new TextRenderable(output.renderer, { content: "Custom fence", height: 1 })
  const [sources, setSources] = createSignal<ReadonlyArray<Readonly<Record<string, MarkdownCodeBlockRenderer>>>>([
    { example: handler },
    {},
  ])
  await render(() => {
    const renderNode = createMarkdownRenderer(sources)
    return (
      <markdown
        syntaxStyle={SyntaxStyle.fromStyles({ default: { fg: "#ffffff" } })}
        renderNode={renderNode()}
        content={"A plain paragraph.\n\n```example\nFence content\n```"}
        streaming={false}
        internalBlockMode="top-level"
      />
    )
  }, output.renderer)
  try {
    output.renderer.start()
    await output.waitForFrame((frame) => frame.includes("Custom fence"))
    const markdown = output.renderer.root.getChildren()[0]
    if (!(markdown instanceof MarkdownRenderable)) throw new Error("Expected Markdown")
    const initial = markdown.getChildren()
    expect(initial).toHaveLength(2)
    expect(output.captureCharFrame()).toContain("Custom fence")

    for (const active of [false, true, false, true]) {
      setSources([{ example: handler }, ...(active ? [{}] : [])])
      await output.renderOnce()
      expect(markdown.getChildren()[0] === initial[0]).toBe(true)
      expect(markdown.getChildren()[1] === initial[1]).toBe(true)
      expect(initial.every((block) => !block.isDestroyed)).toBe(true)
    }
  } finally {
    output.renderer.destroy()
  }
})

test("effective mappings preserve identity through reordered and shadowed contributions", () => {
  createRoot((dispose) => {
    try {
      const first: MarkdownCodeBlockRenderer = () => undefined
      const second: MarkdownCodeBlockRenderer = () => undefined
      const [sources, setSources] = createSignal<ReadonlyArray<Readonly<Record<string, MarkdownCodeBlockRenderer>>>>([
        { example: first },
        { example: second, other: first },
      ])
      const renderNode = createMarkdownRenderer(sources)
      const initial = renderNode()

      setSources([{ other: first, example: second }])
      expect(renderNode()).toBe(initial)
      setSources([{ example: first }, { other: first, example: second }])
      expect(renderNode()).toBe(initial)

      setSources([{ example: first, other: first }])
      expect(renderNode()).not.toBe(initial)
      setSources([])
      expect(renderNode()).toBeUndefined()
    } finally {
      dispose()
    }
  })
})

test("changing and removing a Markdown handler refreshes existing messages", async () => {
  const output = await createTestRenderer({ width: 80, height: 12, remote: true, useThread: false })
  const first: MarkdownCodeBlockRenderer = () =>
    new TextRenderable(output.renderer, { content: "First renderer", height: 1 })
  const second: MarkdownCodeBlockRenderer = () =>
    new TextRenderable(output.renderer, { content: "Second renderer", height: 1 })
  const [sources, setSources] = createSignal<ReadonlyArray<Readonly<Record<string, MarkdownCodeBlockRenderer>>>>([
    { example: first },
  ])
  await render(() => {
    const renderNode = createMarkdownRenderer(sources)
    return (
      <markdown
        syntaxStyle={SyntaxStyle.fromStyles({ default: { fg: "#ffffff" } })}
        renderNode={renderNode()}
        content={"```example\nFence content\n```"}
        streaming={false}
        internalBlockMode="top-level"
      />
    )
  }, output.renderer)
  try {
    output.renderer.start()
    await output.waitForFrame((frame) => frame.includes("First renderer"))

    setSources([{ example: first }, { example: second }])
    await output.waitForFrame((frame) => frame.includes("Second renderer"))

    setSources([{ example: first }])
    await output.waitForFrame((frame) => frame.includes("First renderer"))

    setSources([])
    await output.waitForFrame((frame) => frame.includes("Fence content"))
    expect(output.renderer.root.getChildren()[0]?.getChildren()[0]).toBeInstanceOf(CodeRenderable)

    setSources([{ example: second }])
    await output.waitForFrame((frame) => frame.includes("Second renderer"))
  } finally {
    output.renderer.destroy()
  }
})
