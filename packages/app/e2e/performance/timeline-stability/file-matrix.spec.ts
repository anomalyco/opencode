import { test } from "@playwright/test"
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

const profiles = [
  {
    name: "edit",
    tool: "edit",
    input: { path: "src/edit.ts", oldString: "export const value = 1", newString: "export const value = 2" },
  },
  {
    name: "multi patch",
    tool: "patch",
    input: { patchText: "Update generated files" },
  },
] as const

for (const profile of profiles) {
  test(`stabilizes ${profile.name} streaming to completed`, async ({ page }, testInfo) => {
    const partID = `prt_file_matrix_${profiles.indexOf(profile)}`
    const followingID = `prt_file_matrix_following_${profiles.indexOf(profile)}`
    const timeline = await setupTimeline(page, {
      messages: [
        userMessage(),
        assistantMessage(
          [
            toolPart(partID, profile.tool, "streaming", profile.input),
            textPart(followingID, `Following ${profile.name}`),
          ],
          { completed: false },
        ),
      ],
      settings: { editToolPartsExpanded: true },
      cpuRate: 4,
    })
    await waitForVisualSettle(page, [
      `[data-timeline-part-id="${renderedPartID(partID)}"]`,
      `[data-timeline-part-id="${renderedPartID(followingID)}"]`,
    ])
    const regions = defineVisualRegions({
      tool: {
        selector: `[data-timeline-part-id="${renderedPartID(partID)}"]`,
        closest: '[data-timeline-row="AssistantPart"]',
      },
      following: {
        selector: `[data-timeline-part-id="${renderedPartID(followingID)}"]`,
        closest: '[data-timeline-row="AssistantPart"]',
      },
    })
    await startVisualProbe(page, regions)
    await timeline.send(partUpdated(toolPart(partID, profile.tool, "running", profile.input)), 180)
    await timeline.send(partUpdated(completedPart(partID, profile)), 900)
    const trace = await stopVisualProbe<keyof typeof regions>(page)
    await reportVisualStability(
      testInfo,
      `file-${profile.name}`,
      trace,
      visualPlan(
        regions,
        [
          { type: "required", regions: ["tool", "following"] },
          { type: "unique", regions: ["tool", "following"] },
          { type: "stable", regions: ["tool", "following"] },
          { type: "opacity", regions: "all" },
          { type: "continuity", regions: "all" },
          { type: "motion", regions: "all", maxPositionReversals: 0, maxReversals: 1 },
          { type: "label-stability", regions: "all" },
          { type: "preserve-bottom-anchor" },
          { type: "flow", regions: ["tool", "following"] },
        ],
        { perMarker: true },
      ),
    )
  })
}

function completedPart(partID: string, profile: (typeof profiles)[number]) {
  if (profile.tool === "edit") {
    return toolPart(partID, profile.tool, "completed", profile.input, {
      metadata: {
        files: [patchFile("src/edit.ts", "modified", 50)],
      },
    })
  }
  const files = [
    patchFile("src/a.ts", "modified", 20),
    patchFile("src/b.ts", "added", 20),
    patchFile("src/old.ts", "deleted", 20),
  ]
  return toolPart(partID, profile.tool, "completed", profile.input, { metadata: { files } })
}

function patchFile(file: string, status: "added" | "modified" | "deleted", lines: number) {
  const before = status === "added" ? "" : source(lines, false)
  const after = status === "deleted" ? "" : source(lines, true)
  return {
    file,
    status,
    patch: createTwoFilesPatch(`a/${file}`, `b/${file}`, before, after),
    additions: status === "deleted" ? 0 : lines,
    deletions: status === "added" ? 0 : lines,
  }
}

function source(count: number, changed: boolean) {
  return Array.from(
    { length: count },
    (_, index) => `export const value${index} = ${changed ? index + 1 : index}\n`,
  ).join("")
}
