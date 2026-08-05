import { describe, expect, test } from "bun:test"
import {
  classifyByInstalledFamily,
  modelFamilyVersion,
  parseRecommendationQuant,
  recommendationQuantRank,
} from "../../src/local/model-catalog/family"

// Validates opencode-skein's ported family/quant behavior against Skein's golden
// export (fleet-model-gallery task 3.2). The fixtures are copied verbatim from
// skein:openspec/changes/fleet-model-gallery/fixtures/ — see quant_golden_test.go
// and family_golden_test.go there for how they were generated and pinned against
// Skein's own live functions.
//
// This is a *destination* validation, not a re-export: where the fixture pins a
// Skein defect and this file's port has since fixed it (family.ts is active
// destination code, not code being retired), the assertions below intentionally
// diverge from the fixture and say so. Cases that are still pinned as-is match
// the fixture exactly.
import familyVersionCases from "./fixtures/fleet-model-gallery/family-version-cases.json"
import quantCases from "./fixtures/fleet-model-gallery/quant-cases.json"
import upgradeFreshCases from "./fixtures/fleet-model-gallery/upgrade-fresh-cases.json"

type QuantCase = { note: string; name: string; quant: string; rank: number; bpw: number }
type FamilyVersionCase = { note: string; name: string; family: string; version: number }
type UpgradeFreshCase = {
  note: string
  installed: string[]
  recs: Array<{ repo: string; file?: string; already_have?: boolean }>
  upgrades: Array<{ repo: string; replaces: string }>
  fresh: string[]
}

// Fixed here (see family.ts): ud_q5_k_m and ud_q8_0 are now ranked at their base
// quant's quality instead of falling through to unranked (rank 0, sorting below
// Q2_K) — the fixture's most consequential pinned defect.
const FIXED_QUANT_RANK: Record<string, number> = {
  "Qwen3-32B-UD-Q5_K_M.gguf": 3,
  "Qwen3-32B-UD-Q8_0.gguf": 1,
}

describe("quant-cases.json parity", () => {
  test.each(quantCases as QuantCase[])("$name — $note", (c) => {
    const quant = parseRecommendationQuant(c.name)
    expect(quant).toBe(c.quant)

    const rank = recommendationQuantRank(quant) ?? 0
    const expectedRank = FIXED_QUANT_RANK[c.name] ?? c.rank
    expect(rank).toBe(expectedRank)
  })

  // bpw (quantBPW) is Skein's own on-disk size estimator and has no equivalent
  // here: opencode-skein's analogous value comes from quant.ts's table-driven
  // quantBytesPerParam (ported from llmfit, a different, unrelated lineage that
  // already covers every UD tier via generic XL/L/M/S table entries — see
  // quant.ts). The fixture's bpw column is intentionally not checked here.
})

describe("family-version-cases.json parity", () => {
  test.each(familyVersionCases as FamilyVersionCase[])("$name — $note", (c) => {
    const got = modelFamilyVersion(c.name)
    // The Go fixture uses the zero-value sentinel (family:"", version:0) where
    // Skein's function found no match; modelFamilyVersion returns null instead.
    const wantNull = c.family === "" && c.version === 0

    if (c.name === "internlm2_5-20b-chat") {
      // Fixed here: the fixture pins Skein's underscore-decimal truncation
      // (2_5 -> version 2), which ties internlm2_5 with internlm2_6 and makes a
      // real point-release upgrade silently vanish. family.ts now accepts "_" as
      // a decimal separator, matching quant.ts's own convention for the same
      // naming pattern, so this resolves to 2.5, not the pinned 2.
      expect(got).toEqual({ family: "internlm", version: 2.5 })
      return
    }

    if (wantNull) {
      expect(got).toBeNull()
      return
    }
    expect(got).toEqual({ family: c.family, version: c.version })
  })

  test("Mixtral MoE 'NxM' marker is still pinned, not fixed", () => {
    // See family.ts's modelFamilyVersion doc comment for why this is a pin, not
    // a patch: an MoE expert-count marker isn't a version at all, and a narrow
    // regex fix here just relocates the corruption rather than removing it.
    expect(modelFamilyVersion("Mixtral-8x7B-Instruct-v0.1")).toEqual({ family: "mixtral", version: 8 })
  })
})

describe("upgrade-fresh-cases.json parity", () => {
  test.each(upgradeFreshCases as UpgradeFreshCase[])("$note", (c) => {
    // already_have candidates are Skein's pre-filter, applied by the caller
    // before classifyByInstalledFamily per its own doc comment; mirror that here.
    const candidates = c.recs.filter((r) => !r.already_have)
    const { upgrades, fresh } = classifyByInstalledFamily(candidates, c.installed, (r) => [r.repo, ...(r.file ? [r.file] : [])])

    const isInternlmPointRelease = c.installed[0] === "internlm2_5-20b-chat"
    if (isInternlmPointRelease) {
      // Fixed here, following from the family-version fix above: 2_6 > 2_5 is
      // now correctly detected as an upgrade instead of tying and vanishing.
      expect(upgrades.map((u) => ({ repo: u.candidate.repo, replaces: u.replaces }))).toEqual([
        { repo: "internlm/internlm2_6-20b-chat-gguf", replaces: "internlm2_5-20b-chat" },
      ])
      expect(fresh).toHaveLength(0)
      return
    }

    expect(upgrades.map((u) => ({ repo: u.candidate.repo, replaces: u.replaces }))).toEqual(c.upgrades)
    expect(fresh.map((f) => f.repo)).toEqual(c.fresh)
  })
})
