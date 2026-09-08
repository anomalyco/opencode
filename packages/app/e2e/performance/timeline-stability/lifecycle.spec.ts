import { expect, test } from "@playwright/test"
import {
  defineVisualRegions,
  mapVisualRegions,
  reportVisualStability,
  startVisualProbe,
  stopVisualProbe,
  visualPlan,
} from "../../utils/visual-stability"
import {
  assistantMessage,
  completedAssistantInfo,
  messageUpdated,
  partDelta,
  partUpdated,
  reasoningPart,
  setupTimeline,
  shell,
  status,
  textPart,
  userMessage,
  waitForVisualSettle,
} from "./fixture"

test.describe("timeline visual lifecycle stability", () => {
  test("streams empty, short, and long parallel shells to staggered completion", async ({ page }, testInfo) => {
    test.setTimeout(180_000)
    const ids = ["prt_parallel_01_empty", "prt_parallel_02_short", "prt_parallel_03_long"] as const
    const initial = ids.map((id) => shell(id, "running"))
    const followingID = "prt_parallel_04_following"
    const assistant = assistantMessage([...initial, textPart(followingID, "Following all parallel shells.")], {
      completed: false,
    })
    const timeline = await setupTimeline(page, {
      messages: [userMessage(), assistant],
      settings: { shellToolPartsExpanded: true, showReasoningSummaries: true },
      cpuRate: 4,
      eventRetry: 24,
      seedHistory: true,
    })
    await timeline.send(status("busy"), 150)
    for (const id of ids) await timeline.waitForPart(id)
    const scroller = page.locator(".scroll-view__viewport", {
      has: page.locator('[data-timeline-row="AssistantPart"]'),
    })
    await scroller.evaluate((element) => (element.scrollTop = element.scrollHeight))
    const regions = defineVisualRegions({
      prt_shell_empty: shellRegion(ids[0]),
      prt_shell_short: shellRegion(ids[1]),
      prt_shell_long: shellRegion(ids[2]),
      following: shellRegion(followingID),
    })
    await waitForVisualSettle(page, [`[data-timeline-part-id="${followingID}"]`])
    await startVisualProbe(page, regions)
    await timeline.sendAll([
      { event: partUpdated(shell(ids[0]!, "completed", "")), delay: 180 },
      { event: partUpdated(shell(ids[2]!, "running", lines(10))), delay: 70 },
      { event: partUpdated(shell(ids[1]!, "running", lines(2))), delay: 110 },
      { event: partUpdated(shell(ids[2]!, "running", lines(25))), delay: 80 },
      { event: partUpdated(shell(ids[1]!, "completed", lines(2))), delay: 260 },
      { event: partUpdated(shell(ids[2]!, "running", lines(50))), delay: 100 },
      { event: partUpdated(shell(ids[2]!, "completed", lines(50))), delay: 450 },
      { event: messageUpdated(completedAssistantInfo(assistant.info)), delay: 100 },
      { event: status("idle"), delay: 700 },
    ])
    const trace = await stopVisualProbe<keyof typeof regions>(page)
    await reportVisualStability(
      testInfo,
      "parallel-shells",
      trace,
      visualPlan(
        regions,
        [
          { type: "required", regions: ["prt_shell_empty", "prt_shell_short", "prt_shell_long", "following"] },
          { type: "unique", regions: ["prt_shell_empty", "prt_shell_short", "prt_shell_long"] },
          { type: "stable", regions: ["prt_shell_empty", "prt_shell_short", "prt_shell_long", "following"] },
          { type: "opacity", regions: "all" },
          { type: "continuity", regions: "all" },
          { type: "motion", regions: "all", maxPositionReversals: 0, maxReversals: 4 },
          { type: "label-stability", regions: "all" },
          { type: "preserve-bottom-anchor" },
          { type: "flow", regions: ["prt_shell_empty", "prt_shell_short", "prt_shell_long", "following"] },
        ],
        { perMarker: true },
      ),
    )
    await expect(page.locator(`[data-timeline-part-id="${ids[2]}"] [data-slot="bash-pre"]`)).toContainText("line 50")

    const short = page.locator(`[data-timeline-part-id="${ids[1]}"]`)
    await short.locator('[data-slot="collapsible-trigger"]').click()
    await expect(short.locator('[data-slot="collapsible-trigger"]')).toHaveAttribute("aria-expanded", "false")
    await timeline.send(partUpdated(textPart("prt_late_sibling", "A later sibling rerender.")), 250)
    await expect(short.locator('[data-slot="collapsible-trigger"]')).toHaveAttribute("aria-expanded", "false")
  })

  test("replaces thinking with streamed reasoning and text without a blank visible turn", async ({
    page,
  }, testInfo) => {
    const reasoningID = "prt_reasoning_visible"
    const textID = "prt_streamed_text"
    const assistant = assistantMessage([], { completed: false })
    const timeline = await setupTimeline(page, {
      messages: [userMessage(), assistant],
      settings: { showReasoningSummaries: true },
      cpuRate: 4,
    })
    await timeline.send(status("busy"), 120)
    await expect(page.locator('[data-timeline-row="Thinking"]')).toBeVisible()

    const regions = defineVisualRegions({
      thinking: { selector: '[data-timeline-row="Thinking"]' },
      reasoning: {
        selector: `[data-timeline-part-id="${reasoningID}"]`,
        closest: '[data-timeline-row="AssistantPart"]',
      },
      text: { selector: `[data-timeline-part-id="${textID}"]`, closest: '[data-timeline-row="AssistantPart"]' },
    })
    await startVisualProbe(page, regions)
    await timeline.send(partUpdated(reasoningPart(reasoningID, "")), 100)
    await expect(page.locator(`[data-timeline-part-id="${reasoningID}"]`)).toHaveCount(0)
    await timeline.send(partUpdated(reasoningPart(reasoningID, "## Planning\n\nChecking the visible timeline.")), 160)
    await timeline.waitForPart(reasoningID)
    await expect(page.locator('[data-timeline-row="Thinking"]')).toHaveCount(0)
    await timeline.send(partUpdated(textPart(textID, "Starting")), 100)
    await timeline.send(partDelta(textID, " **stable"), 90)
    await timeline.send(partDelta(textID, " output** with `code` and [a link"), 130)
    await timeline.send(partDelta(textID, "](https://example.com)."), 220)
    await timeline.send(messageUpdated(completedAssistantInfo(assistant.info)), 120)
    await timeline.send(status("idle"), 500)
    const trace = await stopVisualProbe<keyof typeof regions>(page)
    await reportVisualStability(
      testInfo,
      "reasoning-text-handoff",
      trace,
      visualPlan(regions, [
        { type: "required", regions: ["reasoning", "text"] },
        { type: "continuous-any", regions: ["thinking", "reasoning", "text"] },
        { type: "unique", regions: ["reasoning", "text"] },
        { type: "stable", regions: ["reasoning", "text"] },
        { type: "opacity", regions: "all" },
        { type: "continuity", regions: "all" },
        { type: "motion", regions: "all", maxReversals: 4 },
        { type: "label-stability", regions: "all" },
        { type: "flow", regions: ["reasoning", "text"] },
      ]),
    )
    await expect(page.locator(`[data-timeline-part-id="${textID}"]`)).toContainText("stable output")
  })
})

function lines(count: number) {
  return Array.from({ length: count }, (_, index) => `line ${index + 1}`).join("\n")
}

function shellRegion(id: string) {
  return { selector: `[data-timeline-part-id="${id}"]`, closest: '[data-timeline-row="AssistantPart"]' }
}
