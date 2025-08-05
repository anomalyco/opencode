import { describe, expect, test } from "bun:test"
import { Harmony } from "../../src/session/harmony"

describe("Harmony Parser", () => {
  test("parses basic harmony format", () => {
    const input = `<|channel|>analysis<|message|>Testing analysis content<|end|>`
    const blocks = Harmony.parseHarmonyResponse(input)
    
    expect(blocks).toHaveLength(1)
    expect(blocks[0].channel).toBe("analysis")
    expect(blocks[0].content).toBe("Testing analysis content")
    expect(blocks[0].isComplete).toBe(true)
  })

  test("handles streaming incomplete blocks", () => {
    const partial = `<|channel|>analysis<|message|>Partial content without end`
    const blocks = Harmony.parseHarmonyResponse(partial)
    
    expect(blocks).toHaveLength(1)
    expect(blocks[0].channel).toBe("analysis")
    expect(blocks[0].content).toBe("Partial content without end")
    expect(blocks[0].isComplete).toBe(false)
  })

  test("parses multiple channels", () => {
    const input = `<|channel|>analysis<|message|>Analysis text<|end|>
<|channel|>final<|message|>Final response<|end|>`
    const blocks = Harmony.parseHarmonyResponse(input)
    
    expect(blocks).toHaveLength(2)
    expect(blocks[0].channel).toBe("analysis")
    expect(blocks[0].content).toBe("Analysis text")
    expect(blocks[0].isComplete).toBe(true)
    expect(blocks[1].channel).toBe("final")
    expect(blocks[1].content).toBe("Final response")
    expect(blocks[1].isComplete).toBe(true)
  })

  test("handles mixed complete and incomplete blocks", () => {
    const input = `<|channel|>analysis<|message|>Complete analysis<|end|>
<|channel|>commentary<|message|>Incomplete commentary`
    const blocks = Harmony.parseHarmonyResponse(input)
    
    expect(blocks).toHaveLength(2)
    expect(blocks[0].isComplete).toBe(true)
    expect(blocks[1].isComplete).toBe(false)
  })

  test("detects harmony format correctly", () => {
    expect(Harmony.isHarmonyFormat("<|channel|>test<|message|>content")).toBe(true)
    expect(Harmony.isHarmonyFormat("regular text content")).toBe(false)
    expect(Harmony.isHarmonyFormat("<|channel|>analysis<|message|>test<|end|>")).toBe(true)
    expect(Harmony.isHarmonyFormat("some text with <|channel|>embedded")).toBe(true)
  })

  test("converts blocks to message parts", () => {
    const blocks = [
      { channel: "analysis", content: "Analysis content", isComplete: true },
      { channel: "final", content: "Final content", isComplete: true },
      { channel: "unknown", content: "Unknown content", isComplete: true },
    ]
    
    const parts = Harmony.convertToMessageParts(blocks)
    
    expect(parts).toHaveLength(3)
    expect(parts[0].type).toBe("harmony-channel")
    
    // Type assertion to access harmony-specific properties
    const harmonyPart0 = parts[0] as any
    const harmonyPart1 = parts[1] as any  
    const harmonyPart2 = parts[2] as any
    
    expect(harmonyPart0.channel).toBe("analysis")
    expect(harmonyPart0.text).toBe("Analysis content")
    expect(harmonyPart1.channel).toBe("final")
    expect(harmonyPart2.channel).toBe("analysis") // unknown maps to analysis
  })

  test("filters incomplete blocks when converting", () => {
    const blocks = [
      { channel: "analysis", content: "Complete", isComplete: true },
      { channel: "final", content: "Incomplete", isComplete: false },
      { channel: "commentary", content: "", isComplete: true }, // empty content
    ]
    
    const parts = Harmony.convertToMessageParts(blocks)
    
    expect(parts).toHaveLength(1) // only complete, non-empty block
    const harmonyPart = parts[0] as any
    expect(harmonyPart.channel).toBe("analysis")
  })

  test("extracts plain text from harmony format", () => {
    const harmonyText = `<|channel|>analysis<|message|>Some analysis<|end|>
<|channel|>final<|message|>Final answer<|end|>`
    
    const plainText = Harmony.extractPlainText(harmonyText)
    expect(plainText).toBe("Final answer")
  })

  test("extracts plain text from non-harmony format", () => {
    const regularText = "This is just regular text"
    const plainText = Harmony.extractPlainText(regularText)
    expect(plainText).toBe(regularText)
  })

  test("handles complex harmony content with newlines", () => {
    const input = `<|channel|>analysis<|message|>This is a multi-line
analysis with various content.

It includes paragraphs.<|end|>
<|channel|>final<|message|>Final response here<|end|>`
    
    const blocks = Harmony.parseHarmonyResponse(input)
    
    expect(blocks).toHaveLength(2)
    expect(blocks[0].content).toContain("multi-line")
    expect(blocks[0].content).toContain("paragraphs")
    expect(blocks[1].content).toBe("Final response here")
  })

  test("handles empty channels gracefully", () => {
    const input = `<|channel|>analysis<|message|><|end|>`
    const blocks = Harmony.parseHarmonyResponse(input)
    
    expect(blocks).toHaveLength(1)
    expect(blocks[0].content).toBe("")
    expect(blocks[0].isComplete).toBe(true)
  })

  test("handles whitespace in channels", () => {
    const input = `<|channel|> analysis <|message|> content with spaces <|end|>`
    const blocks = Harmony.parseHarmonyResponse(input)
    
    expect(blocks).toHaveLength(1)
    expect(blocks[0].channel).toBe("analysis") // trimmed
    expect(blocks[0].content).toBe("content with spaces") // trimmed
  })

  test("handles invalid input gracefully", () => {
    expect(Harmony.parseHarmonyResponse("")).toEqual([])
    expect(Harmony.parseHarmonyResponse(null as any)).toEqual([])
    expect(Harmony.parseHarmonyResponse(undefined as any)).toEqual([])
    expect(Harmony.parseHarmonyResponse(123 as any)).toEqual([])
  })

  test("handles malformed harmony tokens", () => {
    const malformed = `<|channel|><|message|>missing channel name<|end|>`
    const blocks = Harmony.parseHarmonyResponse(malformed)
    // Should handle gracefully, possibly with empty results
    expect(Array.isArray(blocks)).toBe(true)
  })

  test("extractPlainText handles edge cases", () => {
    expect(Harmony.extractPlainText("")).toBe("")
    expect(Harmony.extractPlainText(null as any)).toBe("")
    expect(Harmony.extractPlainText(undefined as any)).toBe("")
    
    // Test with malformed harmony that has no complete blocks
    const incomplete = `<|channel|>analysis<|message|>never finished`
    expect(Harmony.extractPlainText(incomplete)).toBe(incomplete) // fallback to original
  })

  test("extractPlainText fallback behavior", () => {
    // Test with harmony format but no final channel
    const noFinal = `<|channel|>analysis<|message|>Only analysis<|end|>`
    const result = Harmony.extractPlainText(noFinal)
    expect(result).toBe("Only analysis")
    
    // Test with empty parsing result should return original
    const unparseable = `<|channel|><|message|><|end|>` // empty channel name
    const fallback = Harmony.extractPlainText(unparseable)
    expect(typeof fallback).toBe("string")
  })
})