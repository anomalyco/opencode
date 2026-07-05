import { expect, test } from "@playwright/test"
import {
  defineVisualRegions,
  reportVisualStability,
  startVisualProbe,
  stopVisualProbe,
  visualPlan,
} from "../../utils/visual-stability"
import { assistantMessage, setupTimeline, shell, textPart, toolPart, userMessage, waitForVisualSettle } from "./fixture"

test("expands and collapses a long completed shell without overlap", async ({ page }, testInfo) => {
  const shellID = "prt_interaction_01_shell"
  const followingID = "prt_interaction_02_following"
  await setupTimeline(page, {
    messages: [
      userMessage(),
      assistantMessage([shell(shellID, "completed", lines(50)), textPart(followingID, "Following shell expansion")]),
    ],
    settings: { shellToolPartsExpanded: false },
    cpuRate: 4,
    seedHistory: true,
  })
  const trigger = page.locator(`[data-timeline-part-id="${shellID}"] [data-slot="collapsible-trigger"]`)
  await waitForVisualSettle(page, [`[data-timeline-part-id="${shellID}"]`, `[data-timeline-part-id="${followingID}"]`])
  const regions = defineVisualRegions({
    shell: { selector: `[data-timeline-part-id="${shellID}"]`, closest: '[data-timeline-row="AssistantPart"]' },
    following: { selector: `[data-timeline-part-id="${followingID}"]`, closest: '[data-timeline-row="AssistantPart"]' },
  })
  const plan = visualPlan(regions, [
    { type: "required", regions: ["shell", "following"] },
    { type: "unique", regions: ["shell", "following"] },
    { type: "stable", regions: ["shell", "following"] },
    { type: "opacity", regions: "all" },
    { type: "continuity", regions: "all" },
    { type: "motion", regions: "all", maxPositionReversals: 0 },
    { type: "label-stability", regions: "all" },
    { type: "preserve-bottom-anchor" },
    { type: "flow", regions: ["shell", "following"] },
  ])
  await startVisualProbe(page, regions)
  await trigger.click()
  await expect(trigger).toHaveAttribute("aria-expanded", "true")
  await page.waitForTimeout(500)
  const expanded = await stopVisualProbe<keyof typeof regions>(page)
  await reportVisualStability(testInfo, "shell-expand", expanded, plan)

  await startVisualProbe(page, regions)
  await trigger.click()
  await expect(trigger).toHaveAttribute("aria-expanded", "false")
  await page.waitForTimeout(500)
  const collapsed = await stopVisualProbe<keyof typeof regions>(page)
  await reportVisualStability(testInfo, "shell-collapse", collapsed, plan)
})

test("expands and collapses a completed context group without overlap", async ({ page }, testInfo) => {
  const ids = [
    "prt_interaction_01_read",
    "prt_interaction_02_glob",
    "prt_interaction_03_grep",
    "prt_interaction_04_list",
  ]
  const group = `[data-timeline-part-ids="${ids.join(",")}"]`
  const followingID = "prt_interaction_context_following"
  await setupTimeline(page, {
    messages: [
      userMessage(),
      assistantMessage([
        toolPart(ids[0]!, "read", "completed", { filePath: "src/a.ts" }),
        toolPart(ids[1]!, "glob", "completed", { path: ".", pattern: "**/*.ts" }),
        toolPart(ids[2]!, "grep", "completed", { path: ".", pattern: "stable" }),
        toolPart(ids[3]!, "list", "completed", { path: "src" }),
        textPart(followingID, "Following context expansion"),
      ]),
    ],
    cpuRate: 4,
    seedHistory: true,
  })
  const trigger = page.locator(`${group} [data-slot="collapsible-trigger"]`)
  await waitForVisualSettle(page, [group, `[data-timeline-part-id="${followingID}"]`])
  for (const [name, expanded] of [
    ["context-expand", true],
    ["context-collapse", false],
    ["context-reexpand", true],
  ] as const) {
    const regions = defineVisualRegions({
      context: { selector: group, closest: '[data-timeline-row="AssistantPart"]' },
      following: {
        selector: `[data-timeline-part-id="${followingID}"]`,
        closest: '[data-timeline-row="AssistantPart"]',
      },
    })
    await startVisualProbe(page, regions)
    await trigger.click()
    await expect(trigger).toHaveAttribute("aria-expanded", String(expanded))
    await page.waitForTimeout(500)
    const trace = await stopVisualProbe<keyof typeof regions>(page)
    await reportVisualStability(
      testInfo,
      name,
      trace,
      visualPlan(regions, [
        { type: "required", regions: ["context", "following"] },
        { type: "unique", regions: ["context", "following"] },
        { type: "stable", regions: ["context", "following"] },
        { type: "opacity", regions: "all" },
        { type: "continuity", regions: "all" },
        { type: "motion", regions: "all", maxPositionReversals: 0 },
        { type: "label-stability", regions: "all" },
        { type: "preserve-bottom-anchor" },
        { type: "flow", regions: ["context", "following"] },
      ]),
    )
  }
})

test("expands and collapses an edit diff without moving twice", async ({ page }, testInfo) => {
  const editID = "prt_interaction_edit"
  const followingID = "prt_interaction_edit_following"
  await setupTimeline(page, {
    messages: [
      userMessage(),
      assistantMessage([
        toolPart(
          editID,
          "edit",
          "completed",
          { filePath: "src/edit.ts" },
          {
            metadata: {
              filediff: {
                file: "src/edit.ts",
                additions: 40,
                deletions: 40,
                before: source(40, false),
                after: source(40, true),
              },
            },
          },
        ),
        textPart(followingID, "Following edit expansion"),
      ]),
    ],
    settings: { editToolPartsExpanded: false },
    cpuRate: 4,
    seedHistory: true,
  })
  const trigger = page.locator(`[data-timeline-part-id="${editID}"] [data-slot="collapsible-trigger"]`).first()
  await waitForVisualSettle(page, [`[data-timeline-part-id="${editID}"]`, `[data-timeline-part-id="${followingID}"]`])
  const regions = defineVisualRegions({
    edit: { selector: `[data-timeline-part-id="${editID}"]`, closest: '[data-timeline-row="AssistantPart"]' },
    following: { selector: `[data-timeline-part-id="${followingID}"]`, closest: '[data-timeline-row="AssistantPart"]' },
  })
  await startVisualProbe(page, regions)
  await trigger.click()
  await expect(trigger).toHaveAttribute("aria-expanded", "true")
  await page.waitForTimeout(900)
  const trace = await stopVisualProbe<keyof typeof regions>(page)
  await reportVisualStability(
    testInfo,
    "edit-expand",
    trace,
    visualPlan(regions, [
      { type: "required", regions: ["edit", "following"] },
      { type: "unique", regions: ["edit", "following"] },
      { type: "stable", regions: ["edit", "following"] },
      { type: "opacity", regions: "all" },
      { type: "continuity", regions: "all" },
      { type: "motion", regions: "all", maxPositionReversals: 0, maxReversals: 1 },
      { type: "label-stability", regions: "all" },
      { type: "preserve-bottom-anchor" },
      { type: "flow", regions: ["edit", "following"] },
    ]),
  )
})

test("shows all and expands historical diff summary without overlap", async ({ page }, testInfo) => {
  const firstUser = userMessage(undefined, {
    summary: {
      diffs: Array.from({ length: 12 }, (_, index) => ({
        file: `src/diff-${index}.ts`,
        additions: 1,
        deletions: 1,
        patch: `@@ -1 +1 @@\n-export const value = ${index}\n+export const value = ${index + 1}`,
      })),
    },
  })
  const nextUserID = "msg_2000_diff_interaction_user"
  await setupTimeline(page, {
    messages: [
      firstUser,
      assistantMessage(),
      userMessage(undefined, { id: nextUserID, created: 1700000010000 }),
      assistantMessage([], {
        id: "msg_2001_diff_interaction_assistant",
        parentID: nextUserID,
        created: 1700000011000,
      }),
    ],
    cpuRate: 4,
  })
  const scroller = page.locator(".scroll-view__viewport", { has: page.locator("[data-timeline-row]") })
  await scroller.evaluate((element) => (element.scrollTop = 0))
  const diff = page.locator('[data-timeline-row="DiffSummary"]')
  const following = page.locator(`[data-message-id="${nextUserID}"]`).first()
  await expect(diff).toBeVisible()
  const regions = defineVisualRegions({
    diff: { selector: '[data-timeline-row="DiffSummary"]' },
    following: { selector: `[data-message-id="${nextUserID}"]` },
  })
  await startVisualProbe(page, regions)
  await page.getByText(/show all/i).click()
  await page.waitForTimeout(500)
  await diff.locator('[data-slot="session-turn-diff-trigger"]').first().click()
  await page.waitForTimeout(900)
  const trace = await stopVisualProbe<keyof typeof regions>(page)
  await reportVisualStability(
    testInfo,
    "diff-summary-expand",
    trace,
    visualPlan(regions, [
      { type: "required", regions: ["diff", "following"] },
      { type: "unique", regions: ["diff", "following"] },
      { type: "stable", regions: ["diff", "following"] },
      { type: "opacity", regions: "all" },
      { type: "continuity", regions: "all" },
      { type: "motion", regions: "all", maxPositionReversals: 1, maxReversals: 2 },
      { type: "label-stability", regions: "all" },
      { type: "flow", regions: ["diff", "following"] },
    ]),
  )
})

function lines(count: number) {
  return Array.from({ length: count }, (_, index) => `line ${index + 1}`).join("\n")
}

function source(count: number, changed: boolean) {
  return Array.from(
    { length: count },
    (_, index) => `export const value${index} = ${changed ? index + 1 : index}\n`,
  ).join("")
}
