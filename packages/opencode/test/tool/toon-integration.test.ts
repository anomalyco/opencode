import { describe, expect, test, beforeAll, afterAll } from "bun:test"
import { GrepTool } from "@/tool/grep"
import { GlobTool } from "@/tool/glob"
import { ListTool } from "@/tool/ls"
import { Config } from "@/config/config"
import { Instance } from "@/project/instance"
import os from "os"
import path from "path"
import fs from "fs"

const ctx = {
  sessionID: "test",
  messageID: "",
  toolCallID: "",
  agent: "test",
  abort: AbortSignal.any([]),
  metadata: () => {},
}

const grep = await GrepTool.init()
const glob = await GlobTool.init()
const list = await ListTool.init()

describe("TOON integration in tools", () => {
  let testDir: string

  beforeAll(async () => {
    // Create temporary test directory
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-toon-test-"))

    // Create test files
    fs.writeFileSync(path.join(testDir, "test1.ts"), "const foo = 'bar'\nconst baz = 'qux'\n")
    fs.writeFileSync(path.join(testDir, "test2.ts"), "function test() {\n  return foo\n}\n")
    fs.mkdirSync(path.join(testDir, "subdir"))
    fs.writeFileSync(path.join(testDir, "subdir", "nested.ts"), "const nested = true\n")
  })

  afterAll(() => {
    // Cleanup test directory
    if (testDir) {
      fs.rmSync(testDir, { recursive: true, force: true })
    }
  })

  describe("GrepTool", () => {
    test("outputs plain text when TOON is disabled", async () => {
      await Instance.provide({
        directory: testDir,
        fn: async () => {
          const originalGet = Config.get
          Config.get = async () => ({ ai: { useToonEncoding: false } }) as any

          const result = await grep.execute({ pattern: "const", path: testDir }, ctx)

          Config.get = originalGet

          expect(result.output).toBeString()
          expect(result.output).toContain("Found")
          expect(result.output).toContain("Line")
          expect(result.output).not.toContain("path,")
          expect(result.output).not.toContain("lineNum,")
        },
      })
    })

    test("outputs TOON format when enabled", async () => {
      await Instance.provide({
        directory: testDir,
        fn: async () => {
          const originalGet = Config.get
          Config.get = async () => ({ ai: { useToonEncoding: true } }) as any

          const result = await grep.execute({ pattern: "const", path: testDir }, ctx)

          Config.get = originalGet

          expect(result.output).toBeString()
          // TOON format should contain array structure
          expect(result.output).toContain("path")
          expect(result.output).toContain("lineNum")
          expect(result.output).toContain("lineText")
          // Should be more compact than plain text
          expect(result.metadata.matches).toBeGreaterThan(0)
        },
      })
    })

    test("TOON output is structured differently than plain text", async () => {
      await Instance.provide({
        directory: testDir,
        fn: async () => {
          const originalGet = Config.get

          Config.get = async () => ({ ai: { useToonEncoding: false } }) as any
          const plainResult = await grep.execute({ pattern: "const", path: testDir }, ctx)

          Config.get = async () => ({ ai: { useToonEncoding: true } }) as any
          const toonResult = await grep.execute({ pattern: "const", path: testDir }, ctx)

          Config.get = originalGet

          // TOON and plain text should be different formats
          expect(toonResult.output).not.toEqual(plainResult.output)
          // TOON should have structured headers
          expect(toonResult.output).toContain("]{")
        },
      })
    })
  })

  describe("GlobTool", () => {
    test("outputs plain text when TOON is disabled", async () => {
      await Instance.provide({
        directory: testDir,
        fn: async () => {
          const originalGet = Config.get
          Config.get = async () => ({ ai: { useToonEncoding: false } }) as any

          const result = await glob.execute({ pattern: "*.ts", path: testDir }, ctx)

          Config.get = originalGet

          expect(result.output).toBeString()
          // Plain text should just list file paths
          expect(result.output).toContain(testDir)
          expect(result.output).toContain("test1.ts")
        },
      })
    })

    test("outputs TOON format when enabled", async () => {
      await Instance.provide({
        directory: testDir,
        fn: async () => {
          const originalGet = Config.get
          Config.get = async () => ({ ai: { useToonEncoding: true } }) as any

          const result = await glob.execute({ pattern: "*.ts", path: testDir }, ctx)

          Config.get = originalGet

          expect(result.output).toBeString()
          // TOON format should contain structured array
          expect(result.output).toContain("path")
          expect(result.output).toContain("mtime")
          expect(result.metadata.count).toBeGreaterThan(0)
        },
      })
    })

    test("handles empty results in both formats", async () => {
      await Instance.provide({
        directory: testDir,
        fn: async () => {
          const originalGet = Config.get

          Config.get = async () => ({ ai: { useToonEncoding: false } }) as any
          const plainResult = await glob.execute({ pattern: "*.nonexistent", path: testDir }, ctx)

          Config.get = async () => ({ ai: { useToonEncoding: true } }) as any
          const toonResult = await glob.execute({ pattern: "*.nonexistent", path: testDir }, ctx)

          Config.get = originalGet

          // Plain text should say "No files found"
          expect(plainResult.output).toContain("No files found")
          // TOON encodes empty array as [0]:
          expect(toonResult.output).toContain("[0]:")
        },
      })
    })
  })

  describe("ListTool", () => {
    test("outputs directory tree when TOON is disabled", async () => {
      await Instance.provide({
        directory: testDir,
        fn: async () => {
          const originalGet = Config.get
          Config.get = async () => ({ ai: { useToonEncoding: false } }) as any

          const result = await list.execute({ path: testDir }, ctx)

          Config.get = originalGet

          expect(result.output).toBeString()
          // Plain text should show indented tree
          expect(result.output).toContain(testDir)
          expect(result.output).toContain("subdir/")
        },
      })
    })

    test("outputs TOON format when enabled", async () => {
      await Instance.provide({
        directory: testDir,
        fn: async () => {
          const originalGet = Config.get
          Config.get = async () => ({ ai: { useToonEncoding: true } }) as any

          const result = await list.execute({ path: testDir }, ctx)

          Config.get = originalGet

          expect(result.output).toBeString()
          // TOON format should contain structured array
          expect(result.output).toContain("path")
          expect(result.output).toContain("type")
          expect(result.metadata.count).toBeGreaterThan(0)
        },
      })
    })

    test("TOON format includes file information", async () => {
      await Instance.provide({
        directory: testDir,
        fn: async () => {
          const originalGet = Config.get
          Config.get = async () => ({ ai: { useToonEncoding: true } }) as any

          const result = await list.execute({ path: testDir }, ctx)

          Config.get = originalGet

          // Should include file type information
          expect(result.output).toContain("type")
          expect(result.output).toContain("file")
          // Check that test files are listed
          expect(result.output).toContain("test1.ts")
        },
      })
    })
  })

  describe("conditional encoding helper", () => {
    test("respects config setting", async () => {
      const sampleData = [
        { id: 1, name: "test" },
        { id: 2, name: "sample" },
      ]

      const plainFormatter = (data: unknown) => {
        const items = data as typeof sampleData
        return items.map((x) => `${x.id}: ${x.name}`).join("\n")
      }

      // Import conditionalEncode
      const { conditionalEncode } = await import("@/util/toon")

      const plainResult = conditionalEncode(sampleData, plainFormatter, false)
      const toonResult = conditionalEncode(sampleData, plainFormatter, true)

      expect(plainResult).toContain("1: test")
      expect(plainResult).toContain("2: sample")

      expect(toonResult).not.toEqual(plainResult)
      expect(toonResult).toContain("id")
      expect(toonResult).toContain("name")
    })
  })
})
