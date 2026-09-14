import { afterEach, expect, test } from "bun:test"
import { CodeRenderable, MarkdownRenderable, SyntaxStyle } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { batch, createSignal } from "solid-js"

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
