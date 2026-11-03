import { expect, test } from "@playwright/test"
import {
  assistantMessage,
  renderedPartID,
  setupTimeline,
  shell,
  textPart,
  userID,
  userMessage,
} from "../utils/timeline"

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

test("jump to latest is reachable only while it is shown", async ({ page }) => {
  await setupTimeline(page, {
    messages: [userMessage(), assistantMessage([textPart("prt_jump_latest_text", "Latest response.")])],
    seedHistory: true,
  })
  const scroller = page.locator(".scroll-view__viewport", { has: page.locator("[data-timeline-row]") })
  const jump = page.getByRole("button", { name: "Jump to latest", exact: true })
  const latest = page.getByText("Latest response.", { exact: true })
  await expect(latest).toBeInViewport()
  await jump.focus()
  await expect(jump).not.toBeFocused()

  await scroller.hover()
  await page.mouse.wheel(0, -3000)
  await expect(latest).not.toBeInViewport()
  await jump.click()
  await expect
    .poll(() => scroller.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop))
    .toBeLessThanOrEqual(1)
  await expect(latest).toBeInViewport()
  // The click focused the button; hiding it must not leave focus on an invisible control.
  await expect(jump).not.toBeFocused()
})

function lines(count: number) {
  return Array.from({ length: count }, (_, index) => `line ${index + 1}`).join("\n")
}

for (const visible of [false, true]) {
  test(`${visible ? "shows" : "omits"} the agent name in message meta when agents are ${visible ? "on" : "off"}`, async ({
    page,
  }, testInfo) => {
    await setupTimeline(page, {
      messages: [userMessage(), assistantMessage([textPart("prt_agent_meta", "Done.")])],
      settings: { showCustomAgents: visible },
      seedHistory: true,
    })
    const user = page.locator(`[data-timeline-row="UserMessage"][data-message-id="${userID}"]`)
    const assistant = page.locator(`[data-timeline-part-id="${renderedPartID("prt_agent_meta")}"]`)
    await user.scrollIntoViewIfNeeded()
    await user.hover()
    await page.screenshot({ path: testInfo.outputPath(`agents-${visible ? "on" : "off"}.png`) })
    await assistant.hover()

    const meta = [user.locator('[data-slot="user-message-meta"]'), assistant.locator('[data-slot="text-part-meta"]')]

    for (const item of meta) {
      // A delivered message keeps its hidden Pending label in the DOM, so read only the rendered text.
      if (visible) await expect(item).toContainText(/^Build\s*·/, { useInnerText: true })
      else await expect(item).not.toContainText("Build")
    }
  })
}
