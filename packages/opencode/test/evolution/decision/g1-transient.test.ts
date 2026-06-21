import { describe, expect, test } from "bun:test"
import { readFileSync } from "fs"

describe("TG-TRANSIENT — ProposalCandidate has no storage method", () => {
  const src = readFileSync(
    new URL("../../../src/evolution/decision/proposal-candidate.ts", import.meta.url),
    "utf-8",
  )

  test("No write/save/persist export in proposal-candidate.ts", () => {
    const persistExport = src.match(/export.*(write|save|persist)/i)
    expect(persistExport).toBeNull()
  })

  test("ProposalCandidate interface has no storage-related fields", () => {
    const ifaceSection = src.match(/interface ProposalCandidate \{[\s\S]*?\n\}/)
    if (ifaceSection) {
      expect(ifaceSection[0]).not.toMatch(/\bpersist\b|\bstore\b|\bwrite\b|\bsave\b/i)
    }
  })
})
