import { describe, test, expect } from 'bun:test'
import { replace } from '../../src/tool/edit'

describe("edit tool whitespace handling", () => {
  test("detects whitespace-only strings", async () => {
    const content = "line1\n   \nline2"
    const oldString = "   " // Three spaces
    const newString = "replaced"
    
    const result = replace(content, oldString, newString, false)
    expect(result).toContain("replaced")
    expect(result).not.toContain("   ")
  })
  
  test("distinguishes between empty and whitespace-only", async () => {
    const content = "line1\n\nline2\n   \nline3"
    
    // Empty line
    const result1 = replace(content, "\n\n", "\nREPLACED\n", false)
    expect(result1).toContain("REPLACED")
    
    // Whitespace-only line
    const result2 = replace(content, "   ", "SPACES", false)
    expect(result2).toContain("SPACES")
  })
  
  test("handles mixed whitespace (tabs and spaces)", async () => {
    const content = "line1\n\t  \t\nline2"
    const oldString = "\t  \t"
    const newString = "MIXED"
    
    const result = replace(content, oldString, newString, false)
    expect(result).toContain("MIXED")
  })
})

describe("edit tool emoji handling", () => {
  test("matches emoji characters", async () => {
    const content = "Hello 😀 World"
    const oldString = "😀"
    const newString = "🎉"
    
    const result = replace(content, oldString, newString, false)
    expect(result).toContain("🎉")
    expect(result).not.toContain("😀")
  })
  
  test("handles emoji in multi-line content", async () => {
    const content = "Line 1\nSmile 😀 emoji\nLine 3"
    const oldString = "Smile 😀 emoji"
    const newString = "Party 🎉 time"
    
    const result = replace(content, oldString, newString, false)
    expect(result).toContain("Party 🎉 time")
  })
})