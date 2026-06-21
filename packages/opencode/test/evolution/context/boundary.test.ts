import { describe, expect, test } from "bun:test"
import { Glob } from "bun"
import path from "path"

const SRC = path.join(import.meta.dir, "../../../src")

// D-01B: Expected public exports from context/index.ts
const EXPECTED_EXPORTS = ["SystemContextProvider", "EvolutionContextLayer", "ContextComposer", "formatEvolutionContext"]

// D-01A: Only flag violations when the import source is evolution/context/internal-file
const INTERNAL_FILES = [
  "evolution/context/budget",
  "evolution/context/composer",
  "evolution/context/provider",
  "evolution/context/retriever",
  "evolution/context/token-estimator",
]

// D-01C: Explicitly audited entry points
const AUDITED_ENTRY_POINTS = [
  "src/evolution/index.ts",
  "src/evolution/context/index.ts",
]

describe("D-01A — Reachability Ownership", () => {
  test("no file outside evolution/context/ imports internal context modules", () => {
    const glob = new Glob("**/*.ts")
    const files = [...glob.scanSync({ cwd: SRC, absolute: false })].filter(
      (f) => !f.startsWith("evolution/context/"),
    )
    const violations: Array<{ file: string; imprt: string }> = []

    for (const file of files) {
      const absolute = path.join(SRC, file)
      const content = require("fs").readFileSync(absolute, "utf-8")
      const importLines = content.match(/from\s+["'][^"']+["']/g) || []
      for (const line of importLines) {
        const imprt = line.replace(/from\s+/, "").replace(/["']/g, "")
        for (const internal of INTERNAL_FILES) {
          // Must be a full path match, not just suffix
          if (imprt.includes(internal)) {
            violations.push({ file, imprt })
          }
        }
      }
    }

    if (violations.length > 0) {
      const details = violations.map((v) => `  ${v.file} → ${v.imprt}`).join("\n")
      expect.unreachable(`Internal modules reachable from outside boundary:\n${details}`)
    }
  })
})

describe("D-01B — Exact Export Set", () => {
  test("context/index.ts exports only expected names", async () => {
    const mod = await import("@/evolution/context/index")
    const actualKeys = Object.keys(mod).sort()
    const expectedKeys = [...EXPECTED_EXPORTS].sort()
    expect(actualKeys).toEqual(expectedKeys)
  })
})

describe("D-01C — Public Surface Audit", () => {
  test("anti-forgetting guard: all barrel files in audited list", async () => {
    const glob = new Glob("**/index.ts")
    const barrels = [...glob.scanSync({ cwd: SRC, absolute: false })].filter(
      (f) => f.startsWith("evolution/"),
    )
    for (const barrel of barrels) {
      const srcRelative = `src/${barrel}`
      expect(AUDITED_ENTRY_POINTS.includes(srcRelative)).toBe(true)
    }
  })

  test("no audited entry point exposes internal context types", async () => {
    const FORBIDDEN_INTERNALS = [
      "ContextRetriever",
      "ContextBudget",
      "TokenEstimator",
    ]

    for (const ep of AUDITED_ENTRY_POINTS) {
      const resolved = ep.replace(/^src\//, "").replace(/\.ts$/, "")
      const mod = await import(`@/${resolved}`)
      const keys = Object.keys(mod)
      for (const key of keys) {
        const value = mod[key as keyof typeof mod]
        if (value && typeof value === "object" && !Array.isArray(value)) {
          const valueKeys = Object.keys(value)
          for (const forbidden of FORBIDDEN_INTERNALS) {
            expect(valueKeys.includes(forbidden)).toBe(false)
          }
        }
      }
    }
  })
})
