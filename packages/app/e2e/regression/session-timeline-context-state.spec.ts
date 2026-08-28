import { expect, test } from "@playwright/test"
import {
  assistantMessage,
  partUpdated,
  setupTimeline,
  toolPart,
  userMessage,
} from "../performance/timeline-stability/fixture"

test("preserves a collapsed context group through count and status updates", async ({ page }) => {
  const ids = ["prt_closed_01_read", "prt_closed_02_glob"]
  const inputs = {
    read: { filePath: "src/a.ts", offset: 0, limit: 120 },
    glob: { path: ".", pattern: "**/*.ts" },
  }
  const timeline = await setupTimeline(page, {
    messages: [
      userMessage(),
      assistantMessage(
        [toolPart(ids[0]!, "read", "running", inputs.read), toolPart(ids[1]!, "glob", "running", inputs.glob)],
        { completed: false },
      ),
    ],
  })
  const group = page.locator(`[data-timeline-part-ids="${ids.join(",")}"]`)
  const trigger = group.locator('[data-slot="collapsible-trigger"]')
  await expect(trigger).toHaveAttribute("aria-expanded", "false")
  await timeline.send(partUpdated(toolPart(ids[0]!, "read", "completed", inputs.read)), 100)
  await timeline.send(partUpdated(toolPart(ids[1]!, "glob", "completed", inputs.glob)), 300)
  await expect(trigger).toHaveAttribute("aria-expanded", "false")
})
