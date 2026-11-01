import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { afterAll, beforeAll, expect, test } from "bun:test"
import { parseMarkdownNodes } from "./markdown-solid"

beforeAll(() => GlobalRegistrator.register())

afterAll(() => GlobalRegistrator.unregister())

function parse(html: string, words: boolean, animate?: boolean) {
  const template = document.createElement("template")
  template.innerHTML = html

  return parseMarkdownNodes(template.content, words, animate)
}

test("assigns stable paths to elements and individual words", () => {
  expect(parse('<p class="lead">Hello <strong>streaming</strong> world</p>', true)).toEqual([
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
  expect(parse("<p>Hello world</p>", false)).toEqual([
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
  expect(parse("<p><code>file.ts:29-43</code></p>", true, true)).toEqual([
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
  expect(parse("<p>Hello</p>", true).flatMap((node) => (node.type === "element" ? node.children : [node]))[0]).toEqual({
    key: "0.0:0",
    type: "word",
    text: "Hello",
  })
  expect(
    parse("<p>Hello</p>", true, true).flatMap((node) => (node.type === "element" ? node.children : [node]))[0],
  ).toEqual({
    key: "0.0:0",
    type: "word",
    text: "Hello",
    animate: true,
  })
})
