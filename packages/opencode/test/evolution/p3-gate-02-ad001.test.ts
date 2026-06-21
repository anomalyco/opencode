import { describe, expect, test } from "bun:test"
import { $ } from "bun"
import path from "path"
import fs from "fs/promises"

const REPO_ROOT = path.join(import.meta.dir, "../../..")
const TEST_DIR = path.join(import.meta.dir)

describe("AD-001 — Facade Boundary Enforcement", () => {
  test("(pass) direct brain import rejected", async () => {
    const tempFile = path.join(TEST_DIR, "__ad001_violation_test.ts")
    try {
      await fs.writeFile(tempFile, `import { EvolutionMemory } from "@/evolution/brain/memory"\n`)
      const result = await $`bun x oxlint ${tempFile}`.cwd(REPO_ROOT).nothrow().quiet()
      const text = result.stdout.toString()
      expect(result.exitCode).not.toBe(0)
      expect(text).toContain("no-restricted-imports")
    } finally {
      await fs.rm(tempFile, { force: true })
    }
  })

  test("(pass) facade import allowed", async () => {
    const facadefile = path.join(TEST_DIR, "__ad001_facade_test.ts")
    try {
      await fs.writeFile(facadefile, `import { Evolution } from "@/evolution/index"\n`)
      const result = await $`bun x oxlint ${facadefile}`.cwd(REPO_ROOT).nothrow().quiet()
      const text = result.stdout.toString()
      expect(result.exitCode).toBe(0)
      expect(text).not.toContain("no-restricted-imports")
    } finally {
      await fs.rm(facadefile, { force: true })
    }
  })
})
