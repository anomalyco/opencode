import { describe, expect, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import os from "os"
import { ContextAnalyzer } from "../../src/context/analyzer"

describe("ContextAnalyzer", () => {
  async function withDir(fn: (dir: string) => Promise<void>) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-test-"))
    try {
      await fn(dir)
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  }

  test("finds files matching query by name", async () => {
    await withDir(async (dir) => {
      await fs.writeFile(path.join(dir, "main.ts"), "export const main = 1")
      await fs.writeFile(path.join(dir, "utils.ts"), "export const utils = 1")
      await fs.writeFile(path.join(dir, "styles.css"), "body { color: red }")

      const result = await ContextAnalyzer.analyzeContext("main", dir, 10)
      expect(result.length).toBeGreaterThan(0)
      expect(result[0].filePath).toBe("main.ts")
    })
  })

  test("respects maxFiles limit", async () => {
    await withDir(async (dir) => {
      for (let i = 0; i < 20; i++) {
        await fs.writeFile(path.join(dir, `file${i}.ts`), `export const f${i} = 1`)
      }

      const result = await ContextAnalyzer.analyzeContext("file", dir, 5)
      expect(result.length).toBeLessThanOrEqual(5)
    })
  })

  test("ranks direct imports higher than indirect", async () => {
    await withDir(async (dir) => {
      await fs.writeFile(path.join(dir, "main.ts"), `import { helper } from "./helper"\nexport const main = 1`)
      await fs.writeFile(path.join(dir, "helper.ts"), `export const helper = 1`)
      await fs.writeFile(path.join(dir, "unrelated.ts"), `export const unrelated = 1`)

      const result = await ContextAnalyzer.analyzeContext("test query", dir, 10, "main.ts")
      const mainImport = result.find((r) => r.filePath === "helper.ts")
      expect(mainImport).toBeDefined()
      expect(mainImport!.score).toBe(10)
    })
  })

  test("includes config files when query mentions config", async () => {
    await withDir(async (dir) => {
      await fs.writeFile(path.join(dir, "main.ts"), "export const main = 1")
      await fs.writeFile(path.join(dir, "package.json"), JSON.stringify({ name: "test" }))
      await fs.writeFile(path.join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: {} }))

      const result = await ContextAnalyzer.analyzeContext("update config settings", dir, 10)
      const configFiles = result.filter((r) => r.filePath.endsWith(".json"))
      expect(configFiles.length).toBeGreaterThan(0)
      expect(configFiles.every((r) => r.score === 3)).toBe(true)
    })
  })

  test("includes test files when includeTests is true", async () => {
    await withDir(async (dir) => {
      await fs.writeFile(path.join(dir, "main.ts"), "export const main = 1")
      await fs.writeFile(path.join(dir, "main.test.ts"), 'import { main } from "./main"; test("main", () => {})')

      const result = await ContextAnalyzer.analyzeContext("test query", dir, 10, "main.ts", true)
      const testFile = result.find((r) => r.filePath === "main.test.ts")
      expect(testFile).toBeDefined()
      expect(testFile!.reason).toContain("test file")
    })
  })

  test("skips node_modules and .git directories", async () => {
    await withDir(async (dir) => {
      await fs.mkdir(path.join(dir, "node_modules"), { recursive: true })
      await fs.mkdir(path.join(dir, ".git"), { recursive: true })
      await fs.writeFile(path.join(dir, "node_modules", "lodash.ts"), "export const lodash = 1")
      await fs.writeFile(path.join(dir, "main.ts"), "export const main = 1")

      const result = await ContextAnalyzer.analyzeContext("main", dir, 10)
      expect(result.every((r) => !r.filePath.includes("node_modules"))).toBe(true)
    })
  })

  test("returns empty array for empty project", async () => {
    await withDir(async (dir) => {
      const result = await ContextAnalyzer.analyzeContext("test", dir, 10)
      expect(result).toEqual([])
    })
  })
})
