import { expect, test } from "@playwright/test"
import {
  assistantMessage,
  setupTimeline,
  shell,
  textPart,
  userMessage,
} from "../performance/timeline-stability/fixture"

test("assistant steps remain accessible while the response is streaming", async ({ page }) => {
  const text = "Streaming assistant output"
  await setupTimeline(page, {
    messages: [
      userMessage(),
      assistantMessage(
        [shell("prt_accessible_shell", "completed", "done", "echo progress"), textPart("prt_accessible_text", text)],
        { completed: false },
      ),
    ],
  })

  const assistant = page.locator('[data-slot="session-turn-assistant-content"]')
  await expect(assistant.filter({ hasText: text })).toBeVisible()
  await expect(page.getByRole("button", { name: "Used 1 Shell" })).toBeVisible()
  await expect(assistant.filter({ hasText: text })).toMatchAriaSnapshot(`- paragraph: ${text}`)
})

test("space activates a focused timeline button instead of scrolling", async ({ page }) => {
  const shellID = "prt_space_button_shell"
  await setupTimeline(page, {
    messages: [
      userMessage(),
      assistantMessage([
        shell(shellID, "completed", lines(5)),
        textPart(
          "prt_space_following",
          "Following content leaves room to focus the command away from the bottom. ".repeat(40),
        ),
      ]),
    ],
    settings: { shellToolPartsExpanded: false },
    reducedMotion: true,
    seedHistory: true,
  })
  const scroller = page.locator(".scroll-view__viewport", { has: page.locator("[data-timeline-row]") })
  const trigger = page.getByRole("button", { name: "Used 1 Shell", exact: true })
  await expect
    .poll(() => scroller.evaluate((element) => element.scrollHeight - element.clientHeight))
    .toBeGreaterThan(300)
  await trigger.scrollIntoViewIfNeeded()
  await scroller.hover()
  await page.mouse.wheel(0, -100)
  await expect
    .poll(() => scroller.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop))
    .toBeGreaterThan(50)
  await expect(trigger).toBeInViewport()
  await trigger.focus()
  await expect(trigger).toBeFocused()
  const before = await scroller.evaluate((element) => element.scrollTop)
  await trigger.press("Space")
  await expect(trigger).toHaveAttribute("aria-expanded", "true")
  expect(await scroller.evaluate((element) => element.scrollTop)).toBe(before)
})

function lines(count: number) {
  return Array.from({ length: count }, (_, index) => `line ${index + 1}`).join("\n")
}
