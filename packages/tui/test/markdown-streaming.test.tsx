import { afterEach, expect, test } from "bun:test"
import { CodeRenderable, MarkdownRenderable, RGBA, SyntaxStyle, TextRenderable } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { batch, createSignal } from "solid-js"
import { ThemedMarkdown } from "../src/routes/session/message-parts"

const renderers: Awaited<ReturnType<typeof testRender>>["renderer"][] = []
const syntaxStyle = SyntaxStyle.fromStyles({ default: { fg: "#ffffff" } })

afterEach(() => {
  renderers.splice(0).forEach((renderer) => renderer.destroy())
})

test.each(["completion-first", "content-first"])("applies final fence text in a Solid batch: %s", async (order) => {
  const [content, setContent] = createSignal("```text\ninitial")
  const [streaming, setStreaming] = createSignal(true)
  const output = await testRender(
    () => (
      <markdown syntaxStyle={syntaxStyle} content={content()} streaming={streaming()} internalBlockMode="top-level" />
    ),
    { width: 80, height: 12, remote: true, useThread: false },
  )
  renderers.push(output.renderer)
  await output.renderOnce()

  batch(() => {
    if (order === "completion-first") setStreaming(false)
    setContent("```text\ninitial final\n```")
    if (order === "content-first") setStreaming(false)
  })
  await output.renderOnce()

  const markdown = output.renderer.root.getChildren()[0]
  expect(markdown).toBeInstanceOf(MarkdownRenderable)
  const block = markdown?.getChildren()[0]
  expect(block).toBeInstanceOf(CodeRenderable)
  if (!(block instanceof CodeRenderable)) throw new Error("Expected a code fence")
  expect(block.content).toBe("initial final")
  expect(markdown?.getChildren()).toHaveLength(1)
})

test("rebuilds the markdown tree when the syntax style changes", async () => {
  const first = SyntaxStyle.fromStyles({ default: { fg: "#123456" }, "markup.list": { fg: "#654321" } })
  const second = SyntaxStyle.fromStyles({ default: { fg: "#abcdef" }, "markup.list": { fg: "#ff00ff" } })
  const [syntax, setSyntax] = createSignal(first)
  const output = await testRender(
    () => (
      <ThemedMarkdown
        syntax={syntax()}
        content={"- apple\n- banana"}
        streaming={false}
        conceal={false}
        fg={RGBA.fromHex("#ffffff")}
        bg={RGBA.fromHex("#000000")}
      />
    ),
    { width: 80, height: 12, remote: true, useThread: false },
  )
  renderers.push(output.renderer)
  await output.renderOnce()

  const markerColor = () => {
    const markdown = output.renderer.root.getChildren()[0]
    if (!(markdown instanceof MarkdownRenderable)) throw new Error("Expected a markdown renderable")
    const list = markdown._blockStates.find((state) => state.token.type === "list")
    const marker = list?.renderable.getChildren()[0]?.getChildren()[0]
    return marker instanceof TextRenderable ? marker.chunks[0]?.fg : undefined
  }

  expect(markerColor()).toEqual(first.getStyle("markup.list")?.fg)

  setSyntax(second)
  await output.renderOnce()

  expect(markerColor()).toEqual(second.getStyle("markup.list")?.fg)
  first.destroy()
  second.destroy()
})
