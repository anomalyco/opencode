import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs"
import path from "node:path"

const CORE_DIR = path.resolve(import.meta.dirname, "../../src/core")
const FORBIDDEN = /from\s+["'](@opencode\/|effect)["']/

function coreSources(): string[] {
  const out: string[] = []
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) visit(full)
      else if (entry.name.endsWith(".ts")) out.push(full)
    }
  }
  visit(CORE_DIR)
  return out
}

describe("core purity (spec Part A §1.8)", () => {
  test("src/core has no harness imports", () => {
    const offenders = coreSources().filter((f) => FORBIDDEN.test(readFileSync(f, "utf8")))
    expect(offenders).toEqual([])
  })

  test("guard catches a violation when one exists", () => {
    const probe = path.join(CORE_DIR, "_probe-violation.ts")
    writeFileSync(probe, 'import { Effect } from "effect"\nexport const x = Effect.void\n')
    try {
      const offenders = coreSources().filter((f) => FORBIDDEN.test(readFileSync(f, "utf8")))
      expect(offenders).toEqual([probe])
    } finally {
      unlinkSync(probe)
    }
  })
})
