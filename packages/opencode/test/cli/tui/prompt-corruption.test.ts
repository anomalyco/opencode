import { describe, expect, test, beforeAll, afterAll } from "bun:test"
import path from "path"
import fs from "fs/promises"
import os from "os"

// Test the validation logic used in history.tsx and stash.tsx
describe("prompt history corruption validation", () => {
  test("validates history entries correctly", () => {
    const entries = [
      { input: "valid input 1", parts: [] },
      { input: { type: "text", content: "corrupted" }, parts: [] },
      { input: "valid input 2", parts: [] },
      { input: ["array"], parts: [] },
      { input: 12345, parts: [] },
      { input: "valid input 3", parts: "not an array" },
      null,
      "just a string",
      { parts: [] }, // missing input
      { input: null, parts: [] },
    ]

    // This is the fixed validation logic from history.tsx
    const isValidPromptInfo = (line: any): boolean => {
      return line !== null && typeof line === "object" && typeof line.input === "string" && Array.isArray(line.parts)
    }

    const validEntries = entries.filter(isValidPromptInfo)

    // Only 2 entries should be valid (valid input 1 and 2)
    expect(validEntries.length).toBe(2)
    expect((validEntries[0] as any).input).toBe("valid input 1")
    expect((validEntries[1] as any).input).toBe("valid input 2")
  })

  test("validates stash entries correctly", () => {
    const entries = [
      { input: "valid stash 1", parts: [], timestamp: 12345 },
      { input: { corrupted: true }, parts: [], timestamp: 12345 },
      { input: "valid stash 2", parts: [], timestamp: 12345 },
      { input: null, parts: [], timestamp: 12345 },
      { input: "missing timestamp", parts: [] },
      { input: "wrong timestamp type", parts: [], timestamp: "not a number" },
    ]

    // This is the fixed validation logic from stash.tsx
    const isValidStashEntry = (line: any): boolean => {
      return (
        line !== null &&
        typeof line === "object" &&
        typeof line.input === "string" &&
        Array.isArray(line.parts) &&
        typeof line.timestamp === "number"
      )
    }

    const validEntries = entries.filter(isValidStashEntry)

    // Only 2 entries should be valid
    expect(validEntries.length).toBe(2)
    expect(validEntries[0].input).toBe("valid stash 1")
    expect(validEntries[1].input).toBe("valid stash 2")
  })

  test("handles edge cases", () => {
    const edgeCases = [
      { input: "", parts: [] }, // empty string input
      { input: "normal", parts: [], mode: "shell" }, // with optional mode
      { input: "with extra", parts: [], extraField: "ignored" }, // extra fields are ok
    ]

    const isValidPromptInfo = (line: any): boolean => {
      return line !== null && typeof line === "object" && typeof line.input === "string" && Array.isArray(line.parts)
    }

    const validEntries = edgeCases.filter(isValidPromptInfo)

    // All should be valid
    expect(validEntries.length).toBe(3)
    expect(validEntries[0].input).toBe("")
    expect(validEntries[1].input).toBe("normal")
    expect(validEntries[2].input).toBe("with extra")
  })
})

// Integration test with actual file operations
describe("prompt history file corruption handling", () => {
  let tempDir: string

  beforeAll(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-corruption-test-"))
  })

  afterAll(async () => {
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  test("filters corrupted entries when reading history file", async () => {
    const historyFile = path.join(tempDir, "prompt-history.jsonl")

    // Simulate corrupted history file
    const corruptedContent = `{"input": "valid entry", "parts": []}
{"input": {"corrupted": true}, "parts": []}
{"input": "another valid", "parts": []}
null
{"input": 12345, "parts": []}
`
    await fs.writeFile(historyFile, corruptedContent)

    // Read and parse like history.tsx does
    const text = await fs.readFile(historyFile, "utf-8")
    const lines = text
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line)
        } catch {
          return null
        }
      })
      .filter((line): line is { input: string; parts: any[] } => {
        // This is the fixed validation logic
        return line !== null && typeof line === "object" && typeof line.input === "string" && Array.isArray(line.parts)
      })

    // Should only have the 2 valid entries
    expect(lines.length).toBe(2)
    expect(lines[0].input).toBe("valid entry")
    expect(lines[1].input).toBe("another valid")
  })

  test("self-heals corrupted stash file", async () => {
    const stashFile = path.join(tempDir, "prompt-stash.jsonl")

    const corruptedContent = `{"input": "valid stash", "parts": [], "timestamp": 12345}
{"input": {"bad": "data"}, "parts": [], "timestamp": 12345}
{"input": "also valid", "parts": [], "timestamp": 67890}
`
    await fs.writeFile(stashFile, corruptedContent)

    // Read and parse like stash.tsx does
    const text = await fs.readFile(stashFile, "utf-8")
    const lines = text
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line)
        } catch {
          return null
        }
      })
      .filter((line): line is { input: string; parts: any[]; timestamp: number } => {
        // This is the fixed validation logic
        return (
          line !== null &&
          typeof line === "object" &&
          typeof line.input === "string" &&
          Array.isArray(line.parts) &&
          typeof line.timestamp === "number"
        )
      })

    // Should only have the 2 valid entries
    expect(lines.length).toBe(2)
    expect(lines[0].input).toBe("valid stash")
    expect(lines[1].input).toBe("also valid")

    // Simulate self-healing by rewriting file with only valid entries
    const cleanedContent = lines.map((line) => JSON.stringify(line)).join("\n") + "\n"
    await fs.writeFile(stashFile, cleanedContent)

    // Verify cleaned file
    const cleanedText = await fs.readFile(stashFile, "utf-8")
    const cleanedLines = cleanedText.trim().split("\n")
    expect(cleanedLines.length).toBe(2)
  })
})
