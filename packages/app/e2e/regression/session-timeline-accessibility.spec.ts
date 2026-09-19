import { expect, test } from "@playwright/test"
import {
  assistantMessage,
  setupTimeline,
  shell,
  textPart,
  userMessage,
} from "../performance/timeline-stability/fixture"

test("streaming assistant content remains in the accessibility tree", async ({ page }) => {
  const text = "Streaming assistant output"
  await setupTimeline(page, {
    messages: [userMessage(), assistantMessage([textPart("prt_streaming_accessibility", text)], { completed: false })],
  })

  await expect(page.locator('[data-slot="session-turn-assistant-content"]')).toMatchAriaSnapshot(`
    - paragraph: ${text}
  `)
})

test("space activates a focused timeline button instead of scrolling", async ({ page }) => {
  const shellID = "prt_space_button_shell"
  await setupTimeline(page, {
    messages: [userMessage(), assistantMessage([shell(shellID, "completed", lines(5))])],
    settings: { shellToolPartsExpanded: false },
    reducedMotion: true,
  })
  const scroller = page.locator(".scroll-view__viewport", { has: page.locator("[data-timeline-row]") })
  const trigger = page.locator(`[data-timeline-part-id="${shellID}"] [data-slot="collapsible-trigger"]`)
  await trigger.focus()
  const before = await scroller.evaluate((element) => element.scrollTop)
  await trigger.press("Space")
  await expect(trigger).toHaveAttribute("aria-expanded", "true")
  expect(await scroller.evaluate((element) => element.scrollTop)).toBe(before)
})

function lines(count: number) {
  return Array.from({ length: count }, (_, index) => `line ${index + 1}`).join("\n")
}
