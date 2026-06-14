import { describe, expect, test } from "bun:test"
import { renderReport } from "../src/report.ts"
import type { RunResult } from "../src/types.ts"

const run: RunResult = {
  skillName: "demo",
  baseline: {
    candidateId: "baseline",
    objectives: { score: 0.25, passRate: 0.25, sizeBytes: 100 },
    cases: [{ caseId: "a", score: 0.25, detail: "coverage 1/4" }],
  },
  generations: [
    {
      generation: 1,
      evaluated: [
        {
          candidate: { id: "g1-v0", generation: 1, skill: { name: "demo", path: "", frontmatter: {}, body: "x" } },
          evaluation: { candidateId: "g1-v0", objectives: { score: 0.8, passRate: 0.75, sizeBytes: 180 }, cases: [] },
          gate: { passed: true, checks: [] },
        },
      ],
      frontier: ["g1-v0"],
      best: "g1-v0",
    },
  ],
  best: {
    candidate: {
      id: "g1-v0",
      generation: 1,
      skill: { name: "demo", path: "", frontmatter: {}, body: "x" },
      rationale: "cover atomic",
    },
    evaluation: {
      candidateId: "g1-v0",
      objectives: { score: 0.8, passRate: 0.75, sizeBytes: 180 },
      cases: [{ caseId: "a", score: 0.8, detail: "coverage 4/5" }],
    },
    gate: { passed: true, checks: [] },
  },
  improvedFromBaseline: true,
}

describe("report", () => {
  test("renders headline, generations table, and per-case scores", () => {
    const md = renderReport(run)
    expect(md).toContain("# Evolution report: demo")
    expect(md).toContain("✅ improved")
    expect(md).toContain("Baseline score: 0.250")
    expect(md).toContain("Best score: 0.800")
    expect(md).toContain("Rationale: cover atomic")
    expect(md).toContain("| 1 | 1 | 1 | g1-v0 | 0.800 | 75% | 180 |")
    expect(md).toContain("| a | 0.800 | coverage 4/5 |")
  })
})
