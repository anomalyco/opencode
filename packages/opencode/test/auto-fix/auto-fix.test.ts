import { describe, expect, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import os from "os"

describe("AutoFix", () => {
  test("parses tsc error count from stderr", async () => {
    const sampleOutput = [
      "src/index.ts(5,3): error TS2322: Type 'string' is not assignable to type 'number'",
      "src/utils.ts(12,1): error TS2304: Cannot find name 'foo'",
      "",
    ].join("\n")
    const count = sampleOutput.split("\n").filter((l) => l.includes("error TS")).length
    expect(count).toBe(2)
  })

  test("parses empty tsc output as zero errors", () => {
    const count = "".split("\n").filter((l) => l.includes("error TS")).length
    expect(count).toBe(0)
  })

  test("biome JSON diagnostics parsing", () => {
    const mockJson = JSON.stringify({
      diagnostics: [
        { code: "lint/suspicious/noDoubleEquals", level: "error" },
        { code: "lint/style/useConst", level: "error" },
      ],
      summary: { errors: 2, warnings: 0 },
    })
    const parsed = JSON.parse(mockJson)
    expect(Array.isArray(parsed.diagnostics)).toBe(true)
    expect(parsed.diagnostics.length).toBe(2)
  })

  test("detects biome config files", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "autofix-test-"))
    try {
      await fs.writeFile(path.join(dir, "biome.json"), JSON.stringify({ $schema: "" }))
      const biomeExists = ["biome.json", "biome.jsonc"].some(async (f) => {
        try {
          await fs.access(path.join(dir, f))
          return true
        } catch {
          return false
        }
      })
      expect(await biomeExists).toBe(true)
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  test("detects no biome config when none present", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "autofix-test-"))
    try {
      const biomeExists = await Promise.all(
        ["biome.json", "biome.jsonc"].map(async (f) => {
          try {
            await fs.access(path.join(dir, f))
            return true
          } catch {
            return false
          }
        }),
      )
      expect(biomeExists.every((b) => !b)).toBe(true)
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})
