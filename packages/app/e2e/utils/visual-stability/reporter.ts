import { expect, type TestInfo } from "@playwright/test"
import { writeFile } from "node:fs/promises"
import { analyzeVisualObservations, analyzeVisualTraceByMarker } from "./analyzer"
import type { VisualPlan } from "./invariant"
import type { VisualProbeResult } from "./model"

export async function reportVisualStability<RegionName extends string>(
  testInfo: TestInfo,
  name: string,
  result: VisualProbeResult<RegionName>,
  plan: VisualPlan<RegionName>,
) {
  const trace = { markers: result.markers, samples: result.samples }
  const issues = plan.perMarker
    ? analyzeVisualTraceByMarker(trace, plan)
    : analyzeVisualObservations(result.samples, plan)
  const tracePath = testInfo.outputPath(`${name}-visual-trace.json`)
  const issuesPath = testInfo.outputPath(`${name}-visual-issues.json`)
  await writeFile(tracePath, JSON.stringify(trace, null, 2))
  await writeFile(
    issuesPath,
    JSON.stringify({ issues, markers: result.markers, capturedFrameCount: result.frames.length }, null, 2),
  )
  await testInfo.attach(`${name}-visual-trace`, { path: tracePath, contentType: "application/json" })
  await testInfo.attach(`${name}-visual-issues`, { path: issuesPath, contentType: "application/json" })
  if (issues.length) await attachViolationFrames(testInfo, name, result, issues)
  expect(issues, `${name}: ${issues.join("\n")}`).toEqual([])
}

async function attachViolationFrames<RegionName extends string>(
  testInfo: TestInfo,
  name: string,
  result: VisualProbeResult<RegionName>,
  issues: string[],
) {
  if (result.frames.length === 0) return
  const targets = [
    ...new Set(
      issues.flatMap((issue) => {
        const match = issue.match(/ at (\d+)ms/)
        if (match) return [Number(match[1])]
        const marker = result.markers.find((item) => issue.startsWith(`${item.label}:`))
        return marker ? [marker.at] : []
      }),
    ),
  ].slice(0, 6)
  for (const [violation, target] of targets.entries()) {
    const nearest = result.frames.reduce(
      (best, frame, index) => (Math.abs(frame.at - target) < Math.abs(result.frames[best]!.at - target) ? index : best),
      0,
    )
    for (const [label, index] of [
      ["before", Math.max(0, nearest - 1)],
      ["violation", nearest],
      ["after", Math.min(result.frames.length - 1, nearest + 1)],
    ] as const) {
      await testInfo.attach(`${name}-${violation + 1}-${label}-${Math.round(result.frames[index]!.at)}ms`, {
        body: Buffer.from(result.frames[index]!.data, "base64"),
        contentType: "image/jpeg",
      })
    }
  }
}
