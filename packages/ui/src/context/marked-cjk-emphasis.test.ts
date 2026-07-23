import { expect, test } from "bun:test"
import { Marked } from "marked"
import { markedCjkEmphasis } from "./marked-cjk-emphasis"

test("renders bold closed by CJK punctuation and followed by CJK text", async () => {
  const marked = new Marked(markedCjkEmphasis)

  expect(await marked.parse("产出**指令（directive）**投到责任会话")).toBe(
    "<p>产出<strong>指令（directive）</strong>投到责任会话</p>\n",
  )
  expect(await marked.parse("含**「重点」**内容")).toBe("<p>含<strong>「重点」</strong>内容</p>\n")
  expect(await marked.parse("产出一项**【编排对账】**指令")).toBe("<p>产出一项<strong>【编排对账】</strong>指令</p>\n")
})

test("renders italic with CJK punctuation boundary", async () => {
  const marked = new Marked(markedCjkEmphasis)

  expect(await marked.parse("含*「重点」*内容")).toBe("<p>含<em>「重点」</em>内容</p>\n")
})

test("keeps standard emphasis behavior unchanged", async () => {
  const marked = new Marked(markedCjkEmphasis)

  expect(await marked.parse("注意**重要**事项")).toBe("<p>注意<strong>重要</strong>事项</p>\n")
  expect(await marked.parse("a **bold** b")).toBe("<p>a <strong>bold</strong> b</p>\n")
  expect(await marked.parse("**bold** and *em*")).toBe("<p><strong>bold</strong> and <em>em</em></p>\n")
})

test("rejects space-padded or star-padded delimiters", async () => {
  const marked = new Marked(markedCjkEmphasis)

  expect(await marked.parse("a ** b ** c")).toBe("<p>a ** b ** c</p>\n")
  expect(await marked.parse("2 * 3 * 4")).toBe("<p>2 * 3 * 4</p>\n")
})

test("leaves triple-star nesting to the builtin tokenizer", async () => {
  const marked = new Marked(markedCjkEmphasis)

  expect(await marked.parse("***bold***")).toBe("<p><em><strong>bold</strong></em></p>\n")
})
