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
  setupTimeline,
  textPart,
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
    task: { selector: `[data-timeline-part-id="${taskID}"] [data-slot="collapsible-trigger"]` },
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

test("changes generic tool arguments without replacing the row", async ({ page }, testInfo) => {
  const toolID = "prt_generic_mutation"
  const followingID = "prt_generic_mutation_following"
  const timeline = await setupTimeline(page, {
    messages: [
      userMessage(),
      assistantMessage(
        [
          toolPart(toolID, "mcp_probe", "running", { target: "one", count: 1 }),
          textPart(followingID, "Following generic tool"),
        ],
        { completed: false },
      ),
    ],
    cpuRate: 4,
  })
  const regions = defineVisualRegions({
    tool: { selector: `[data-timeline-part-id="${toolID}"]`, closest: '[data-timeline-row="AssistantPart"]' },
    following: { selector: `[data-timeline-part-id="${followingID}"]`, closest: '[data-timeline-row="AssistantPart"]' },
  })
  await startVisualProbe(page, regions)
  await timeline.send(
    partUpdated(toolPart(toolID, "mcp_probe", "running", { target: "two", count: 2, mode: "deep" })),
    200,
  )
  await timeline.send(
    partUpdated(toolPart(toolID, "mcp_probe", "completed", { target: "two", count: 2, mode: "deep" })),
    400,
  )
  const trace = await stopVisualProbe<keyof typeof regions>(page)
  await reportVisualStability(
    testInfo,
    "generic-mutation",
    trace,
    visualPlan(
      regions,
      [
        { type: "required", regions: ["tool", "following"] },
        { type: "unique", regions: ["tool", "following"] },
        { type: "stable", regions: ["tool", "following"] },
        { type: "opacity", regions: "all" },
        { type: "continuity", regions: "all" },
        { type: "motion", regions: "all", maxPositionReversals: 0 },
        { type: "label-stability", regions: "all" },
        { type: "flow", regions: ["tool", "following"] },
      ],
      { perMarker: true },
    ),
  )
})
