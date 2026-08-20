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
  completedAssistantInfo,
  event,
  messageUpdated,
  partDelta,
  partUpdated,
  renderedPartID,
  setupTimeline,
  shell,
  status,
  textPart,
  toolPart,
  userMessage,
} from "./fixture"

test("streams text through growth, canonical replacement, and completion", async ({ page }, testInfo) => {
  const textID = "prt_text_reconcile"
  const followingID = "prt_text_reconcile_following"
  const assistant = assistantMessage([textPart(textID, "Starting"), textPart(followingID, "Following text row")], {
    completed: false,
  })
  const timeline = await setupTimeline(page, { messages: [userMessage(), assistant], cpuRate: 4 })
  const regions = defineVisualRegions({
    text: {
      selector: `[data-timeline-part-id="${renderedPartID(textID)}"]`,
      closest: '[data-timeline-row="AssistantPart"]',
    },
    following: {
      selector: `[data-timeline-part-id="${renderedPartID(followingID)}"]`,
      closest: '[data-timeline-row="AssistantPart"]',
    },
  })
  await startVisualProbe(page, regions)
  await timeline.send(partDelta(textID, " streamed content"), 100)
  await timeline.send(partDelta(textID, "\n\n- item one\n- item two\n- item three"), 180)
  await timeline.send(partUpdated(textPart(textID, "Canonical replacement with a shorter final paragraph.")), 200)
  await timeline.send(messageUpdated(completedAssistantInfo(assistant)), 500)
  const trace = await stopVisualProbe<keyof typeof regions>(page)
  await reportVisualStability(
    testInfo,
    "text-reconcile",
    trace,
    visualPlan(regions, [
      { type: "required", regions: ["text", "following"] },
      { type: "unique", regions: ["text", "following"] },
      { type: "stable", regions: ["text", "following"] },
      { type: "opacity", regions: "all" },
      { type: "continuity", regions: "all" },
      { type: "motion", regions: "all", maxPositionReversals: 1, maxReversals: 2 },
      { type: "label-stability", regions: "all" },
      { type: "preserve-bottom-anchor" },
      { type: "flow", regions: ["text", "following"] },
    ]),
  )
})

test("inserts a completed question between stable rows", async ({ page }, testInfo) => {
  const firstID = "prt_question_01_first"
  const questionID = "prt_question_02_hidden"
  const lastID = "prt_question_03_last"
  const input = { questions: [{ header: "Choice", question: "Keep stable?", options: [] }] }
  const timeline = await setupTimeline(page, {
    messages: [
      userMessage(),
      assistantMessage(
        [
          textPart(firstID, "Before question"),
          toolPart(questionID, "question", "running", input),
          textPart(lastID, "After question"),
        ],
        { completed: false },
      ),
    ],
    cpuRate: 4,
  })
  await expect(page.locator(`[data-timeline-part-id="${renderedPartID(questionID)}"]`)).toHaveCount(0)
  const regions = defineVisualRegions({
    first: {
      selector: `[data-timeline-part-id="${renderedPartID(firstID)}"]`,
      closest: '[data-timeline-row="AssistantPart"]',
    },
    last: {
      selector: `[data-timeline-part-id="${renderedPartID(lastID)}"]`,
      closest: '[data-timeline-row="AssistantPart"]',
    },
  })
  await startVisualProbe(page, regions)
  await timeline.send(
    partUpdated(toolPart(questionID, "question", "completed", input, { metadata: { answers: [["Yes"]] } })),
    600,
  )
  await expect(page.locator(`[data-timeline-part-id="${renderedPartID(questionID)}"]`)).toBeVisible()
  const trace = await stopVisualProbe<keyof typeof regions>(page)
  await reportVisualStability(testInfo, "question-insert", trace, stablePairPlan(regions, 0))
})

test("replaces thinking with an assistant error without a blank turn", async ({ page }, testInfo) => {
  const assistant = assistantMessage([], { completed: false })
  const timeline = await setupTimeline(page, { messages: [userMessage(), assistant], cpuRate: 4 })
  await timeline.send(status("busy"), 150)
  await expect(page.locator('[data-timeline-row="Thinking"]')).toBeVisible()
  const regions = defineVisualRegions({
    thinking: { selector: '[data-timeline-row="Thinking"]' },
    error: { selector: '[data-timeline-row="Error"]' },
  })
  await startVisualProbe(page, regions)
  await timeline.send(
    messageUpdated({
      ...assistant,
      error: { type: "APIError", message: "Provider failed visibly" },
    }),
    500,
  )
  await expect(page.locator('[data-timeline-row="Thinking"]')).toHaveCount(0)
  await expect(page.locator('[data-timeline-row="Error"]')).toContainText("Provider failed visibly")
  const trace = await stopVisualProbe<keyof typeof regions>(page)
  await reportVisualStability(
    testInfo,
    "thinking-error",
    trace,
    visualPlan(regions, [
      { type: "required", regions: ["thinking", "error"] },
      { type: "continuous-any", regions: ["thinking", "error"] },
      { type: "unique", regions: ["thinking", "error"] },
      { type: "opacity", regions: "all" },
      { type: "continuity", regions: "all" },
      { type: "motion", regions: "all" },
      { type: "label-stability", regions: "all" },
    ]),
  )
})

test("updates retry attempts and long provider messages without remounting the retry row", async ({
  page,
}, testInfo) => {
  const timeline = await setupTimeline(page, {
    messages: [userMessage(), assistantMessage([], { completed: false })],
    cpuRate: 4,
  })
  await timeline.send(status("retry", 1), 120)
  await expect(page.locator('[data-timeline-row="Retry"]')).toBeVisible()
  const regions = defineVisualRegions({
    retry: { selector: '[data-timeline-row="Retry"]' },
  })
  await startVisualProbe(page, regions)
  await timeline.send(
    event("session.status", {
      sessionID: "ses_timeline_stability",
      status: {
        type: "retry",
        attempt: 2,
        message: "A very long provider retry message ".repeat(8),
        next: Date.now() + 10_000,
      },
    }),
    300,
  )
  await timeline.send(status("retry", 3), 300)
  const trace = await stopVisualProbe<keyof typeof regions>(page)
  await reportVisualStability(
    testInfo,
    "retry-evolution",
    trace,
    visualPlan(
      regions,
      [
        { type: "required", regions: ["retry"] },
        { type: "unique", regions: ["retry"] },
        { type: "stable", regions: ["retry"] },
        { type: "opacity", regions: "all" },
        { type: "continuity", regions: "all" },
        { type: "motion", regions: "all", maxPositionReversals: 0 },
        { type: "label-stability", regions: "all" },
      ],
      { perMarker: true },
    ),
  )
})

function stablePairPlan(
  regions: Record<"first" | "last", { selector: string; closest?: string }>,
  maxPositionReversals: number,
) {
  return visualPlan(regions, [
    { type: "required", regions: ["first", "last"] },
    { type: "unique", regions: ["first", "last"] },
    { type: "stable", regions: ["first", "last"] },
    { type: "opacity", regions: "all" },
    { type: "continuity", regions: "all" },
    { type: "motion", regions: "all", maxPositionReversals },
    { type: "label-stability", regions: "all" },
  ])
}
