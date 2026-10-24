import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { afterAll, beforeAll, expect, test } from "bun:test"
import { assign, insert } from "solid-js/web"
import { createMarkdownRenderer, parseMarkdownNodes } from "./markdown-solid"

// `bun test` transpiles the renderer's JSX with the classic runtime, so the test supplies the
// pragma it calls. `assign` and `insert` keep the element and child handling the same.
Object.assign(globalThis, {
  React: {
    createElement(
      type: string | ((props: Record<string, unknown>) => unknown),
      props: Record<string, unknown> | null,
      ...children: unknown[]
    ) {
      if (typeof type === "function") return type({ ...props, children: children.length > 1 ? children : children[0] })

      const element = document.createElement(type)
      assign(element, props ?? {}, false, true)
      for (const child of children) insert(element, child as Node)

      return element
    },
  },
})

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

test("streams a paragraph word by word into the spans of a single render", () => {
  const words = ["Hello", "world", "again"]
  const streamed = document.createElement("div")
  const renderer = createMarkdownRenderer(streamed, "<p>Hello</p>", true)
  let spans = Array.from(streamed.querySelectorAll("[data-markdown-word]"))

  for (const index of words.slice(1).keys()) {
    renderer.update(`<p>${words.slice(0, index + 2).join(" ")}</p>`, true, true)
    const next = Array.from(streamed.querySelectorAll("[data-markdown-word]"))
    expect(spans.every((span, position) => next[position] === span)).toBe(true)
    spans = next
  }

  const oneShot = document.createElement("div")
  createMarkdownRenderer(oneShot, `<p>${words.join(" ")}</p>`, true)
  expect(streamed.innerHTML.replaceAll(' data-markdown-enter=""', "")).toBe(oneShot.innerHTML)
  renderer.dispose()
})
