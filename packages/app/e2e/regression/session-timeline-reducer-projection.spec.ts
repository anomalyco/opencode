import { expect, test } from "@playwright/test"
import { assistantMessage, setupTimeline, toolPart, userMessage } from "../utils/timeline"

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

  const group = page.locator('[data-component="collapsed-tool-group"]')
  const summary = group.getByRole("button", { name: "Used 2 Glob, Grep", exact: true })
  await expect(summary).toHaveAttribute("aria-expanded", "false")
  await summary.click()
  await expect(group.locator('[data-kind="tool-error-card"]')).toHaveCount(2)
  const glob = group.locator('[data-timeline-part-id="prt_error_glob"]')
  await expect(glob.getByRole("button")).toHaveAttribute("aria-expanded", "false")
  await glob.getByRole("button").click()
  await expect(glob).toContainText("Invalid tool input")
  await expect(glob.locator('[data-component="tool-error-card-icon"]')).toBeVisible()
  await expect(glob.locator('[data-component="tool-error-card-icon"] use')).toHaveAttribute(
    "href",
    "#opencode-v2-icon-outline-hexagonal-warning",
  )
  await expect
    .poll(() =>
      glob
        .locator('[data-kind="tool-error-card"]')
        .evaluate((element) => getComputedStyle(element, "::before").display),
    )
    .toBe("none")
  await group.locator('[data-timeline-part-id="prt_error_grep"]').getByRole("button").click()
  await expect(group.locator('[data-timeline-part-id="prt_error_grep"]')).toContainText(
    "Search timed out after 30 seconds",
  )
})
