import { expect, test } from "@playwright/test"
import {
  assistantMessage,
  setupTimeline,
  shell,
  textPart,
  userMessage,
} from "../performance/timeline-stability/fixture"

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
