import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { FileSystem } from "../src/filesystem"
import { PromptInput } from "../src/prompt-input"

describe("schema compatibility", () => {
  test("moved class schemas remain constructible", () => {
    const input = new FileSystem.FindInput({ query: "src" })
    expect(input).toBeInstanceOf(FileSystem.FindInput)
    expect(input.query).toBe("src")
  })

  test("prompt files remain compatible when clients omit MIME", () => {
    const prompt = Schema.decodeUnknownSync(PromptInput.Prompt)({
      text: "inspect",
      files: [{ uri: "file:///repo/notes.txt", name: "notes.txt" }],
    })

    expect(prompt.files).toEqual([{ uri: "file:///repo/notes.txt", name: "notes.txt" }])
  })
})
