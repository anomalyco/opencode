import { describe, expect, test } from "bun:test"
import type { Prompt } from "@/context/prompt"
import { merge, paint, value } from "./expand"

describe("prompt-input expand", () => {
  test("value joins inline prompt content and skips images", () => {
    const prompt: Prompt = [
      { type: "text", content: "fix ", start: 0, end: 4 },
      { type: "file", path: "src/a.ts", content: "@src/a.ts", start: 4, end: 13 },
      { type: "text", content: " with ", start: 13, end: 19 },
      { type: "agent", name: "reviewer", content: "@reviewer", start: 19, end: 28 },
      { type: "image", id: "img_1", filename: "a.png", mime: "image/png", dataUrl: "data:image/png;base64,AAA" },
    ]

    expect(value(prompt)).toBe("fix @src/a.ts with @reviewer")
  })

  test("merge preserves inline attachments even when order changes", () => {
    const prev: Prompt = [
      { type: "text", content: "look at ", start: 0, end: 8 },
      { type: "file", path: "src/a.ts", content: "@src/a.ts", start: 8, end: 17 },
      { type: "text", content: " with ", start: 17, end: 23 },
      { type: "agent", name: "reviewer", content: "@reviewer", start: 23, end: 32 },
    ]

    const next = merge("ask @reviewer about @src/a.ts first", prev)
    expect(next).toEqual([
      { type: "text", content: "ask ", start: 0, end: 4 },
      { type: "agent", name: "reviewer", content: "@reviewer", start: 4, end: 13 },
      { type: "text", content: " about ", start: 13, end: 20 },
      { type: "file", path: "src/a.ts", content: "@src/a.ts", start: 20, end: 29, selection: undefined },
      { type: "text", content: " first", start: 29, end: 35 },
    ])
  })

  test("merge keeps image attachments when text is cleared", () => {
    const prev: Prompt = [
      { type: "text", content: "hello", start: 0, end: 5 },
      { type: "image", id: "img_1", filename: "a.png", mime: "image/png", dataUrl: "data:image/png;base64,AAA" },
    ]

    expect(merge("", prev)).toEqual([
      { type: "text", content: "", start: 0, end: 0 },
      { type: "image", id: "img_1", filename: "a.png", mime: "image/png", dataUrl: "data:image/png;base64,AAA" },
    ])
  })

  test("paint escapes html while highlighting markdown markers", () => {
    const html = paint("# title\n> `code` <tag>")
    expect(html).toContain("var(--syntax-type)")
    expect(html).toContain("var(--syntax-comment)")
    expect(html).toContain("var(--syntax-string)")
    expect(html).toContain("&lt;tag&gt;")
  })
})
