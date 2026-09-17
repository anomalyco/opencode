import { expect, test } from "bun:test"
import {
  analyzeVisualStability,
  analyzeVisualStabilityByMarker,
  type VisualStabilityTrace,
} from "../../utils/visual-stability"
import { analyzeVisualObservations } from "../../utils/visual-stability/analyzer"
import { legacyVisualPlan, visualPlan, type VisualInvariant } from "../../utils/visual-stability/invariant"
import { defineVisualRegions, mapVisualRegions } from "../../utils/visual-stability/regions"

function trace(samples: VisualStabilityTrace["samples"]): VisualStabilityTrace {
  return { markers: [], samples }
}

test("accepts continuous visible motion", () => {
  expect(
    analyzeVisualStability(
      trace([
        frame(0, region({ width: 80, bottom: 40 }), region({ top: 40, bottom: 60 })),
        frame(16, region({ width: 75, bottom: 45 }), region({ top: 45, bottom: 65 })),
        frame(32, region({ width: 70, bottom: 50 }), region({ top: 50, bottom: 70 })),
      ]),
      { flow: ["changing", "following"] },
    ),
  ).toEqual([])
})

test("reports repeated geometry reversals", () => {
  const issues = analyzeVisualStability(
    trace([
      frame(0, region({ width: 80 })),
      frame(16, region({ width: 60 })),
      frame(32, region({ width: 78 })),
      frame(48, region({ width: 62 })),
    ]),
  )

  expect(issues.some((issue) => issue.includes("changing width reversed 2 times"))).toBe(true)
})

test("reports visible blanking, label reversal, and overlap", () => {
  const issues = analyzeVisualStability(
    trace([
      frame(0, region({ label: "Exploring", opacity: 1, bottom: 40 }), region({ top: 40, bottom: 60 })),
      frame(16, region({ label: "Explored", opacity: 0.2, bottom: 50 }), region({ top: 49, bottom: 69 })),
      frame(32, region({ label: "Exploring", opacity: 1, bottom: 50 }), region({ top: 50, bottom: 70 })),
    ]),
    { flow: ["changing", "following"] },
  )

  expect(issues.some((issue) => issue.includes("opacity fell to 0.2"))).toBe(true)
  expect(issues.some((issue) => issue.includes("label reverted"))).toBe(true)
  expect(issues.some((issue) => issue.includes("overlapped following by 1px"))).toBe(true)
})

test("reports duplicate regions and unexpected remounts", () => {
  const issues = analyzeVisualStability(
    trace([frame(0, region({ node: 1 })), frame(16, region({ node: 2, count: 2 })), frame(32, region({ node: 2 }))]),
    { stable: ["changing"], unique: ["changing"] },
  )

  expect(issues.some((issue) => issue.includes("changing appeared 2 times"))).toBe(true)
  expect(issues.some((issue) => issue.includes("changing remounted"))).toBe(true)
})

test("reports bottom anchor loss but permits movement while scrolled away", () => {
  const anchored = analyzeVisualStability(
    trace([
      { at: 0, regions: { changing: region() }, viewport: viewport(0) },
      { at: 16, regions: { changing: region() }, viewport: viewport(24) },
    ]),
    { preserveBottomAnchor: true },
  )
  const away = analyzeVisualStability(
    trace([
      { at: 0, regions: { changing: region() }, viewport: viewport(80) },
      { at: 16, regions: { changing: region() }, viewport: viewport(104) },
    ]),
    { preserveBottomAnchor: true },
  )

  expect(anchored.some((issue) => issue.includes("bottom anchor moved to 24px"))).toBe(true)
  expect(away).toEqual([])
})

test("reports up down up movement while preserving a bottom anchor", () => {
  const issues = analyzeVisualStability(
    trace([
      { at: 0, regions: { changing: region({ top: 200, bottom: 240 }) }, viewport: viewport(0) },
      { at: 16, regions: { changing: region({ top: 180, bottom: 220 }) }, viewport: viewport(0) },
      { at: 32, regions: { changing: region({ top: 196, bottom: 236 }) }, viewport: viewport(0) },
      { at: 48, regions: { changing: region({ top: 176, bottom: 216 }) }, viewport: viewport(0) },
    ]),
    { preserveBottomAnchor: true, maxPositionReversals: 0 },
  )

  expect(issues.some((issue) => issue.includes("changing top reversed 2 times"))).toBe(true)
  expect(issues.some((issue) => issue.includes("changing bottom reversed 2 times"))).toBe(true)
})

test("accepts monotonic upward movement while preserving a bottom anchor", () => {
  expect(
    analyzeVisualStability(
      trace([
        { at: 0, regions: { changing: region({ top: 200, bottom: 240 }) }, viewport: viewport(0) },
        { at: 16, regions: { changing: region({ top: 190, bottom: 230 }) }, viewport: viewport(0) },
        { at: 32, regions: { changing: region({ top: 180, bottom: 220 }) }, viewport: viewport(0) },
      ]),
      { preserveBottomAnchor: true, maxPositionReversals: 0 },
    ),
  ).toEqual([])
})

test("ignores overlap entirely outside the clipped timeline viewport", () => {
  expect(
    analyzeVisualStability(
      trace([
        {
          at: 0,
          regions: {
            changing: region({ top: -200, bottom: -100 }),
            following: region({ top: -150, bottom: -50 }),
          },
          viewport: viewport(0),
        },
      ]),
      { flow: ["changing", "following"] },
    ),
  ).toEqual([])
})

test("reports visible anchor movement while allowing virtual scrollbar movement", () => {
  const issues = analyzeVisualStability(
    trace([
      { at: 0, regions: { anchor: region({ top: 100, bottom: 120 }) }, viewport: { ...viewport(100), scrollTop: 40 } },
      { at: 16, regions: { anchor: region({ top: 100, bottom: 120 }) }, viewport: { ...viewport(120), scrollTop: 60 } },
    ]),
    { fixed: ["anchor"] },
  )

  expect(issues).toEqual([])

  const moved = analyzeVisualStability(
    trace([
      { at: 0, regions: { anchor: region({ top: 100, bottom: 120 }) }, viewport: viewport(100) },
      { at: 16, regions: { anchor: region({ top: 112, bottom: 132 }) }, viewport: viewport(100) },
    ]),
    { fixed: ["anchor"] },
  )
  expect(moved.some((issue) => issue.includes("anchor moved 12px in the viewport"))).toBe(true)
})

test("analyzes each marked event independently", () => {
  const input: VisualStabilityTrace = {
    markers: [
      { at: 10, label: "grow" },
      { at: 40, label: "shrink" },
    ],
    samples: [
      frame(0, region({ top: 100 })),
      frame(16, region({ top: 90 })),
      frame(32, region({ top: 80 })),
      frame(48, region({ top: 90 })),
      frame(64, region({ top: 100 })),
    ],
  }

  expect(analyzeVisualStability(input, { maxPositionReversals: 0 })).toContain("changing top reversed 1 times")
  expect(
    analyzeVisualStabilityByMarker(input, {
      maxPositionReversals: 0,
      motion: ["changing"],
      aggregateMotion: false,
    }),
  ).toEqual([])
})

test("reports cross-event motion reversals by default", () => {
  const input: VisualStabilityTrace = {
    markers: [
      { at: 10, label: "up" },
      { at: 40, label: "down" },
    ],
    samples: [
      frame(0, region({ top: 100 })),
      frame(16, region({ top: 90 })),
      frame(32, region({ top: 80 })),
      frame(48, region({ top: 90 })),
      frame(64, region({ top: 100 })),
    ],
  }

  expect(analyzeVisualStabilityByMarker(input, { maxPositionReversals: 0 })).toContain("changing top reversed 1 times")
})

test("reports regions rendered in the wrong flow order", () => {
  const issues = analyzeVisualStability(
    trace([frame(0, region({ top: 100, bottom: 120 }), region({ top: 60, bottom: 80 }))]),
    { flow: ["changing", "following"] },
  )

  expect(issues.some((issue) => issue.includes("changing rendered after following"))).toBe(true)
})

test("uses painted bounds instead of clipped layout overflow", () => {
  expect(
    analyzeVisualStability(
      trace([
        frame(
          0,
          region({ top: 100, bottom: 140, height: 40, layoutTop: 100, layoutBottom: 300 }),
          region({ top: 140, bottom: 180 }),
        ),
      ]),
      { flow: ["changing", "following"] },
    ),
  ).toEqual([])
})

test("does not report disappearance when a present row moves outside the viewport", () => {
  expect(
    analyzeVisualStability(
      trace([
        frame(0, region({ visible: true })),
        frame(16, region({ visible: false, inViewport: false, top: -100, bottom: -80 })),
        frame(32, region({ visible: true })),
      ]),
    ),
  ).toEqual([])
})

test("reports an in-viewport transparent frame between visible frames", () => {
  const issues = analyzeVisualStability(
    trace([
      frame(0, region()),
      frame(16, region({ visible: false, opacity: 0, inViewport: true })),
      frame(32, region()),
    ]),
  )

  expect(issues.some((issue) => issue.includes("blanked between visible frames"))).toBe(true)
})

test("reports an in-viewport display-none frame between visible frames", () => {
  const issues = analyzeVisualStability(
    trace([
      frame(0, region()),
      frame(16, region({ visible: false, width: 0, height: 0, inViewport: true, cssHidden: true })),
      frame(32, region()),
    ]),
  )

  expect(issues.some((issue) => issue.includes("blanked between visible frames"))).toBe(true)
})

test("can limit motion analysis to unaffected regions", () => {
  expect(
    analyzeVisualStability(
      trace([
        frame(0, region({ height: 20 }), region()),
        frame(16, region({ height: 40 }), region()),
        frame(32, region({ height: 30 }), region()),
      ]),
      { motion: ["following"] },
    ),
  ).toEqual([])
})

test("reports a blank frame across replacement surfaces", () => {
  const issues = analyzeVisualStability(
    {
      markers: [],
      samples: [
        { at: 0, regions: { thinking: region(), error: region({ present: false, visible: false }) } },
        {
          at: 16,
          regions: {
            thinking: region({ present: false, visible: false }),
            error: region({ present: false, visible: false }),
          },
        },
        { at: 32, regions: { thinking: region({ present: false, visible: false }), error: region() } },
      ],
    },
    { continuousAny: [["thinking", "error"]] },
  )

  expect(issues.some((issue) => issue.includes("thinking | error blanked"))).toBe(true)
})

test("reports failure to acquire the bottom anchor", () => {
  const issues = analyzeVisualStability(
    trace([
      { at: 0, regions: { changing: region() }, viewport: viewport(600) },
      { at: 16, regions: { changing: region() }, viewport: viewport(120) },
    ]),
    { acquireBottomAnchor: true },
  )

  expect(issues.some((issue) => issue.includes("did not acquire bottom anchor"))).toBe(true)
})

test("reports a required region that never renders", () => {
  const issues = analyzeVisualStability(
    trace([
      {
        at: 0,
        regions: { changing: region({ present: false, visible: false }) },
      },
    ]),
    { required: ["changing"] },
  )

  expect(issues).toContain("changing never rendered")
})

test("preserves typed region names while mapping definitions", () => {
  const regions = defineVisualRegions({
    changing: { selector: "[data-changing]" },
    following: { selector: "[data-following]", closest: "[data-row]" },
  })
  const selectors = mapVisualRegions(regions, (region) => region.selector)

  expect(selectors).toEqual({ changing: "[data-changing]", following: "[data-following]" })
  const name: keyof typeof selectors = "changing"
  expect(name).toBe("changing")
})

test("evaluates the typed invariant algebra over explicit observations", () => {
  const regions = defineVisualRegions({
    changing: { selector: "[data-changing]" },
    following: { selector: "[data-following]" },
  })
  const invariants = [
    { type: "required", regions: ["changing"] },
    { type: "flow", regions: ["changing", "following"] },
  ] satisfies VisualInvariant<keyof typeof regions>[]
  // @ts-expect-error Plans reject names that are not in the region definition.
  const invalid = { type: "required", regions: ["missing"] } satisfies VisualInvariant<keyof typeof regions>
  const plan = visualPlan(regions, invariants, { perMarker: true })

  expect(invalid.regions).toEqual(["missing"])
  expect(plan.perMarker).toBe(true)
  expect(analyzeVisualObservations([frame(0, region({ bottom: 50 }), region({ top: 49, bottom: 69 }))], plan)).toEqual([
    "changing overlapped following by 1px at 0ms",
  ])
})

test("legacy plan adapter preserves analyzer messages and order", () => {
  const input = trace([
    frame(0, region({ label: "Exploring", opacity: 1, bottom: 40 }), region({ top: 40, bottom: 60 })),
    frame(16, region({ label: "Explored", opacity: 0.2, bottom: 50 }), region({ top: 49, bottom: 69 })),
    frame(32, region({ label: "Exploring", opacity: 1, bottom: 50 }), region({ top: 50, bottom: 70 })),
  ])
  const options = { flow: ["changing", "following"], stable: ["changing"] }

  expect(analyzeVisualObservations(input.samples, legacyVisualPlan(options))).toEqual(
    analyzeVisualStability(input, options),
  )
})

function frame(
  at: number,
  changing: VisualStabilityTrace["samples"][number]["regions"][string],
  following?: VisualStabilityTrace["samples"][number]["regions"][string],
) {
  return { at, regions: { changing, ...(following ? { following } : {}) } }
}

function region(input: Partial<VisualStabilityTrace["samples"][number]["regions"][string]> = {}) {
  return {
    present: true,
    visible: true,
    inViewport: true,
    top: 0,
    bottom: 20,
    width: 100,
    height: 20,
    opacity: 1,
    count: 1,
    node: 1,
    label: "",
    text: "",
    layoutTop: input.top ?? 0,
    layoutBottom: input.bottom ?? 20,
    ...input,
  }
}

function viewport(distanceFromBottom: number) {
  return { top: 0, bottom: 400, scrollTop: 100, scrollHeight: 500, clientHeight: 400, distanceFromBottom }
}
