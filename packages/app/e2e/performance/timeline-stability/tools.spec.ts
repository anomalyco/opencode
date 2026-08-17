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
  directory,
  partUpdated,
  session,
  sessionID,
  setupTimeline,
  status,
  textPart,
  toolPart,
  userMessage,
} from "./fixture"

test.describe("timeline tool state stability", () => {
  test("moves lightweight tools through pending, running, and completed without replacing rows", async ({
    page,
  }, testInfo) => {
    const ids = ["webfetch", "websearch", "task", "skill", "custom"] as const
    const inputs = {
      webfetch: { url: "https://example.com/docs" },
      websearch: { query: "timeline stability" },
      task: { description: "Inspect timeline", subagent_type: "explore" },
      skill: { name: "stability" },
      custom: { target: "timeline", depth: 2 },
    }
    const names = { webfetch: "webfetch", websearch: "websearch", task: "task", skill: "skill", custom: "mcp_probe" }
    const questionID = "prt_state_question"
    const todoID = "prt_state_todo"
    const initial = [
      ...ids.map((id) => toolPart(`prt_state_${id}`, names[id], "pending", inputs[id])),
      toolPart(questionID, "question", "pending", questionInput()),
      toolPart(todoID, "todowrite", "pending", { todos: [{ content: "Hidden", status: "pending" }] }),
      textPart("prt_state_following", "Following lightweight tools"),
    ]
    const childID = "ses_timeline_child"
    const timeline = await setupTimeline(page, {
      messages: [userMessage(), assistantMessage(initial, { completed: false })],
      sessions: [session(), session({ id: childID, parentID: sessionID, title: "Inspect timeline" })],
      cpuRate: 4,
    })
    await timeline.send(status("busy"), 120)
    for (const id of ids) await timeline.waitForPart(`prt_state_${id}`)
    await expect(page.locator(`[data-timeline-part-id="${questionID}"]`)).toHaveCount(0)
    await expect(page.locator(`[data-timeline-part-id="${todoID}"]`)).toHaveCount(0)

    const regionIDs = [
      "prt_state_webfetch",
      "prt_state_websearch",
      "prt_state_task",
      "prt_state_skill",
      "prt_state_custom",
    ] as const
    const regions = defineVisualRegions({
      prt_state_webfetch: toolRegion(regionIDs[0]),
      prt_state_websearch: toolRegion(regionIDs[1]),
      prt_state_task: toolRegion(regionIDs[2]),
      prt_state_skill: toolRegion(regionIDs[3]),
      prt_state_custom: toolRegion(regionIDs[4]),
    })
    await startVisualProbe(page, regions)
    for (const [index, id] of ids.entries()) {
      await timeline.send(
        partUpdated(toolPart(`prt_state_${id}`, names[id], "running", inputs[id])),
        [80, 240, 100, 360, 140][index],
      )
    }
    for (const [index, id] of ["skill", "webfetch", "custom", "task", "websearch"].entries()) {
      const key = id as (typeof ids)[number]
      const metadata = key === "task" ? { sessionId: childID } : key === "websearch" ? { provider: "exa" } : {}
      const output = key === "websearch" ? "Result https://example.com/result" : "Completed"
      await timeline.send(
        partUpdated(toolPart(`prt_state_${key}`, names[key], "completed", inputs[key], { metadata, output })),
        [110, 70, 280, 130, 420][index],
      )
    }
    await timeline.send(
      partUpdated(
        toolPart(questionID, "question", "completed", questionInput(), { metadata: { answers: [["Keep it stable"]] } }),
      ),
      350,
    )
    await timeline.waitForPart(questionID)
    await timeline.send(status("idle"), 500)
    const trace = await stopVisualProbe<keyof typeof regions>(page)
    await reportVisualStability(
      testInfo,
      "lightweight-tools",
      trace,
      visualPlan(regions, [
        { type: "required", regions: regionIDs },
        { type: "unique", regions: regionIDs },
        { type: "stable", regions: regionIDs },
        { type: "opacity", regions: "all" },
        { type: "continuity", regions: "all" },
        { type: "motion", regions: "all", maxReversals: 4 },
        { type: "label-stability", regions: "all" },
      ]),
    )
    await expect(page.locator(`[data-timeline-part-id="${questionID}"]`)).toContainText("Keep it stable")
    await expect(page.locator(`[data-timeline-part-id="${todoID}"]`)).toHaveCount(0)
    await expect(
      page.locator(`a[href$="/session/${childID}"]`, { has: page.locator('[data-component="task-tool-card"]') }),
    ).toBeVisible()
    await expect(page.getByRole("button", { name: /Exa Web Search/ })).toBeVisible()
  })

  test("keeps an expanded mixed context group stable through staggered completion and error", async ({
    page,
  }, testInfo) => {
    const ids = ["prt_ctx_01_read", "prt_ctx_02_glob", "prt_ctx_03_grep", "prt_ctx_04_list"]
    const tools = ["read", "glob", "grep", "list"]
    const inputs = [
      { filePath: "src/a.ts", offset: 0, limit: 120 },
      { path: directory, pattern: "**/*.ts" },
      { path: directory, pattern: "stability", include: "*.ts" },
      { path: "src" },
    ]
    const context = ids.map((id, index) => toolPart(id, tools[index]!, "pending", inputs[index]!))
    const timeline = await setupTimeline(page, {
      messages: [
        userMessage(),
        assistantMessage([...context, textPart("prt_ctx_following", "Following context")], { completed: false }),
      ],
      cpuRate: 4,
    })
    await timeline.send(status("busy"), 100)
    const groupSelector = `[data-timeline-part-ids="${ids.join(",")}"]`
    const group = page.locator(groupSelector)
    await expect(group).toBeVisible()
    await group.locator('[data-slot="collapsible-trigger"]').click()
    await expect(group.locator('[data-slot="collapsible-trigger"]')).toHaveAttribute("aria-expanded", "true")

    const regions = defineVisualRegions({
      status: {
        selector: `${groupSelector} [data-component="tool-status-title"]`,
        opacitySelectors: ['[data-slot="tool-status-active"]', '[data-slot="tool-status-done"]'],
      },
      context: { selector: groupSelector, closest: '[data-timeline-row="AssistantPart"]' },
      following: {
        selector: '[data-timeline-part-id="prt_ctx_following"]',
        closest: '[data-timeline-row="AssistantPart"]',
      },
    })
    await startVisualProbe(page, regions)
    for (const [index, delay] of [90, 260, 70, 380].entries()) {
      await timeline.send(partUpdated(toolPart(ids[index]!, tools[index]!, "running", inputs[index]!)), delay)
    }
    await timeline.send(partUpdated(toolPart(ids[1]!, tools[1]!, "completed", inputs[1]!)), 130)
    await timeline.send(partUpdated(toolPart(ids[3]!, tools[3]!, "completed", inputs[3]!)), 210)
    await timeline.send(
      partUpdated(toolPart(ids[0]!, tools[0]!, "error", inputs[0]!, { error: "Read interrupted" })),
      110,
    )
    await timeline.send(partUpdated(toolPart(ids[2]!, tools[2]!, "completed", inputs[2]!)), 250)
    await expect(group.locator('[data-component="tool-status-title"]')).toHaveAttribute("aria-label", "Explored")
    await timeline.send(status("idle"), 700)
    const trace = await stopVisualProbe<keyof typeof regions>(page)
    await reportVisualStability(
      testInfo,
      "mixed-context",
      trace,
      visualPlan(regions, [
        { type: "required", regions: ["context", "following"] },
        { type: "unique", regions: ["context"] },
        { type: "stable", regions: ["context"] },
        { type: "opacity", regions: "all" },
        { type: "continuity", regions: "all" },
        { type: "motion", regions: "all", maxReversals: 4 },
        { type: "label-stability", regions: "all" },
        { type: "flow", regions: ["context", "following"] },
      ]),
    )
    await expect(group.locator('[data-component="tool-status-title"]')).toHaveAttribute("aria-label", "Explored")
    await expect(group.locator('[data-slot="collapsible-trigger"]')).toHaveAttribute("aria-expanded", "true")
    await group.locator('[data-slot="collapsible-trigger"]').click()
    await expect(group.locator('[data-slot="collapsible-trigger"]')).toHaveAttribute("aria-expanded", "false")
    await timeline.send(partUpdated(textPart("prt_ctx_late_sibling", "Later sibling content")), 200)
    await expect(group.locator('[data-slot="collapsible-trigger"]')).toHaveAttribute("aria-expanded", "false")
    await group.locator('[data-slot="collapsible-trigger"]').click()
    await expect(group.locator('[data-slot="collapsible-trigger"]')).toHaveAttribute("aria-expanded", "true")
  })
})

function questionInput() {
  return { questions: [{ header: "Stability", question: "Keep it stable?", options: [] }] }
}

function toolRegion(id: string) {
  return { selector: `[data-timeline-part-id="${id}"]`, closest: '[data-timeline-row="AssistantPart"]' }
}
