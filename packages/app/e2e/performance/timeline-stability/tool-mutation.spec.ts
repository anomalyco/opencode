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

test("adds a task child-session link without replacing the task row", async ({ page }, testInfo) => {
  const taskID = "prt_task_link"
  const childID = "ses_task_child"
  const input = { description: "Inspect child", subagent_type: "explore" }
  const timeline = await setupTimeline(page, {
    messages: [userMessage(), assistantMessage([toolPart(taskID, "task", "running", input)], { completed: false })],
    sessions: [session(), session({ id: childID, parentID: sessionID, title: "Inspect child" })],
    cpuRate: 4,
  })
  const regions = defineVisualRegions({
    task: { selector: `[data-timeline-part-id="${renderedPartID(taskID)}"] [data-slot="collapsible-trigger"]` },
  })
  await startVisualProbe(page, regions)
  await timeline.send(
    partUpdated(toolPart(taskID, "task", "completed", input, { metadata: { sessionId: childID } })),
    500,
  )
  const trace = await stopVisualProbe<keyof typeof regions>(page)
  await reportVisualStability(
    testInfo,
    "task-link",
    trace,
    visualPlan(regions, [
      { type: "required", regions: ["task"] },
      { type: "unique", regions: ["task"] },
      { type: "stable", regions: ["task"] },
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
