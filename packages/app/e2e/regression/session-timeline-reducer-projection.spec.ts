import { expect, test } from "@playwright/test"
import {
  assistantMessage,
  completedAssistantInfo,
  messageUpdated,
  partUpdated,
  renderedPartID,
  setupTimeline,
  shell,
  toolPart,
  status,
  textPart,
  userMessage,
} from "../performance/timeline-stability/fixture"

test("reducer-hardening: converges when idle arrives before final part and message completion", async ({ page }) => {
  const textID = "prt_event_order_text"
  const assistant = assistantMessage([textPart(textID, "Partial")], { completed: false })
  const timeline = await setupTimeline(page, { messages: [userMessage(), assistant] })
  await timeline.send(status("busy"), 100)
  await timeline.send(status("idle"), 100)
  await timeline.send(partUpdated(textPart(textID, "Final after early idle")), 120)
  await timeline.send(messageUpdated(completedAssistantInfo(assistant)), 250)

  await expect(page.locator('[data-timeline-row="Thinking"]')).toHaveCount(0)
  await expect(page.locator(`[data-timeline-part-id="${renderedPartID(textID)}"]`)).toContainText(
    "Final after early idle",
  )
})

test("expands a mixed collapsed tool stack without expanding its individual calls", async ({ page }) => {
  const parts = [
    shell("prt_stack_shell_1", "completed", "first"),
    toolPart("prt_stack_explore", "subagent", "completed", {
      agent: "explore",
      description: "Inspect the project",
      prompt: "Explore the project",
    }),
    toolPart("prt_stack_patch", "patch", "completed", { patchText: "Update src/value.ts" }),
    shell("prt_stack_shell_2", "completed", "second"),
  ]
  await setupTimeline(page, { messages: [userMessage(), assistantMessage(parts)] })

  const group = page.locator(
    '[data-timeline-part-ids="prt_stack_shell_1,prt_stack_explore,prt_stack_patch,prt_stack_shell_2"]',
  )
  const summary = group.getByRole("button", { name: "Used Shell, Explore, Patch" })
  await expect(summary).toHaveAttribute("aria-expanded", "false")
  await expect(summary).toHaveCSS("height", "28px")
  await expect(group.locator('[data-component="tag"]')).toHaveText("4")
  await summary.click()
  await expect(summary).toHaveAttribute("aria-expanded", "true")
  await expect(group.locator('[data-slot="context-tool-group-item"]')).toHaveCount(4)
  await expect(group.locator('[data-timeline-part-id="prt_stack_shell_1"]')).toBeVisible()
  await expect(group.locator('[data-timeline-part-id="prt_stack_patch"]')).toBeVisible()
  await expect(group.locator('[data-component="context-tool-group-list"]')).toHaveCSS("row-gap", "8px")
  const content = group.locator(':scope > [data-component="collapsible"] > [data-slot="collapsible-content"]')
  await expect(content).toHaveCSS("margin-left", "0px")
  await expect(content).toHaveCSS("padding-left", "12px")
  await expect.poll(() => content.evaluate((element) => getComputedStyle(element, "::before").content)).toBe("none")
})

test("leaves tools expanded by settings outside the collapsed stack", async ({ page }) => {
  const parts = [
    shell("prt_expanded_shell", "completed", "expanded"),
    toolPart("prt_collapsed_patch", "patch", "completed", { patchText: "Update src/value.ts" }),
    toolPart("prt_collapsed_read", "read", "completed", { path: "src/value.ts" }),
  ]
  await setupTimeline(page, {
    messages: [userMessage(), assistantMessage(parts)],
    settings: { shellToolPartsExpanded: true },
  })

  await expect(page.locator('[data-timeline-part-id="prt_expanded_shell"]')).toBeVisible()
  const group = page.locator('[data-timeline-part-ids="prt_collapsed_patch,prt_collapsed_read"]')
  await expect(group.getByRole("button", { name: "Used Patch, Read" })).toBeVisible()
  await expect(group.locator('[data-component="tag"]')).toHaveText("2")
  await expect(page.locator('[data-timeline-spacing="tool"]')).toHaveCSS("padding-top", "8px")
})

test("keeps failed search calls and their error cards inside the collapsed stack", async ({ page }) => {
  const parts = [
    toolPart(
      "prt_error_glob",
      "glob",
      "error",
      { path: "C:/Users", pattern: "*.ts" },
      {
        error: "Invalid tool input",
      },
    ),
    toolPart(
      "prt_error_grep",
      "grep",
      "error",
      { path: "C:/Users", pattern: "value" },
      {
        error: "Search timed out after 30 seconds",
      },
    ),
  ]
  await setupTimeline(page, { messages: [userMessage(), assistantMessage(parts)] })

  const group = page.locator('[data-timeline-part-ids="prt_error_glob,prt_error_grep"]')
  const summary = group.getByRole("button", { name: "Used Glob, Grep" })
  await expect(group.locator('[data-component="tag"]')).toHaveText("2")
  await summary.click()
  await expect(group.locator('[data-kind="tool-error-card"]')).toHaveCount(2)
  const glob = group.locator('[data-timeline-part-id="prt_error_glob"]')
  await expect(glob).toContainText("Invalid tool input")
  await expect(glob.locator('[data-component="tool-error-card-icon"]')).toBeVisible()
  await expect(glob.locator('[data-component="tool-error-card-icon"] use')).toHaveAttribute(
    "href",
    "#opencode-v2-icon-circle-exclamation",
  )
  await expect
    .poll(() =>
      glob
        .locator('[data-kind="tool-error-card"]')
        .evaluate((element) => getComputedStyle(element, "::before").display),
    )
    .toBe("none")
  await expect(group.locator('[data-timeline-part-id="prt_error_grep"]')).toContainText(
    "Search timed out after 30 seconds",
  )
})
