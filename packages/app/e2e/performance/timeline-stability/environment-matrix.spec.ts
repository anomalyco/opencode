import { test } from "@playwright/test"
import {
  defineVisualRegions,
  reportVisualStability,
  startVisualProbe,
  stopVisualProbe,
  visualPlan,
} from "../../utils/visual-stability"
import {
  assistantMessage,
  partUpdated,
  setupTimeline,
  shell,
  textPart,
  userMessage,
  waitForVisualSettle,
} from "./fixture"

// Fractional scaling exercises different browser rounding than the baseline.
for (const deviceScaleFactor of [1, 1.25]) {
  test(`keeps shell growth ordered at device scale ${deviceScaleFactor}`, async ({ page }, testInfo) => {
    const shellID = `prt_dpr_${String(deviceScaleFactor).replace(".", "_")}_01_shell`
    const followingID = `prt_dpr_${String(deviceScaleFactor).replace(".", "_")}_02_following`
    const timeline = await setupTimeline(page, {
      messages: [
        userMessage(),
        assistantMessage([shell(shellID, "running"), textPart(followingID, "Following scaled shell")], {
          completed: false,
        }),
      ],
      settings: { shellToolPartsExpanded: true },
      cpuRate: 4,
      deviceScaleFactor,
      seedHistory: true,
    })
    await waitForVisualSettle(page, [
      `[data-timeline-part-id="${shellID}"]`,
      `[data-timeline-part-id="${followingID}"]`,
    ])
    const regions = defineVisualRegions({
      shell: { selector: `[data-timeline-part-id="${shellID}"]`, closest: '[data-timeline-row="AssistantPart"]' },
      following: {
        selector: `[data-timeline-part-id="${followingID}"]`,
        closest: '[data-timeline-row="AssistantPart"]',
      },
    })
    await startVisualProbe(page, regions)
    await timeline.send(partUpdated(shell(shellID, "running", lines(20))), 180)
    await timeline.send(partUpdated(shell(shellID, "completed", lines(20))), 500)
    const trace = await stopVisualProbe<keyof typeof regions>(page)
    await reportVisualStability(testInfo, `dpr-${deviceScaleFactor}`, trace, shellPlan(regions))
  })
}

for (const reducedMotion of [true]) {
  test(`keeps shell and status transitions ordered with reduced motion ${reducedMotion}`, async ({
    page,
  }, testInfo) => {
    const shellID = `prt_motion_${reducedMotion}_01_shell`
    const followingID = `prt_motion_${reducedMotion}_02_following`
    const timeline = await setupTimeline(page, {
      messages: [
        userMessage(),
        assistantMessage([shell(shellID, "running"), textPart(followingID, "Following motion profile")], {
          completed: false,
        }),
      ],
      settings: { shellToolPartsExpanded: true },
      reducedMotion,
      cpuRate: 4,
      seedHistory: true,
    })
    await waitForVisualSettle(page, [
      `[data-timeline-part-id="${shellID}"]`,
      `[data-timeline-part-id="${followingID}"]`,
    ])
    const regions = defineVisualRegions({
      shell: { selector: `[data-timeline-part-id="${shellID}"]`, closest: '[data-timeline-row="AssistantPart"]' },
      following: {
        selector: `[data-timeline-part-id="${followingID}"]`,
        closest: '[data-timeline-row="AssistantPart"]',
      },
    })
    await startVisualProbe(page, regions)
    await timeline.send(partUpdated(shell(shellID, "completed", lines(10))), 500)
    const trace = await stopVisualProbe<keyof typeof regions>(page)
    await reportVisualStability(testInfo, `reduced-motion-${reducedMotion}`, trace, shellPlan(regions))
  })
}

function lines(count: number) {
  return Array.from({ length: count }, (_, index) => `line ${index + 1}`).join("\n")
}

function shellPlan<Regions extends ReturnType<typeof defineVisualRegions>>(
  regions: Regions & Record<"shell" | "following", { selector: string }>,
) {
  return visualPlan(
    regions,
    [
      { type: "required", regions: ["shell", "following"] },
      { type: "unique", regions: ["shell", "following"] },
      { type: "stable", regions: ["shell", "following"] },
      { type: "opacity", regions: "all" },
      { type: "continuity", regions: "all" },
      { type: "motion", regions: "all", maxPositionReversals: 0 },
      { type: "label-stability", regions: "all" },
      { type: "preserve-bottom-anchor" },
      { type: "flow", regions: ["shell", "following"] },
    ],
    { perMarker: true },
  )
}
