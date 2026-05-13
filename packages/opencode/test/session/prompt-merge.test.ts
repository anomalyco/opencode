import { describe, expect, test } from "bun:test"
import { mergeCommandParts } from "../../src/session/prompt-merge"

const file = (url: string, overrides: { filename?: string; mime?: string } = {}) => ({
  type: "file" as const,
  url,
  mime: overrides.mime ?? "text/plain",
  filename: overrides.filename ?? "file.md",
})

const agent = (name: string) => ({ type: "agent" as const, name })
const text = (t: string) => ({ type: "text" as const, text: t })

describe("mergeCommandParts", () => {
  test("returns concat unchanged when there is no overlap", () => {
    const result = mergeCommandParts(
      [text("template body"), file("file:///repo/AGENTS.md", { filename: "AGENTS.md" })],
      [file("file:///repo/USER.md", { filename: "USER.md" })],
    )
    expect(result).toHaveLength(3)
    expect(result.map((p) => p.type)).toEqual(["text", "file", "file"])
  })

  test("drops FilePart from inputParts when its URL already appeared in templateParts", () => {
    const result = mergeCommandParts(
      [file("file:///repo/AGENTS.md", { filename: "AGENTS.md" })],
      [file("file:///repo/AGENTS.md", { filename: "AGENTS.md" })],
    )
    expect(result).toHaveLength(1)
    expect(result[0].type).toBe("file")
  })

  test("template-side wins on collision (first occurrence preserved)", () => {
    const fromTemplate = file("file:///repo/AGENTS.md", { filename: "@AGENTS.md" })
    const fromInput = file("file:///repo/AGENTS.md", { filename: "client-name.md" })
    const result = mergeCommandParts([fromTemplate], [fromInput])
    expect(result).toEqual([fromTemplate])
  })

  test("normalizes file: URLs by ignoring searchParams so ?start/?end-annotated client refs dedup", () => {
    // TUI autocomplete appends ?start=N&end=M for line ranges; the template
    // does not. Without normalization these two strings differ literally but
    // refer to the same file.
    const result = mergeCommandParts(
      [file("file:///repo/AGENTS.md")],
      [file("file:///repo/AGENTS.md?start=10&end=20")],
    )
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ url: "file:///repo/AGENTS.md" })
  })

  test("does not normalize non-file: URLs (data:, http:, etc. compare verbatim)", () => {
    const a = file("data:text/plain;base64,YQ==")
    const b = file("data:text/plain;base64,Yg==")
    const result = mergeCommandParts([a], [b])
    expect(result).toHaveLength(2)
  })

  test("dedups AgentPart by name", () => {
    const result = mergeCommandParts([agent("review")], [agent("review")])
    expect(result).toEqual([agent("review")])
  })

  test("agent and file dedup are independent", () => {
    const result = mergeCommandParts(
      [agent("review"), file("file:///repo/AGENTS.md")],
      [agent("review"), file("file:///repo/AGENTS.md"), agent("debug"), file("file:///repo/OTHER.md")],
    )
    expect(result.map((p) => (p.type === "agent" ? `a:${p.name}` : p.type === "file" ? `f:${p.url}` : `t`))).toEqual([
      "a:review",
      "f:file:///repo/AGENTS.md",
      "a:debug",
      "f:file:///repo/OTHER.md",
    ])
  })

  test("does NOT dedup TextParts (multiple texts are legitimate)", () => {
    const result = mergeCommandParts([text("hello")], [text("hello")])
    expect(result).toHaveLength(2)
  })

  test("handles undefined inputParts", () => {
    const result = mergeCommandParts([text("hi")], undefined)
    expect(result).toEqual([text("hi")])
  })

  test("handles malformed URLs by falling back to literal string comparison", () => {
    const a = file("not a url")
    const b = file("not a url")
    const result = mergeCommandParts([a], [b])
    expect(result).toHaveLength(1)
  })

  test("dedups within templateParts alone", () => {
    const result = mergeCommandParts(
      [file("file:///repo/AGENTS.md"), file("file:///repo/AGENTS.md")],
      [],
    )
    expect(result).toHaveLength(1)
  })

  test("dedups within inputParts alone", () => {
    const result = mergeCommandParts(
      [],
      [file("file:///repo/AGENTS.md"), file("file:///repo/AGENTS.md?start=1&end=5")],
    )
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ url: "file:///repo/AGENTS.md" })
  })

  test("two client-side parts referencing the same file at different ranges silently dedup (template-first-wins applies intra-array too)", () => {
    // Pins down current behavior: ranges are merged away on collision. If a
    // future change wants to preserve distinct ranges as separate parts, it
    // will need to update this test deliberately.
    const result = mergeCommandParts(
      [],
      [file("file:///repo/AGENTS.md?start=1&end=10"), file("file:///repo/AGENTS.md?start=50&end=60")],
    )
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ url: "file:///repo/AGENTS.md?start=1&end=10" })
  })
})
