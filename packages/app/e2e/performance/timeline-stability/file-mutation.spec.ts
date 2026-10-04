import { expect, test } from "@playwright/test"
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
  textPart,
  toolPart,
  userMessage,
  waitForVisualSettle,
} from "./fixture"

test("adds patch files incrementally without resetting outer expansion", async ({ page }, testInfo) => {
  const patchID = "prt_incremental_01_patch"
  const followingID = "prt_incremental_02_following"
  const first = patchFile("src/a.ts", "update")
  const timeline = await setupTimeline(page, {
    messages: [
      userMessage(),
      assistantMessage(
        [
          toolPart(patchID, "apply_patch", "running", { files: [first.filePath] }, { metadata: { files: [first] } }),
          textPart(followingID, "Following incremental patch"),
        ],
        { completed: false },
      ),
    ],
    settings: { editToolPartsExpanded: true },
    cpuRate: 4,
    seedHistory: true,
  })
  const trigger = page.locator(`[data-timeline-part-id="${patchID}"] [data-slot="collapsible-trigger"]`).first()
  await expect(trigger).toHaveAttribute("aria-expanded", "true")
  await waitForVisualSettle(page, [`[data-timeline-part-id="${patchID}"]`, `[data-timeline-part-id="${followingID}"]`])
  const regions = defineVisualRegions({
    patch: { selector: `[data-timeline-part-id="${patchID}"]`, closest: '[data-timeline-row="AssistantPart"]' },
    following: { selector: `[data-timeline-part-id="${followingID}"]`, closest: '[data-timeline-row="AssistantPart"]' },
  })
  await startVisualProbe(page, regions)
  const second = patchFile("src/b.ts", "add")
  const third = patchFile("src/old.ts", "delete")
  await timeline.send(
    partUpdated(
      toolPart(
        patchID,
        "apply_patch",
        "running",
        { files: [first.filePath, second.filePath] },
        { metadata: { files: [first, second] } },
      ),
    ),
    240,
  )
  await timeline.send(
    partUpdated(
      toolPart(
        patchID,
        "apply_patch",
        "completed",
        { files: [first.filePath, second.filePath, third.filePath] },
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

function patchFile(filePath: string, type: "add" | "update" | "delete") {
  return {
    filePath,
    relativePath: filePath,
    type,
    additions: type === "delete" ? 0 : 4,
    deletions: type === "add" ? 0 : 3,
    before: type === "add" ? undefined : source(false),
    after: type === "delete" ? undefined : source(true),
  }
}

function source(changed: boolean) {
  return Array.from({ length: 12 }, (_, index) => `export const value${index} = ${changed ? index + 1 : index}\n`).join(
    "",
  )
}
