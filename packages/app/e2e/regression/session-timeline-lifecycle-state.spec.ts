import { expect, test } from "@playwright/test"
import {
  assistantMessage,
  completedAssistantInfo,
  messageUpdated,
  partUpdated,
  reasoningPart,
  renderedPartID,
  setupTimeline,
  shell,
  status,
  stepStarted,
  textPart,
  userMessage,
} from "../performance/timeline-stability/fixture"

test("transitions thinking and hidden reasoning through busy to idle", async ({ page }) => {
  const reasoningID = "prt_reasoning_hidden"
  const assistant = assistantMessage([reasoningPart(reasoningID, "## Inspecting stability")], { completed: false })
  const timeline = await setupTimeline(page, {
    messages: [userMessage(), assistant],
    settings: { showReasoningSummaries: false },
    cpuRate: 4,
  })
  await timeline.send(status("busy"), 150)

  await expect(page.locator('[data-timeline-row="Thinking"]')).toBeVisible()
  await expect(page.getByText("Inspecting stability", { exact: true })).toBeVisible()
  await expect(page.locator(`[data-timeline-part-id="${reasoningID}"]`)).toHaveCount(0)
  await timeline.send(partUpdated(shell("prt_reasoning_shell", "running")), 160)
  await expect(page.locator('[data-timeline-row="Thinking"]')).toBeVisible()
  await timeline.send(partUpdated(shell("prt_reasoning_shell", "completed", "done")), 180)
  await timeline.send(messageUpdated(completedAssistantInfo(assistant)), 100)
  await timeline.send(status("idle"), 300)
  await expect(page.locator('[data-timeline-row="Thinking"]')).toHaveCount(0)
  await expect(page.locator(`[data-timeline-part-id="${reasoningID}"]`)).toHaveCount(0)
})

test("moves busy through retry and recovery to final idle content", async ({ page }) => {
  const assistant = assistantMessage([], { completed: false })
  const timeline = await setupTimeline(page, {
    messages: [
      userMessage(undefined, {
        summary: {
          diffs: [
            {
              file: "src/retry.ts",
              additions: 1,
              deletions: 1,
              status: "modified",
              patch: "@@ -1 +1 @@\n-export const retry = false\n+export const retry = true",
            },
          ],
        },
      }),
      assistant,
    ],
  })
  await timeline.send(status("busy"), 140)
  await expect(page.locator('[data-timeline-row="Thinking"]')).toBeVisible()
  await expect(page.locator('[data-timeline-row="DiffSummary"]')).toHaveCount(0)
  await timeline.send(status("retry"), 180)
  await expect(page.locator('[data-timeline-row="Retry"]')).toBeVisible()
  await expect(page.locator('[data-timeline-row="Thinking"]')).toHaveCount(0)
  await timeline.send(stepStarted(assistant), 180)
  await expect(page.locator('[data-timeline-row="Retry"]')).toHaveCount(0)
  await expect(page.locator('[data-timeline-row="Thinking"]')).toBeVisible()
  await timeline.send(partUpdated(textPart("prt_recovered", "Recovered response")), 140)
  await timeline.send(messageUpdated(completedAssistantInfo(assistant)), 100)
  await timeline.send(status("idle"), 350)
  await expect(page.locator('[data-timeline-row="Thinking"]')).toHaveCount(0)
  await expect(page.locator(`[data-timeline-part-id="${renderedPartID("prt_recovered")}"]`)).toContainText(
    "Recovered response",
  )
})
