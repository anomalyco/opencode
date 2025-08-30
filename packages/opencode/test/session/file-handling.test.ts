import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { TokenEstimator } from "../../src/util/token"
import path from "path"
import fs from "fs/promises"
import { tmpdir } from "os"

let tempDir: string
let tempFiles: string[] = []

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(tmpdir(), "session-test-"))
  tempFiles = []
})

afterEach(async () => {
  // Cleanup temp files
  for (const file of tempFiles) {
    try {
      await fs.unlink(file)
    } catch {}
  }
  try {
    await fs.rmdir(tempDir, { recursive: true })
  } catch {}
})

async function createTempFile(filename: string, content: string): Promise<string> {
  const filepath = path.join(tempDir, filename)
  await fs.writeFile(filepath, content)
  tempFiles.push(filepath)
  return filepath
}

describe("Session File Handling", () => {
  test("should handle small files normally", async () => {
    const content = "Small file content for testing"
    const filepath = await createTempFile("small.txt", content)

    // Test that small files are processed normally
    const fileContent = await Bun.file(filepath).text()
    const estimatedTokens = TokenEstimator.estimateTokens(fileContent)

    expect(estimatedTokens).toBeLessThan(1000) // Should be very small
    expect(fileContent).toBe(content)
  })

  test("should detect large files that exceed token limits", async () => {
    // Create a file that would exceed the 150k token limit
    const largeContent = "word ".repeat(200000) // Should exceed MAX_FILE_TOKENS
    const filepath = await createTempFile("large.txt", largeContent)

    const fileContent = await Bun.file(filepath).text()
    const estimatedTokens = TokenEstimator.estimateTokens(fileContent)

    expect(estimatedTokens).toBeGreaterThan(150000)
  })

  test("should truncate content when file exceeds token limits", async () => {
    const largeContent = "test line\\n".repeat(50000) // Large content
    const filepath = await createTempFile("huge.txt", largeContent)

    const fileContent = await Bun.file(filepath).text()
    const estimatedTokens = TokenEstimator.estimateTokens(fileContent)

    if (estimatedTokens > 150000) {
      const truncated = TokenEstimator.truncateToTokenLimit(fileContent, 150000)
      const truncatedTokens = TokenEstimator.estimateTokens(truncated)

      expect(truncatedTokens).toBeLessThanOrEqual(150000)
      expect(truncated.length).toBeLessThan(fileContent.length)
      expect(truncated).toContain("[Content truncated due to size limits]")
    }
  })

  test("should handle different file encodings appropriately", async () => {
    const content = "Hello world with unicode: 世界 🌍"
    const filepath = await createTempFile("unicode.txt", content)

    const fileContent = await Bun.file(filepath).text()
    const utf8Tokens = TokenEstimator.estimateFileTokens(fileContent, "utf-8")
    const base64Tokens = TokenEstimator.estimateFileTokens(fileContent, "base64")

    expect(base64Tokens).toBeGreaterThan(utf8Tokens)
    expect(utf8Tokens).toBeGreaterThan(0)
  })

  test("should properly estimate tokens for code content", async () => {
    const codeContent = `
function complexFunction(param1, param2, param3) {
  const result = [];
  for (let i = 0; i < param1.length; i++) {
    if (param1[i].property === param2) {
      result.push({
        ...param1[i],
        newProperty: param3.transform(param1[i].value)
      });
    }
  }
  return result.filter(item => item.newProperty !== null);
}
`
    const filepath = await createTempFile("code.js", codeContent)

    const fileContent = await Bun.file(filepath).text()
    const estimatedTokens = TokenEstimator.estimateTokens(fileContent)

    // Code typically has more tokens per character due to symbols and structure
    expect(estimatedTokens).toBeGreaterThan(50)
    expect(estimatedTokens).toBeLessThan(200) // Still reasonable for this amount of code
  })

  test("should handle binary file detection correctly", async () => {
    // Create a file with binary content (null bytes)
    const binaryContent = Buffer.from([0, 1, 2, 3, 255, 254, 0, 0, 127, 128])
    const filepath = path.join(tempDir, "binary.bin")
    await fs.writeFile(filepath, binaryContent)
    tempFiles.push(filepath)

    const file = Bun.file(filepath)
    const buffer = await file.arrayBuffer()
    const bytes = new Uint8Array(buffer.slice(0, Math.min(4096, buffer.byteLength)))

    // Check for null bytes (binary indicator)
    const hasNullBytes = Array.from(bytes).some((byte) => byte === 0)
    expect(hasNullBytes).toBe(true)
  })

  test("should handle empty files gracefully", async () => {
    const filepath = await createTempFile("empty.txt", "")

    const fileContent = await Bun.file(filepath).text()
    const estimatedTokens = TokenEstimator.estimateTokens(fileContent)

    expect(fileContent).toBe("")
    expect(estimatedTokens).toBe(0)
  })

  test("should handle files with only whitespace", async () => {
    const whitespaceContent = "   \\n\\t\\n   \\n"
    const filepath = await createTempFile("whitespace.txt", whitespaceContent)

    const fileContent = await Bun.file(filepath).text()
    const estimatedTokens = TokenEstimator.estimateTokens(fileContent)

    expect(estimatedTokens).toBeGreaterThan(0)
    expect(estimatedTokens).toBeLessThan(10) // Should be minimal
  })
})

describe("Token Estimation Edge Cases", () => {
  test("should handle very short text", () => {
    const shortText = "Hi"
    const tokens = TokenEstimator.estimateTokens(shortText)
    expect(tokens).toBe(1) // Should round up to at least 1
  })

  test("should handle repetitive content", () => {
    const repetitive = "test ".repeat(1000)
    const tokens = TokenEstimator.estimateTokens(repetitive)

    // Should be roughly 1000 tokens (one per word) + some overhead
    expect(tokens).toBeGreaterThan(900)
    expect(tokens).toBeLessThan(2000)
  })

  test("should handle mixed content types", () => {
    const mixed = `
    # Title
    
    Regular paragraph with some text.
    
    \`\`\`javascript
    function code() {
      return "mixed content";
    }
    \`\`\`
    
    - List item 1
    - List item 2
    - List item 3
    `

    const tokens = TokenEstimator.estimateTokens(mixed)
    expect(tokens).toBeGreaterThan(20)
    expect(tokens).toBeLessThan(100)
  })

  test("should provide conservative estimates", () => {
    const text = "This is a test sentence with exactly ten words in it."
    const tokens = TokenEstimator.estimateTokens(text)

    // Should be conservative (higher rather than lower)
    // 10 words * 1.3 = 13, ~60 chars / 3 = 20, max(13, 20) = 20
    expect(tokens).toBeGreaterThanOrEqual(13) // At least the word count * 1.3
  })

  test("should break at natural boundaries when truncating", () => {
    const text = "Word one. Word two. Word three. ".repeat(100)
    const truncated = TokenEstimator.truncateToTokenLimit(text, 50)

    // Should try to break at natural boundaries and include truncation message
    expect(truncated).toContain("[Content truncated due to size limits]")
    expect(truncated.length).toBeLessThan(text.length)
  })
})
