import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { afterAll, beforeAll, expect, test } from "bun:test"
import { parseMarkdownNodes, settleMarkdownWords, unwrapMarkdownWords } from "./markdown-solid"

beforeAll(() => GlobalRegistrator.register())

afterAll(() => GlobalRegistrator.unregister())

test("assigns stable paths to elements and individual words", () => {
  expect(parseMarkdownNodes('<p class="lead">Hello <strong>streaming</strong> world</p>', true)).toEqual([
    {
      key: "0",
      type: "element",
      tag: "p",
      attributes: { class: "lead" },
      children: [
        { key: "0.0:0", type: "word", text: "Hello" },
        { key: "0.0:1", type: "text", text: " " },
        {
          key: "0.1",
          type: "element",
          tag: "strong",
          attributes: {},
          children: [{ key: "0.1.0:0", type: "word", text: "streaming" }],
        },
        { key: "0.2:1", type: "text", text: " " },
        { key: "0.2:2", type: "word", text: "world" },
      ],
    },
  ])
})

test("keeps completed block text compact", () => {
  expect(parseMarkdownNodes("<p>Hello world</p>", false)).toEqual([
    {
      key: "0",
      type: "element",
      tag: "p",
      attributes: {},
      children: [{ key: "0.0", type: "text", text: "Hello world" }],
    },
  ])
})

test("marks streamed inline code for animation", () => {
  expect(parseMarkdownNodes("<p><code>file.ts:29-43</code></p>", true, true)).toEqual([
    {
      key: "0",
      type: "element",
      tag: "p",
      attributes: {},
      children: [
        {
          key: "0.0",
          type: "element",
          tag: "code",
          attributes: {},
          children: Array.from("file.ts:29-43", (text, index) => ({
            key: `0.0.0:${index}`,
            type: "word",
            text,
            animate: true,
          })),
          animate: true,
        },
      ],
    },
  ])
})

test("marks words for animation only when requested", () => {
  expect(
    parseMarkdownNodes("<p>Hello</p>", true).flatMap((node) => (node.type === "element" ? node.children : [node]))[0],
  ).toEqual({
    key: "0.0:0",
    type: "word",
    text: "Hello",
  })
  expect(
    parseMarkdownNodes("<p>Hello</p>", true, true).flatMap((node) =>
      node.type === "element" ? node.children : [node],
    )[0],
  ).toEqual({
    key: "0.0:0",
    type: "word",
    text: "Hello",
    animate: true,
  })
})

test("unwraps word spans in place while retaining elements and selection", () => {
  const container = document.createElement("div")
  container.innerHTML =
    '<div id="settled"><p>Earlier block</p></div><div id="live"><p><span data-markdown-word="">Hello</span> <strong><span data-markdown-word="">world</span></strong> <span data-markdown-word="" data-markdown-enter="">again</span></p></div>'
  document.body.appendChild(container)

  const settledText = container.querySelector("#settled p")!.firstChild!
  const block = container.querySelector<HTMLElement>("#live")!
  const paragraph = block.querySelector("p")!
  const strong = block.querySelector("strong")!
  const wordSpan = strong.querySelector("[data-markdown-word]")!
  const range = document.createRange()
  range.selectNodeContents(wordSpan)
  const selection = window.getSelection()!
  selection.removeAllRanges()
  selection.addRange(range)
  expect(selection.toString()).toBe("world")

  unwrapMarkdownWords(block)

  expect(block.querySelector("p")).toBe(paragraph)
  expect(block.querySelector("strong")).toBe(strong)
  expect(block.querySelectorAll("[data-markdown-word]").length).toBe(0)
  expect(block.querySelectorAll("[data-markdown-enter]").length).toBe(0)
  expect(window.getSelection()?.toString()).toBe("world")

  // Cross-block selection anchored in Text nodes also survives unwrapping.
  block.innerHTML =
    '<p><span data-markdown-word="">Hello</span> <strong><span data-markdown-word="">world</span></strong></p>'
  const crossRange = document.createRange()
  crossRange.setStart(settledText, 8)
  crossRange.setEnd(block.querySelector("strong [data-markdown-word]")!.firstChild!, 3)
  selection.removeAllRanges()
  selection.addRange(crossRange)
  const expectedCross = selection.toString()
  unwrapMarkdownWords(block)
  expect(window.getSelection()?.toString()).toBe(expectedCross)

  // A backward selection keeps its anchor after the focus. (happy-dom doesn't move ranges through
  // normalize(), so the words sit in separate elements here; the Chromium spec covers merged text.)
  block.innerHTML =
    '<p><em><span data-markdown-word="">Hello</span></em> <strong><span data-markdown-word="">world</span></strong></p>'
  const [hello, world] = Array.from(block.querySelectorAll("[data-markdown-word]"), (span) => span.firstChild!)
  selection.setBaseAndExtent(world, 3, hello, 1)
  unwrapMarkdownWords(block)
  expect(selection.toString()).toBe("ello wor")
  expect([selection.anchorNode, selection.anchorOffset, selection.focusNode, selection.focusOffset]).toEqual([
    world,
    3,
    hello,
    1,
  ])

  // Without an active selection inside the block, unwrapped text nodes are normalized.
  selection.removeAllRanges()
  block.innerHTML = '<p><span data-markdown-word="">Hello</span> <span data-markdown-word="">world</span></p>'
  unwrapMarkdownWords(block)
  expect(block.querySelector("p")?.childNodes.length).toBe(1)
  container.remove()
})

test("waits for running enter animations before unwrapping word spans", async () => {
  const block = document.createElement("div")
  block.dataset.markdownHash = "1"
  block.dataset.markdownMode = "full"
  block.innerHTML = '<p><span data-markdown-word="" data-markdown-enter="">Hello</span></p>'
  document.body.appendChild(block)

  const { promise: finished, resolve: finish } = Promise.withResolvers<void>()
  const enter = block.querySelector<HTMLElement>("[data-markdown-enter]")!

  Object.defineProperty(enter, "getAnimations", {
    value: () => [{ playState: "running", finished }],
  })

  settleMarkdownWords(block)
  expect(block.querySelectorAll("[data-markdown-word]").length).toBe(1)

  finish()
  await finished
  await Promise.resolve()
  expect(block.querySelectorAll("[data-markdown-word]").length).toBe(0)
  block.remove()
})
