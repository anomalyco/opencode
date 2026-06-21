import { describe, expect, test } from "bun:test"
import { $ } from "bun"
import path from "path"
import fs from "fs/promises"
import { Glob } from "bun"

const SRC = path.join(import.meta.dir, "../../../src")

const INTERNAL_FILES = ["evolution/brain/proposal-store"]

describe("P3-B01-01 — Import Graph Enforcement", () => {
  test("(pass) no file outside brain/ imports proposal-store directly", () => {
    const glob = new Glob("**/*.ts")
    const files = [...glob.scanSync({ cwd: SRC, absolute: false })].filter(
      (f) => !f.startsWith("evolution/brain/"),
    )
    const violations: Array<{ file: string; imprt: string }> = []

    for (const file of files) {
      const absolute = path.join(SRC, file)
      const content = require("fs").readFileSync(absolute, "utf-8")
      const importLines = content.match(/from\s+["'][^"']+["']/g) || []
      for (const line of importLines) {
        const imprt = line.replace(/from\s+/, "").replace(/["']/g, "")
        for (const internal of INTERNAL_FILES) {
          if (imprt.includes(internal)) {
            violations.push({ file, imprt })
          }
        }
      }
    }

    if (violations.length > 0) {
      const details = violations.map((v) => `  ${v.file} → ${v.imprt}`).join("\n")
      expect.unreachable(`ProposalStore reachable from outside boundary:\n${details}`)
    }
  })

  test("(pass) decisions.ts imports proposal-store", () => {
    const decisionsContent = require("fs").readFileSync(
      path.join(SRC, "evolution/brain/decisions.ts"),
      "utf-8",
    )
    expect(decisionsContent).toMatch(/from.*proposal-store/)
  })
})

describe("P3-B01-02 — Schema Decode Boundary (AC-08)", () => {
  test("(pass) proposal-store.ts uses Schema.decodeUnknownOption (AC-08 decode boundary)", () => {
    const content = require("fs").readFileSync(
      path.join(SRC, "evolution/brain/proposal-store.ts"),
      "utf-8",
    )
    expect(content).toMatch(/Schema\.decodeUnknownOption/)
  })
})

describe("P3-B01-03 — AD-001 Facade Enforcement", () => {
  test("(pass) direct proposal-store import rejected by oxlint", async () => {
    const tempFile = path.join(import.meta.dir, "__p3b01_violation_test.ts")
    try {
      await fs.writeFile(tempFile, `import { ProposalStore } from "@/evolution/brain/proposal-store"\n`)
      const result = await $`bun x oxlint ${tempFile}`.nothrow().quiet()
      const text = result.stdout.toString()
      expect(result.exitCode).not.toBe(0)
      expect(text).toContain("no-restricted-imports")
    } finally {
      await fs.rm(tempFile, { force: true })
    }
  })
})

describe("P3-B01-04 — ProposalStore Operations", () => {
  test("(pass) ProposalStore module has expected exports", () => {
    const mod = require("fs").readFileSync(
      path.join(SRC, "evolution/brain/proposal-store.ts"),
      "utf-8",
    )
    expect(mod).toMatch(/submit/)
    expect(mod).toMatch(/updateStatus/)
    expect(mod).toMatch(/getById/)
    expect(mod).toMatch(/listByStatus/)
    expect(mod).toMatch(/existsByKey/)
  })

  test("(pass) decisions.ts has propose() method", () => {
    const decisionsContent = require("fs").readFileSync(
      path.join(SRC, "evolution/brain/decisions.ts"),
      "utf-8",
    )
    expect(decisionsContent).toMatch(/propose/)
  })
})
