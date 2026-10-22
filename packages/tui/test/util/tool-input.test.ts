import { describe, expect, test } from "bun:test"
import {
  fitsInline,
  formatToolInput,
  inlineToolInput,
  toolOutputReach,
  type ToolInputRow,
} from "../../src/util/tool-input"

const whole = (output: string) => ({ output, overflow: false })
const text = (rows: ToolInputRow[]) => rows.map((row) => row.map((segment) => segment.text).join(""))

describe("fitsInline", () => {
  test("keeps short primitive input on one line", () => {
    expect(fitsInline({ query: "opencode", limit: 5, exact: true })).toBe(true)
    expect(fitsInline({})).toBe(true)
  })

  test("sends nested, multi-line, null or long input to a block", () => {
    expect(fitsInline({ options: { limit: 5 } })).toBe(false)
    expect(fitsInline({ tags: ["a"] })).toBe(false)
    expect(fitsInline({ body: "one\ntwo" })).toBe(false)
    expect(fitsInline({ cursor: null })).toBe(false)
    expect(fitsInline({ prompt: "x".repeat(80) })).toBe(false)
  })

  test("measures the one-line form", () => {
    expect(inlineToolInput({ a: 1, b: "two", c: { d: 1 } })).toBe("[a=1, b=two]")
    expect(inlineToolInput({ a: 1, b: 2 }, ["a"])).toBe("[b=2]")
  })
})

describe("formatToolInput", () => {
  test("writes one key per row in compact YAML: list items at their key's indent", () => {
    const { rows, overflow } = formatToolInput({
      query: "select 1",
      limit: 10,
      exact: false,
      cursor: null,
      options: { tags: ["a", 2], deep: { on: true } },
      items: [{ name: "x", id: 1 }, [], {}, ["p", "q"]],
      empty: "",
    })
    expect(overflow).toBe(false)
    expect(text(rows)).toEqual([
      "query: select 1",
      "limit: 10",
      "exact: false",
      "cursor: null",
      "options:",
      "  tags:",
      "  - a",
      "  - 2",
      "  deep:",
      "    on: true",
      "items:",
      "- name: x",
      "  id: 1",
      "- []",
      "- {}",
      "-",
      "  - p",
      "  - q",
      'empty: ""',
    ])
  })

  test("lays out a question list the way YAML would", () => {
    const { rows } = formatToolInput({
      questions: [{ header: "Paste", question: "Works?", options: [{ label: "Yes", description: "All good" }] }],
    })
    expect(text(rows)).toEqual([
      "questions:",
      "- header: Paste",
      "  question: Works?",
      "  options:",
      "  - label: Yes",
      "    description: All good",
    ])
  })

  test("shows strings unquoted with their newlines, tabs and quotes as real characters", () => {
    const { rows } = formatToolInput(JSON.parse('{"body":"say \\"hi\\"\\n\\tindented","title":"a \\"b\\""}'))
    expect(text(rows)).toEqual(["body:", '  say "hi"', "  \tindented", 'title: a "b"'])
  })

  test("starts a multi-line list item after its dash", () => {
    const { rows } = formatToolInput({ steps: ["one\ntwo"] })
    expect(text(rows)).toEqual(["steps:", "- one", "  two"])
  })

  test("colors keys and values by type", () => {
    const { rows } = formatToolInput({ a: "s", b: 1, c: true, d: null })
    expect(rows.map((row) => row.map((segment) => segment.kind))).toEqual([
      ["indent", "key", "punctuation", "string"],
      ["indent", "key", "punctuation", "number"],
      ["indent", "key", "punctuation", "boolean"],
      ["indent", "key", "punctuation", "null"],
    ])
  })

  test("collapsed, gives every value one row of the width, cut with an ellipsis", () => {
    const { rows, overflow } = formatToolInput(
      { title: "Color heredocs in bash", body: "Steps:\n\t1. run\n\t2. look", tags: ["tui", "a much longer label"] },
      20,
    )
    expect(overflow).toBe(true)
    expect(text(rows)).toEqual([
      "title: Color heredo…",
      "body: Steps: 1. run…",
      "tags:",
      "- tui",
      "- a much longer lab…",
    ])
    expect(text(rows).every((row) => row.length <= 20)).toBe(true)
    expect(rows[0].at(-1)).toEqual({ text: "…", kind: "fold" })
  })

  test("collapsed, keeps values that fit and reports nothing hidden", () => {
    const { rows, overflow } = formatToolInput({ title: "short", n: 2 }, 40)
    expect(overflow).toBe(false)
    expect(text(rows)).toEqual(["title: short", "n: 2"])
  })

  test("collapsed, joins a short multi-line string onto its row and still reports it hidden", () => {
    const { rows, overflow } = formatToolInput({ body: "one\ntwo" }, 40)
    expect(overflow).toBe(true)
    expect(text(rows)).toEqual(["body: one two"])
  })

  test("collapsed, cuts by display width, not by characters", () => {
    const { rows } = formatToolInput({ k: "日本語のテキスト" }, 10)
    expect(text(rows)).toEqual(["k: 日本語…"])
  })
})

describe("toolOutputReach", () => {
  const base = { output: true, toggle: false, toolInput: true, expanded: false }

  test("holds a response the toggle hides when the input is a block, and draws it once expanded", () => {
    expect(toolOutputReach(base)).toEqual({ held: true, shown: false })
    expect(toolOutputReach({ ...base, expanded: true })).toEqual({ held: true, shown: true })
  })

  test("draws a response whenever the toggle shows output", () => {
    expect(toolOutputReach({ ...base, toggle: true })).toEqual({ held: false, shown: true })
    expect(toolOutputReach({ ...base, toggle: true, toolInput: false })).toEqual({ held: false, shown: true })
  })

  test("leaves the toggle in charge without the input block, as upstream does", () => {
    expect(toolOutputReach({ ...base, toolInput: false, expanded: true })).toEqual({ held: false, shown: false })
  })

  test("has nothing to hold or draw without a response", () => {
    expect(toolOutputReach({ ...base, output: false, expanded: true })).toEqual({ held: false, shown: false })
    expect(toolOutputReach({ ...base, output: false, toggle: true })).toEqual({ held: false, shown: false })
  })
})
