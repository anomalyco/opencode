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
import { createMarkdownPreprocessor, createMarkdownRenderer } from "../src/plugin/markdown"
import type { MarkdownPreprocessor } from "@opencode/plugin/tui/context"

test("unrelated plugin toggles preserve mounted Markdown blocks", async () => {
  const output = await createTestRenderer({ width: 80, height: 12, remote: true })
  const handler: MarkdownCodeBlockRenderer = () =>
    new TextRenderable(output.renderer, { content: "Custom fence", height: 1 })
  const [sources, setSources] = createSignal<ReadonlyArray<Readonly<Record<string, MarkdownCodeBlockRenderer>>>>([
    { example: handler },
    {},
  ])
  await render(() => {
    const renderBlock = createMarkdownRenderer(sources)
    return (
      <markdown
        syntaxStyle={SyntaxStyle.fromStyles({ default: { fg: "#ffffff" } }, output.renderer.nativeScene)}
        renderBlock={renderBlock()}
        content={"A plain paragraph.\n\n```example\nFence content\n```"}
        streaming={false}
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
      const renderBlock = createMarkdownRenderer(sources)
      const initial = renderBlock()

      setSources([{ other: first, example: second }])
      expect(renderBlock()).toBe(initial)
      setSources([{ example: first }, { other: first, example: second }])
      expect(renderBlock()).toBe(initial)

      setSources([{ example: first, other: first }])
      expect(renderBlock()).not.toBe(initial)
      setSources([])
      expect(renderBlock()).toBeUndefined()
    } finally {
      dispose()
    }
  })
})

test("changing and removing a Markdown handler refreshes existing messages", async () => {
  const output = await createTestRenderer({ width: 80, height: 12, remote: true })
  const first: MarkdownCodeBlockRenderer = () =>
    new TextRenderable(output.renderer, { content: "First renderer", height: 1 })
  const second: MarkdownCodeBlockRenderer = () =>
    new TextRenderable(output.renderer, { content: "Second renderer", height: 1 })
  const [sources, setSources] = createSignal<ReadonlyArray<Readonly<Record<string, MarkdownCodeBlockRenderer>>>>([
    { example: first },
  ])
  await render(() => {
    const renderBlock = createMarkdownRenderer(sources)
    return (
      <markdown
        syntaxStyle={SyntaxStyle.fromStyles({ default: { fg: "#ffffff" } }, output.renderer.nativeScene)}
        renderBlock={renderBlock()}
        content={"```example\nFence content\n```"}
        streaming={false}
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

test("markdown preprocessors chain in order, ignore undefined, and stay resilient on throw", () => {
  createRoot((dispose) => {
    try {
      const first: MarkdownPreprocessor = (text) => text.replace(/\\\((.*?)\\\)/g, (_, inner) => inner.trim())
      const noop: MarkdownPreprocessor = () => undefined
      const throwing: MarkdownPreprocessor = () => {
        throw new Error("boom")
      }
      const second: MarkdownPreprocessor = (text, input) =>
        input.streaming ? text : text.replace(/\\pi/g, "π")

      const [sources, setSources] = createSignal<ReadonlyArray<ReadonlyArray<MarkdownPreprocessor>>>([
        [first, noop],
        [throwing, second],
      ])
      const preprocess = createMarkdownPreprocessor(sources)

      expect(preprocess("Explore \\( \\pi \\)", { streaming: false, sessionID: "ses_1" })).toBe("Explore π")
      expect(preprocess("Explore \\( \\pi \\)", { streaming: true, sessionID: "ses_1" })).toBe("Explore \\pi")

      setSources([])
      expect(preprocess("Explore \\( \\pi \\)", { streaming: false })).toBe("Explore \\( \\pi \\)")
    } finally {
      dispose()
    }
  })
})

test("markdown preprocessors transform inline math before TUI rendering", async () => {
  const output = await createTestRenderer({ width: 80, height: 12, remote: true })
  const mathPreprocessor: MarkdownPreprocessor = (text) =>
    text.replace(/\\\((.*?)\\\)/g, (_, inner) => inner.trim().replace(/\\pi/g, "π"))
  const [sources, setSources] = createSignal<ReadonlyArray<ReadonlyArray<MarkdownPreprocessor>>>([[mathPreprocessor]])

  await render(() => {
    const preprocess = createMarkdownPreprocessor(sources)
    return (
      <markdown
        syntaxStyle={SyntaxStyle.fromStyles({ default: { fg: "#ffffff" } }, output.renderer.nativeScene)}
        content={preprocess("Value is \\( \\pi \\)", { streaming: false })}
        streaming={false}
      />
    )
  }, output.renderer)

  try {
    output.renderer.start()
    await output.waitForFrame((frame) => frame.includes("Value is π"))
    expect(output.captureCharFrame()).toContain("Value is π")

    setSources([])
    await output.waitForFrame((frame) => frame.includes("Value is ( \\pi )"))
    expect(output.captureCharFrame()).toContain("Value is ( \\pi )")
  } finally {
    output.renderer.destroy()
  }
})
