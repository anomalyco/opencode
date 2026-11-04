import { expect, test } from "bun:test"
import { auditAllFixtures, auditFixture, summarizeAudits, worstAudits } from "./test/layout-audit/harness.js"
import { layoutFixtures } from "./test/layout-audit/fixtures.js"

test("audits deterministic flowchart and state layout families", () => {
  const fixtures = layoutFixtures()
  const flowcharts = fixtures.filter((fixture) => fixture.kind === "flowchart")
  const states = fixtures.filter((fixture) => fixture.kind === "state")
  expect(flowcharts.length).toBeGreaterThanOrEqual(100)
  expect(states.length).toBeGreaterThanOrEqual(100)
  expect(new Set(fixtures.map((fixture) => fixture.id)).size).toBe(fixtures.length)

  const startedAt = performance.now()
  const audits = auditAllFixtures()
  const elapsedMs = performance.now() - startedAt
  const violations = audits.flatMap((audit) =>
    audit.violations.map((violation) => `${audit.fixture.id} @${audit.viewport}: ${violation}`),
  )
  const summary = summarizeAudits(audits)

  expect(audits.length).toBeGreaterThanOrEqual(fixtures.length)
  expect(violations).toEqual([])
  for (const audit of audits.filter((audit) => audit.fixture.kind === "state")) {
    expect(audit.viewport).toBe(audit.fixture.profile === "short" ? 60 : audit.fixture.profile === "unicode" ? 80 : 120)
  }
  for (const id of ["state/chain/lr-long", "state/chain/rl-long"]) {
    const audit = audits.find((candidate) => candidate.fixture.id === id)!
    expect(audit.viewport).toBe(120)
    expect([audit.metrics.width, audit.metrics.height, audit.metrics.overflow]).toEqual([84, 41, 0])
  }
  expect(
    audits
      .filter((audit) => audit.fixture.id === "flowchart/deployment-architecture/curated")
      .map((audit) => audit.viewport),
  ).toEqual([60, 80, 120])
  // decision-loops is a deliberately crossing-heavy family; ceiling it separately so it cannot absorb the
  // p95 headroom of the established families.
  const established = summarizeAudits(audits.filter((audit) => audit.fixture.family !== "decision-loops")).total
  expect(established.area.max).toBeLessThanOrEqual(11_011)
  expect(established.area.p95).toBeLessThanOrEqual(5_313)
  expect(established.bends.max).toBeLessThanOrEqual(30)
  expect(established.bends.p95).toBeLessThanOrEqual(11)
  expect(established.crossings.total).toBeLessThanOrEqual(40)
  expect(established.crossings.max).toBeLessThanOrEqual(3)
  expect(established.routeLength.max).toBeLessThanOrEqual(930)
  expect(established.routeLength.p95).toBeLessThanOrEqual(364)
  expect(established.sharedRouteCells.max).toBeLessThanOrEqual(547)
  expect(established.sharedRouteCells.p95).toBeLessThanOrEqual(122)
  expect(established.overflow.max).toBeLessThanOrEqual(170)
  expect(established.overflow.p95).toBeLessThanOrEqual(99)
  const decisionLoops = summarizeAudits(audits.filter((audit) => audit.fixture.family === "decision-loops")).total
  expect(decisionLoops.runs).toBeGreaterThan(0)
  expect(decisionLoops.area.max).toBeLessThanOrEqual(8_784)
  expect(decisionLoops.bends.max).toBeLessThanOrEqual(24)
  expect(decisionLoops.crossings.total).toBeLessThanOrEqual(24)
  expect(decisionLoops.crossings.max).toBeLessThanOrEqual(8)
  expect(decisionLoops.routeLength.max).toBeLessThanOrEqual(526)
  expect(decisionLoops.sharedRouteCells.max).toBeLessThanOrEqual(352)
  expect(decisionLoops.overflow.max).toBeLessThanOrEqual(84)
  expect(summary.state.crossings.total).toBe(0)

  for (const fixture of [...Map.groupBy(fixtures, (candidate) => `${candidate.kind}/${candidate.family}`).values()].map(
    (family) => family[0]!,
  )) {
    const first = auditFixture(fixture, 80)
    const second = auditFixture(fixture, 80)
    expect(second.output).toBe(first.output)
    expect(second.metrics).toEqual(first.metrics)
    expect(second.violations).toEqual(first.violations)
  }

  console.log(
    `[layout-audit] ${fixtures.length} sources, ${audits.length} runs, ${elapsedMs.toFixed(0)}ms`,
    JSON.stringify({
      summary,
      worst: {
        area: worstAudits(audits, "area", 3).map((audit) => [audit.fixture.id, audit.viewport, audit.metrics.area]),
        bends: worstAudits(audits, "bends", 3).map((audit) => [audit.fixture.id, audit.viewport, audit.metrics.bends]),
        crossings: worstAudits(audits, "crossings", 3).map((audit) => [
          audit.fixture.id,
          audit.viewport,
          audit.metrics.crossings,
        ]),
        overflow: worstAudits(audits, "overflow", 3).map((audit) => [
          audit.fixture.id,
          audit.viewport,
          audit.metrics.overflow,
        ]),
      },
    }),
  )
}, 40_000)
