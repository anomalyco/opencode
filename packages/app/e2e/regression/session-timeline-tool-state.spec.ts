import { expect, test } from "@playwright/test"
import {
  assistantMessage,
  partUpdated,
  setupTimeline,
  toolPart,
  userMessage,
} from "../performance/timeline-stability/fixture"

test("updates expanded web search links without resetting expansion", async ({ page }) => {
  const searchID = "prt_websearch_mutation"
  const input = { query: "timeline stability" }
  const timeline = await setupTimeline(page, {
    messages: [
      userMessage(),
      assistantMessage([toolPart(searchID, "websearch", "completed", input, { output: "https://example.com/one" })]),
    ],
  })
  const wrapper = page.locator(`[data-timeline-part-id="${searchID}"]`)
  const trigger = wrapper.locator('[data-slot="collapsible-trigger"]')
  await trigger.click()
  await expect(trigger).toHaveAttribute("aria-expanded", "true")
  await timeline.send(
    partUpdated(
      toolPart(searchID, "websearch", "completed", input, {
        output: "https://example.com/one\nhttps://example.com/two",
      }),
    ),
    300,
  )
  await expect(trigger).toHaveAttribute("aria-expanded", "true")
  await expect(wrapper.locator('a[href="https://example.com/two"]')).toBeVisible()
})

test("preserves an expanded tool error card across duplicate delivery", async ({ page }) => {
  const toolID = "prt_duplicate_error"
  const failed = toolPart(toolID, "bash", "error", { command: "exit 1" }, { error: "Command failed visibly" })
  const timeline = await setupTimeline(page, { messages: [userMessage(), assistantMessage([failed])] })
  const wrapper = page.locator(`[data-timeline-part-id="${toolID}"]`)
  const trigger = wrapper.locator('[data-slot="collapsible-trigger"]')
  await trigger.click()
  await expect(trigger).toHaveAttribute("aria-expanded", "true")
  await timeline.send(partUpdated(failed), 150)
  await timeline.send(partUpdated(failed), 250)
  await expect(trigger).toHaveAttribute("aria-expanded", "true")
  await expect(wrapper).toContainText("Command failed visibly")
})

test("renders multiple question answers and preserves open state on answer updates", async ({ page }) => {
  const questionID = "prt_multi_question"
  const input = {
    questions: [
      { header: "First", question: "First choice?", options: [] },
      { header: "Second", question: "Second choice?", options: [], multiple: true },
    ],
  }
  const timeline = await setupTimeline(page, {
    messages: [
      userMessage(),
      assistantMessage([
        toolPart(questionID, "question", "completed", input, { metadata: { answers: [["A"], ["B", "C"]] } }),
      ]),
    ],
  })
  const wrapper = page.locator(`[data-timeline-part-id="${questionID}"]`)
  const trigger = wrapper.locator('[data-slot="collapsible-trigger"]')
  await expect(trigger).toHaveAttribute("aria-expanded", "true")
  await timeline.send(
    partUpdated(
      toolPart(questionID, "question", "completed", input, { metadata: { answers: [["Updated"], ["B", "C"]] } }),
    ),
    300,
  )
  await expect(trigger).toHaveAttribute("aria-expanded", "true")
  await expect(wrapper).toContainText("Updated")
  await expect(wrapper).toContainText("B, C")
})
