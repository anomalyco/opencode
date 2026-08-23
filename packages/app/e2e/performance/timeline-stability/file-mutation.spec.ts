import { expect, test } from "@playwright/test"
import { createTwoFilesPatch } from "diff"
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
  renderedPartID,
  setupTimeline,
  textPart,
  toolPart,
  userMessage,
  waitForVisualSettle,
} from "./fixture"

test("adds patch files incrementally without resetting outer expansion", async ({ page }, testInfo) => {
  const patchID = "prt_incremental_01_patch"
  const followingID = "prt_incremental_02_following"
  const first = patchFile("src/a.ts", "modified")
  const timeline = await setupTimeline(page, {
    messages: [
      userMessage(),
      assistantMessage(
        [
          toolPart(patchID, "patch", "running", { patchText: "Update files" }, { metadata: { files: [first] } }),
          textPart(followingID, "Following incremental patch"),
        ],
        { completed: false },
      ),
    ],
    settings: { editToolPartsExpanded: true },
    cpuRate: 4,
    seedHistory: true,
  })
  const trigger = page
    .locator(`[data-timeline-part-id="${renderedPartID(patchID)}"] [data-slot="collapsible-trigger"]`)
    .first()
  await expect(trigger).toHaveAttribute("aria-expanded", "true")
  await waitForVisualSettle(page, [
    `[data-timeline-part-id="${renderedPartID(patchID)}"]`,
    `[data-timeline-part-id="${renderedPartID(followingID)}"]`,
  ])
  const regions = defineVisualRegions({
    patch: {
      selector: `[data-timeline-part-id="${renderedPartID(patchID)}"]`,
      closest: '[data-timeline-row="AssistantPart"]',
    },
    following: {
      selector: `[data-timeline-part-id="${renderedPartID(followingID)}"]`,
      closest: '[data-timeline-row="AssistantPart"]',
    },
  })
  await startVisualProbe(page, regions)
  const second = patchFile("src/b.ts", "added")
  const third = patchFile("src/old.ts", "deleted")
  await timeline.send(
    partUpdated(
      toolPart(
        patchID,
        "patch",
        "running",
        { patchText: "Update files" },
        { metadata: { files: [first, second] } },
      ),
    ),
    240,
  )
  await timeline.send(
    partUpdated(
      toolPart(
        patchID,
        "patch",
        "completed",
        { patchText: "Update files" },
        { metadata: { files: [first, second, third] } },
      ),
    ),
    800,
  )
  const trace = await stopVisualProbe<keyof typeof regions>(page)
  await reportVisualStability(
    testInfo,
    "incremental-patch",
    trace,
    visualPlan(
      regions,
      [
        { type: "required", regions: ["patch", "following"] },
        { type: "unique", regions: ["patch", "following"] },
        { type: "stable", regions: ["patch", "following"] },
        { type: "opacity", regions: "all" },
        { type: "continuity", regions: "all" },
        { type: "motion", regions: ["following"], maxPositionReversals: 0 },
        { type: "label-stability", regions: "all" },
        { type: "preserve-bottom-anchor" },
        { type: "flow", regions: ["patch", "following"] },
      ],
      { perMarker: true },
    ),
  )
  await expect(trigger).toHaveAttribute("aria-expanded", "true")
  await expect(page.locator('[data-scope="apply-patch"] [data-type="delete"]')).toBeVisible()
})

function patchFile(file: string, status: "added" | "modified" | "deleted") {
  const before = status === "added" ? "" : source(false)
  const after = status === "deleted" ? "" : source(true)
  return {
    file,
    status,
    patch: createTwoFilesPatch(`a/${file}`, `b/${file}`, before, after),
    additions: status === "deleted" ? 0 : 4,
    deletions: status === "added" ? 0 : 3,
  }
}

function source(changed: boolean) {
  return Array.from({ length: 12 }, (_, index) => `export const value${index} = ${changed ? index + 1 : index}\n`).join(
    "",
  )
}
