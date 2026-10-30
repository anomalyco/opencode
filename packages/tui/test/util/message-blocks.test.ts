import { describe, expect, test } from "bun:test"
import { messageSegments, yamlSegments, type MessageSegment } from "../../src/util/message-blocks"

const vibeterm = [{ open: "[vibeterm_*]", close: "[/vibeterm_*]", format: "yaml" }]

const message = [
  "[vibeterm_metadata]",
  "call: vibeterm_spawn_session",
  "process_id: 2597181",
  "[/vibeterm_metadata]",
  "",
  "Do the `thing`.",
].join("\n")

function slices(text: string, segments: MessageSegment[]) {
  return segments.map((segment) =>
    segment.kind === "text"
      ? { text: text.slice(segment.start, segment.end) }
      : {
          open: text.slice(segment.open.start, segment.open.end),
          body: text.slice(segment.body.start, segment.body.end),
          close: text.slice(segment.close.start, segment.close.end),
        },
  )
}

describe("messageSegments", () => {
  test("picks out a block between its opening and its closing line", () => {
    expect(slices(message, messageSegments(message, vibeterm))).toEqual([
      {
        open: "[vibeterm_metadata]\n",
        body: "call: vibeterm_spawn_session\nprocess_id: 2597181\n",
        close: "[/vibeterm_metadata]",
      },
      { text: "\n\nDo the `thing`." },
    ])
  })

  test("closes a block only at the closing line with the same name", () => {
    const text = [
      "intro",
      "[vibeterm_metadata]",
      "a: 1",
      "[/vibeterm_response_metadata]",
      "b: 2",
      "[/vibeterm_metadata]",
      "[vibeterm_response_metadata]",
      "c: 3",
      "[/vibeterm_response_metadata]",
    ].join("\n")
    expect(slices(text, messageSegments(text, vibeterm))).toEqual([
      { text: "intro\n" },
      {
        open: "[vibeterm_metadata]\n",
        body: "a: 1\n[/vibeterm_response_metadata]\nb: 2\n",
        close: "[/vibeterm_metadata]",
      },
      { text: "\n" },
      { open: "[vibeterm_response_metadata]\n", body: "c: 3\n", close: "[/vibeterm_response_metadata]" },
    ])
  })

  test("leaves an unclosed block, a partial line and an empty rule as plain text", () => {
    const text = "[vibeterm_metadata]\na: 1\nsee [vibeterm_metadata] here\n[/vibeterm_other]"
    expect(messageSegments(text, vibeterm)).toEqual([{ kind: "text", start: 0, end: text.length }])
    expect(messageSegments(message, [{ open: " ", close: "x", format: "yaml" }])).toEqual([
      { kind: "text", start: 0, end: message.length },
    ])
  })

  test("covers the text exactly, in order", () => {
    const text = `${message}\n${message}\n`
    const segments = messageSegments(text, vibeterm)
    expect(segments.filter((segment) => segment.kind === "block")).toHaveLength(2)
    expect(segments.map((segment) => text.slice(segment.start, segment.end)).join("")).toBe(text)
  })

  test("takes the first rule whose opening line matches, with literal patterns", () => {
    const text = "<<sql>>\nselect 1\n<</sql>>"
    const rules = [
      { open: "<<sql>>", close: "<</sql>>", format: "sql" },
      { open: "<<*>>", close: "<</*>>", format: "yaml" },
    ]
    expect(messageSegments(text, rules)).toMatchObject([{ kind: "block", format: "sql" }])
  })
})

describe("yamlSegments", () => {
  test("colors key: value lines by type and keeps every character", () => {
    const body = [
      "call: vibeterm_spawn_session",
      "process_id: 2597181",
      "sent_at: 2026-10-14T13:04:13.949Z",
      "worktree: (main)",
      "enabled: true",
      "  nested: ~",
      "- item",
      "# comment",
      "not a key value line",
      "",
    ].join("\n")
    const segments = yamlSegments(body)
    expect(segments.map((segment) => segment.text).join("")).toBe(body)
    const kind = (text: string) => segments.find((segment) => segment.text === text)?.kind
    expect(kind("call")).toBe("key")
    expect(kind(":")).toBe("punctuation")
    expect(kind("vibeterm_spawn_session")).toBe("string")
    expect(kind("2597181")).toBe("number")
    expect(kind("2026-10-14T13:04:13.949Z")).toBe("string")
    expect(kind("true")).toBe("boolean")
    expect(kind("~")).toBe("null")
    expect(kind("- ")).toBe("punctuation")
    expect(kind("item")).toBe("string")
    expect(kind("# comment")).toBe("fold")
    expect(kind("not a key value line")).toBe("string")
  })
})
