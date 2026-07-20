import { describe, expect, test } from "bun:test"
import type { Prompt } from "@opencode-ai/schema"
import { projectedPromptInput } from "../../src/prompt/codec"

describe("prompt codec", () => {
  test("converts projected URI and inline attachments without mutation", () => {
    const input = {
      text: "Review @note.ts and image.png with @scan",
      files: [
        {
          data: "",
          mime: "text/plain",
          source: { type: "uri", uri: "file:///tmp/note.ts" },
          name: "note.ts",
          mention: { start: 7, end: 15, text: "@note.ts" },
        },
        {
          data: "YWJj",
          mime: "image/png",
          source: { type: "inline" },
          name: "image.png",
          description: "screenshot",
        },
      ],
      agents: [{ name: "scan", mention: { start: 35, end: 40, text: "@scan" } }],
    } satisfies Prompt
    const before = structuredClone(input)

    const output = projectedPromptInput(input)

    expect(output).toEqual({
      text: input.text,
      files: [
        {
          uri: "file:///tmp/note.ts",
          name: "note.ts",
          description: undefined,
          mention: { start: 7, end: 15, text: "@note.ts" },
        },
        {
          uri: "data:image/png;base64,YWJj",
          name: "image.png",
          description: "screenshot",
          mention: undefined,
        },
      ],
      agents: [{ name: "scan", mention: { start: 35, end: 40, text: "@scan" } }],
    })
    expect(input).toEqual(before)
    expect(output.files?.[0]?.mention).not.toBe(input.files[0].mention)
    expect(output.agents?.[0]?.mention).not.toBe(input.agents[0].mention)
  })

  test("retains empty attachment keys for editable prompt replacement", () => {
    expect(projectedPromptInput({ text: "plain" })).toEqual({
      text: "plain",
      files: undefined,
      agents: undefined,
    })
  })
})
