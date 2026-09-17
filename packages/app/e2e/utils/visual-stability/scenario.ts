import type { Page, TestInfo } from "@playwright/test"
import type { VisualPlan } from "./invariant"
import { startVisualProbe, stopVisualProbe } from "./probe"
import type { VisualRegionDefinition } from "./regions"
import { reportVisualStability } from "./reporter"

export async function runVisualStabilityScenario<const Regions extends Record<string, VisualRegionDefinition>>(input: {
  page: Page
  testInfo: TestInfo
  name: string
  regions: Regions
  plan: VisualPlan<Extract<keyof Regions, string>>
  run: () => Promise<void>
}) {
  await startVisualProbe(input.page, input.regions)
  await input.run()
  const result = await stopVisualProbe<Extract<keyof Regions, string>>(input.page)
  await reportVisualStability(input.testInfo, input.name, result, input.plan)
  return result
}
