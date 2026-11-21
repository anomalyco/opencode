import { expect, test } from "@playwright/test"
import { assistantMessage, historyMessages, partUpdated, setupTimeline, shell, userMessage } from "../utils/timeline"

// The thumb is mounted in the visible-area track, outside the ScrollView root. A drag that never reported its
// pointer kept the timeline following, so growth during the drag pulled the view back to the end until the next move.
test("dragging the scrollbar thumb up stops following while the tail grows", async ({ page }) => {
  const shellID = "prt_thumb_drag_shell"
  const timeline = await setupTimeline(page, {
    messages: [
      ...historyMessages(24),
      userMessage(),
      assistantMessage([shell(shellID, "running")], { completed: false }),
    ],
    settings: { shellToolPartsExpanded: true },
  })
  const scroll = page.locator('[data-slot="session-timeline-scroll"]')
  const viewport = scroll.locator(".scroll-view__viewport")
  const thumb = page.locator('[data-slot="session-timeline-visible"] .scroll-view__thumb')
  const distance = () => viewport.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop)
  await expect.poll(distance).toBeLessThanOrEqual(1)
  await scroll.hover()
  await expect(thumb).toHaveAttribute("data-visible", "true")
  const box = (await thumb.boundingBox())!
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()

  for (const step of [1, 2, 3, 4, 5, 6, 7, 8]) await page.mouse.move(x, y - step * 10)
  await expect.poll(distance).toBeGreaterThan(200)
  const held = await distance()
  const output = Array.from({ length: 60 }, (_, index) => `line ${index + 1}`).join("\n")
  await timeline.send(partUpdated(shell(shellID, "running", output)), 300)
  // Still held and not moved: the view keeps its distance from the end instead of jumping there.
  expect(await distance()).toBeGreaterThan(held - 20)
  await page.mouse.up()
})

for (const reducedMotion of [false, true]) {
  test(`suppresses the scrollbar from toggle press until timeline interaction (reduced motion: ${reducedMotion})`, async ({
    page,
  }) => {
    await setupTimeline(page, { seedHistory: true, reducedMotion })
    const chat = page.locator('[data-slot="session-chat-panel"]')
    const scroll = page.locator('[data-slot="session-timeline-scroll"]')
    const viewport = scroll.locator(".scroll-view__viewport")
    const thumb = page.locator('[data-slot="session-timeline-visible"] .scroll-view__thumb')
    const toggle = page.getByRole("button", { name: "Toggle review", exact: true })
    await expect(thumb).toHaveCount(1)
    await scroll.hover()
    await expect(thumb).toHaveAttribute("data-visible", "true")
    await expect(thumb).toHaveCSS("visibility", "visible")

    for (const opened of [true, false]) {
      await toggle.hover()
      await page.mouse.down()
      await expect(thumb).toHaveCSS("visibility", "hidden")
      await page.mouse.up()
      await expect(toggle).toHaveAttribute("aria-expanded", String(opened))
      const presence = page.locator('[data-slot="session-side-panel-presence"]')

      if (opened) await expect(presence).toHaveCSS("transform", "none")

      // A settled close keeps the side region mounted and skips its contents.
      if (!opened) await expect(presence).toHaveCSS("content-visibility", "hidden")
      await expect(thumb).toHaveCSS("visibility", "hidden")
      // Late scroll anchoring must not bring the thumb back after the panel has settled.
      await viewport.evaluate(
        (element) =>
          new Promise<void>((resolve) => {
            element.addEventListener("scroll", () => resolve(), { once: true })
            element.scrollTop += element.scrollTop > 0 ? -1 : 1
          }),
      )
      await expect(thumb).toHaveCSS("visibility", "hidden")
      await scroll.hover()
      await expect(thumb).toHaveAttribute("data-visible", "true")
      await expect(thumb).toHaveCSS("visibility", "visible")
    }
  })
}
