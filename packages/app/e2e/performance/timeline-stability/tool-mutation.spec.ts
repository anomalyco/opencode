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
  session,
  sessionID,
  renderedPartID,
  setupTimeline,
  toolPart,
  userMessage,
} from "./fixture"

test("adds a subagent child-session link without replacing the row", async ({ page }, testInfo) => {
  const taskID = "prt_subagent_link"
  const childID = "ses_subagent_child"
  const input = { description: "Inspect child", agent: "explore", prompt: "Inspect the child Session." }
  const timeline = await setupTimeline(page, {
    messages: [userMessage(), assistantMessage([toolPart(taskID, "subagent", "running", input)], { completed: false })],
    sessions: [session(), session({ id: childID, parentID: sessionID, title: "Inspect child" })],
    cpuRate: 4,
  })
  const regions = defineVisualRegions({
    subagent: { selector: `[data-timeline-part-id="${renderedPartID(taskID)}"] [data-slot="collapsible-trigger"]` },
  })
  await startVisualProbe(page, regions)
  await timeline.send(
    partUpdated(toolPart(taskID, "subagent", "completed", input, { metadata: { sessionID: childID } })),
    500,
  )
  const trace = await stopVisualProbe<keyof typeof regions>(page)
  await reportVisualStability(
    testInfo,
    "subagent-link",
    trace,
    visualPlan(regions, [
      { type: "required", regions: ["subagent"] },
      { type: "unique", regions: ["subagent"] },
      { type: "stable", regions: ["subagent"] },
      { type: "opacity", regions: "all" },
      { type: "continuity", regions: "all" },
      { type: "motion", regions: "all", maxPositionReversals: 0 },
      { type: "label-stability", regions: "all" },
    ]),
  )
  await expect(
    page.locator(`a[href$="/session/${childID}"]`, { has: page.locator('[data-component="task-tool-card"]') }),
  ).toBeVisible()
})
