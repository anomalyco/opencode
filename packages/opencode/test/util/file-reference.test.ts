import { describe, it, expect, beforeAll, afterAll } from "bun:test"
import { FileReference } from "../../src/util/file-reference"
import { writeFile, unlink, mkdir } from "fs/promises"
import path from "path"

describe("FileReference", () => {
  const testDir = path.join(process.cwd(), "test-files")
  const testFile1 = path.join(testDir, "test1.js")
  const testFile2 = path.join(testDir, "utils", "helpers.js")

  beforeAll(async () => {
    await mkdir(testDir, { recursive: true })
    await mkdir(path.dirname(testFile2), { recursive: true })
    
    await writeFile(testFile1, `function hello() {
  return "Hello World"
}`)
    
    await writeFile(testFile2, `export function add(a, b) {
  return a + b
}`)
  })

  afterAll(async () => {
    try {
      await unlink(testFile1)
      await unlink(testFile2)
    } catch {}
  })

  describe("parse", () => {
    it("should parse single file reference", async () => {
      const text = "Review the implementation in @test-files/test1.js"
      const references = await FileReference.parse(text, process.cwd())
      
      expect(references).toHaveLength(1)
      expect(references[0].original).toBe("@test-files/test1.js")
      expect(references[0].path).toBe("test-files/test1.js")
    })

    it("should parse multiple file references", async () => {
      const text = "Compare @test-files/test1.js with @test-files/utils/helpers.js"
      const references = await FileReference.parse(text, process.cwd())
      
      expect(references).toHaveLength(2)
      expect(references[0].original).toBe("@test-files/test1.js")
      expect(references[1].original).toBe("@test-files/utils/helpers.js")
    })

    it("should handle file references with extensions", async () => {
      const text = "Check @src/utils/helpers.ts and @config.json"
      const references = await FileReference.parse(text, process.cwd())
      
      expect(references).toHaveLength(2)
      expect(references[0].path).toBe("src/utils/helpers.ts")
      expect(references[1].path).toBe("config.json")
    })

    it("should not parse @ symbols that are not file references", async () => {
      const text = "Email me @john.doe or check @username on social media"
      const references = await FileReference.parse(text, process.cwd())
      
      expect(references).toHaveLength(2)
      expect(references[0].path).toBe("john.doe")
      expect(references[1].path).toBe("username")
    })
  })

  describe("resolve", () => {
    it("should resolve existing file references", async () => {
      const text = "Review the implementation in @test-files/test1.js"
      const result = await FileReference.resolve(text, process.cwd())
      
      expect(result.references).toHaveLength(1)
      expect(result.references[0].exists).toBe(true)
      expect(result.processedText).toContain("function hello()")
      expect(result.processedText).toContain("```")
    })

    it("should handle non-existing files", async () => {
      const text = "Check @non-existing-file.js"
      const result = await FileReference.resolve(text, process.cwd())
      
      expect(result.references).toHaveLength(1)
      expect(result.references[0].exists).toBe(false)
      expect(result.processedText).toContain("(file not found)")
    })

    it("should resolve multiple file references", async () => {
      const text = "Compare @test-files/test1.js with @test-files/utils/helpers.js"
      const result = await FileReference.resolve(text, process.cwd())
      
      expect(result.references).toHaveLength(2)
      expect(result.references[0].exists).toBe(true)
      expect(result.references[1].exists).toBe(true)
      expect(result.processedText).toContain("function hello()")
      expect(result.processedText).toContain("export function add")
    })
  })
})