import type { Page, TestInfo } from "@playwright/test"
import { analyzeVisualObservations, analyzeVisualTraceByMarker } from "./visual-stability/analyzer"
import { legacyVisualPlan, type LegacyVisualStabilityOptions } from "./visual-stability/invariant"
import type { CapturedFrame, VisualStabilityTrace } from "./visual-stability/model"
import { markVisualProbe, startVisualProbe, stopVisualProbe } from "./visual-stability/probe"
import type { VisualRegionDefinition } from "./visual-stability/regions"
import { reportVisualStability } from "./visual-stability/reporter"

export * from "./visual-stability/index"

const capturedFrames = Symbol("capturedFrames")

export async function startVisualStabilityProbe(page: Page, regions: Record<string, VisualRegionDefinition>) {
  await startVisualProbe(page, regions)
}

export async function stopVisualStabilityProbe(page: Page) {
  const result = await stopVisualProbe(page)
  const trace: VisualStabilityTrace = { markers: result.markers, samples: result.samples }
  Object.defineProperty(trace, capturedFrames, { value: result.frames })
  return trace
}

export async function markVisualStability(page: Page, label: string) {
  await markVisualProbe(page, label)
}

export function analyzeVisualStability(trace: VisualStabilityTrace, options: LegacyVisualStabilityOptions = {}) {
  return analyzeVisualObservations(trace.samples, legacyVisualPlan(options))
}

export function analyzeVisualStabilityByMarker(
  trace: VisualStabilityTrace,
  options: LegacyVisualStabilityOptions = {},
) {
  return analyzeVisualTraceByMarker(trace, legacyVisualPlan(options))
}

export async function expectVisualStability(
  testInfo: TestInfo,
  name: string,
  trace: VisualStabilityTrace,
  options: LegacyVisualStabilityOptions = {},
) {
  await reportVisualStability(
    testInfo,
    name,
    {
      ...trace,
      frames: (trace as VisualStabilityTrace & { [capturedFrames]?: CapturedFrame[] })[capturedFrames] ?? [],
    },
    legacyVisualPlan(options),
  )
}
