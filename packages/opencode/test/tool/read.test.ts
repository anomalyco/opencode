import { describe, expect, test, afterEach, beforeEach } from "bun:test"
import { App } from "../../src/app/app"
import { ReadTool } from "../../src/tool/read"
import { TokenEstimator } from "../../src/util/token"
import path from "path"
import fs from "fs/promises"
import { tmpdir } from "os"

const ctx = {
  sessionID: "test",
  messageID: "",
  toolCallID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  metadata: async () => {},
  extra: { bypassCwdCheck: true },
}

let tempDir: string
let tempFiles: string[] = []

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(tmpdir(), "read-test-"))
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

describe("ReadTool", () => {
  test("should read small file successfully", async () => {
    const content = "Hello, world!\nThis is a test file.\n"
    const filepath = await createTempFile("test.txt", content)

    await App.provide({ cwd: tempDir }, async () => {
      const result = await ReadTool.init().then((tool) => tool.execute({ filePath: filepath }, ctx))

      expect(result.output).toContain("Hello, world!")
      expect(result.output).toContain("This is a test file.")
      expect(result.title).toBe(path.relative(tempDir, filepath))
    })
  })

  test("should handle file with offset and limit", async () => {
    const lines = Array.from({ length: 100 }, (_, i) => `Line ${i + 1}`)
    const content = lines.join("\\n")
    const filepath = await createTempFile("large.txt", content)

    await App.provide({ cwd: tempDir }, async () => {
      const result = await ReadTool.init().then((tool) =>
        tool.execute({ filePath: filepath, offset: 10, limit: 5 }, ctx),
      )

      expect(result.output).toContain("Line 11")
      expect(result.output).toContain("Line 15")
      expect(result.output).not.toContain("Line 10")
      expect(result.output).not.toContain("Line 16")
    })
  })

  test("should reject very large files without offset/limit", async () => {
    // Create a file that exceeds MAX_FILE_TOKENS (150,000)
    const largeContent = "x".repeat(500_000) // ~500k chars should exceed 150k tokens
    const filepath = await createTempFile("huge.txt", largeContent)

    await App.provide({ cwd: tempDir }, async () => {
      const promise = ReadTool.init().then((tool) => tool.execute({ filePath: filepath }, ctx))
      expect(promise).rejects.toThrow("File is too large")
    })
  })

  test("should handle large files with offset/limit parameters", async () => {
    // Create a large file but read only a small portion
    const lines = Array.from({ length: 10000 }, (_, i) => `Line number ${i + 1}`)
    const largeContent = lines.join("\\n")
    const filepath = await createTempFile("verylarge.txt", largeContent)

    await App.provide({ cwd: tempDir }, async () => {
      const result = await ReadTool.init().then((tool) =>
        tool.execute({ filePath: filepath, offset: 5000, limit: 10 }, ctx),
      )

      expect(result.output).toContain("Line number 5001")
      expect(result.output).toContain("Line number 5010")
      expect(result.output).not.toContain("Line number 4999")
      expect(result.output).not.toContain("Line number 5012")
    })
  })

  test("should reject non-existent files with helpful suggestions", async () => {
    await createTempFile("actual_file.txt", "content")
    const nonExistentPath = path.join(tempDir, "missing_file.txt")

    await App.provide({ cwd: tempDir }, async () => {
      const promise = ReadTool.init().then((tool) => tool.execute({ filePath: nonExistentPath }, ctx))
      expect(promise).rejects.toThrow("Did you mean one of these?")
    })
  })

  test("should reject binary files", async () => {
    // Create a binary-like file (with null bytes)
    const binaryContent = Buffer.from([0, 1, 2, 3, 4, 5, 0, 0, 0])
    const filepath = path.join(tempDir, "binary.bin")
    await fs.writeFile(filepath, binaryContent)
    tempFiles.push(filepath)

    await App.provide({ cwd: tempDir }, async () => {
      const promise = ReadTool.init().then((tool) => tool.execute({ filePath: filepath }, ctx))
      expect(promise).rejects.toThrow("Cannot read binary file")
    })
  })

  test("should reject image files", async () => {
    const filepath = await createTempFile("image.png", "fake png content")

    await App.provide({ cwd: tempDir }, async () => {
      const promise = ReadTool.init().then((tool) => tool.execute({ filePath: filepath }, ctx))
      expect(promise).rejects.toThrow("This is an image file of type: PNG")
    })
  })

  test("should truncate very long lines", async () => {
    const longLine = "x".repeat(3000) // Exceeds MAX_LINE_LENGTH (2000)
    const filepath = await createTempFile("longline.txt", longLine)

    await App.provide({ cwd: tempDir }, async () => {
      const result = await ReadTool.init().then((tool) => tool.execute({ filePath: filepath }, ctx))

      expect(result.output).toContain("x".repeat(2000) + "...")
      expect(result.output).not.toContain("x".repeat(2001))
    })
  })

  test("should enforce working directory restrictions by default", async () => {
    const filepath = await createTempFile("restricted.txt", "secret content")

    // Try to read from different working directory without bypass
    await App.provide({ cwd: "/" }, async () => {
      const promise = ReadTool.init().then((tool) => tool.execute({ filePath: filepath }, { ...ctx, extra: {} }))
      expect(promise).rejects.toThrow("not in the current working directory")
    })
  })

  test("should bypass working directory restrictions when requested", async () => {
    const filepath = await createTempFile("allowed.txt", "accessible content")

    // Should work with bypassCwdCheck
    await App.provide({ cwd: "/" }, async () => {
      const result = await ReadTool.init().then((tool) => tool.execute({ filePath: filepath }, ctx))

      expect(result.output).toContain("accessible content")
    })
  })
})

describe("TokenEstimator", () => {
  test("should estimate tokens for regular text", () => {
    const text = "Hello world! This is a test."
    const estimate = TokenEstimator.estimateTokens(text)

    // Should be reasonable estimate (text is ~30 chars, expect ~10 tokens)
    expect(estimate).toBeGreaterThan(5)
    expect(estimate).toBeLessThan(20)
  })

  test("should estimate tokens for code-like content", () => {
    const code = `
function example() {
  const x = 5;
  return x * 2;
}
`
    const estimate = TokenEstimator.estimateTokens(code)

    // Code should have more tokens due to symbols and structure
    expect(estimate).toBeGreaterThan(10)
    expect(estimate).toBeLessThan(50)
  })

  test("should identify content within token limits", () => {
    const shortText = "Hello world"
    const longText = "x".repeat(100000)

    expect(TokenEstimator.isWithinLimit(shortText, 1000)).toBe(true)
    expect(TokenEstimator.isWithinLimit(longText, 1000)).toBe(false)
  })

  test("should truncate content to token limits", () => {
    const longText = "word ".repeat(1000) // ~5000 chars
    const truncated = TokenEstimator.truncateToTokenLimit(longText, 100)

    expect(truncated.length).toBeLessThan(longText.length)
    expect(truncated).toContain("[Content truncated due to size limits]")
    expect(TokenEstimator.estimateTokens(truncated)).toBeLessThanOrEqual(100)
  })

  test("should not truncate content already within limits", () => {
    const shortText = "Hello world"
    const result = TokenEstimator.truncateToTokenLimit(shortText, 1000)

    expect(result).toBe(shortText)
  })

  test("should handle base64 encoding estimates", () => {
    const content = "Hello world"
    const base64Estimate = TokenEstimator.estimateFileTokens(content, "base64")
    const utf8Estimate = TokenEstimator.estimateFileTokens(content, "utf-8")

    expect(base64Estimate).toBeGreaterThan(utf8Estimate)
  })
})
