import { describe, expect, test } from "bun:test"
import type { Prompt } from "./state"
import { clonePrompt, promptLength } from "./prompt-parts"

describe("composer prompt parts", () => {
  test("clones parts shallowly and copies file selections", () => {
    const original: Prompt = [
      { type: "text", content: "one", start: 0, end: 3 },
      {
        type: "file",
        path: "src/a.ts",
        content: "@src/a.ts",
        start: 3,
        end: 12,
        selection: { startLine: 1, startChar: 1, endLine: 2, endChar: 1 },
      },
      { type: "image", id: "1", filename: "img.png", mime: "image/png", blob: { id: "blob", url: "blob:test" } },
    ]

    const copy = clonePrompt(original)

    expect(copy).not.toBe(original)
    expect(copy[0]).not.toBe(original[0])
    expect(copy[1]).not.toBe(original[1])
    expect(copy[2]).not.toBe(original[2])
    if (copy[1]?.type !== "file" || original[1]?.type !== "file") throw new Error("expected file parts")
    if (copy[2]?.type !== "image" || original[2]?.type !== "image") throw new Error("expected image parts")
    expect(copy[2].blob).toBe(original[2].blob)
    expect(copy[1].selection).not.toBe(original[1].selection)
    copy[1].selection!.startLine = 9
    expect(original[1].selection?.startLine).toBe(1)
  })

  test("counts the content of text and mention parts", () => {
    const prompt: Prompt = [
      { type: "text", content: "one", start: 0, end: 3 },
      { type: "agent", content: "@build", start: 3, end: 9, name: "build" },
      { type: "image", id: "1", filename: "img.png", mime: "image/png", blob: { id: "blob", url: "blob:test" } },
    ]

    expect(promptLength(prompt)).toBe(9)
  })
})
