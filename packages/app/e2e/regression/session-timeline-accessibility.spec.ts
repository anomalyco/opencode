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

test("Tab moves between timeline controls without stopping on the timeline itself", async ({ page }) => {
  await setupTimeline(page, {
    messages: [userMessage(), assistantMessage([textPart("prt_tab_stop_text", "Long response. ".repeat(600))])],
    seedHistory: true,
  })
  const scroller = page.locator(".scroll-view__viewport", { has: page.locator("[data-timeline-row]") })
  const first = scroller.getByRole("button", { name: "More actions", exact: true })
  await expect.poll(() => scroller.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true)
  await expect(scroller).toHaveAttribute("tabindex", "-1")
  await first.press("Shift+Tab")
  await expect(scroller).not.toBeFocused()
})

test("a focused control that scrolls out of the mounted rows leaves the timeline where it was scrolled", async ({
  page,
}) => {
  await setupTimeline(page, {
    messages: [
      userMessage(),
      assistantMessage([
        shell("prt_focus_unmount_shell", "completed", lines(5)),
        textPart("prt_focus_unmount_text", "Latest response."),
      ]),
    ],
    settings: { shellToolPartsExpanded: false },
    seedHistory: true,
  })
  const scroller = page.locator(".scroll-view__viewport", { has: page.locator("[data-timeline-row]") })
  const trigger = page.getByRole("button", { name: "Used 1 Shell", exact: true })
  await trigger.focus()
  await expect(trigger).toBeFocused()
  await scroller.hover()
  await page.mouse.wheel(0, -100_000)
  // The row left the mounted range, and its control went with it.
  await expect(trigger).toHaveCount(0)
  // The timeline keeps focus for the scroll keys. No control in another row takes it and scrolls the timeline to itself.
  await expect(scroller).toBeFocused()
  expect(await scroller.evaluate((element) => element.scrollTop)).toBe(0)
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

  // From the keyboard, focus continues in the prompt instead of falling to the page.
  await page.mouse.wheel(0, -3000)
  await expect(latest).not.toBeInViewport()
  await jump.focus()
  await page.keyboard.press("Enter")
  await expect(latest).toBeInViewport()
  await expect(page.getByRole("textbox", { name: "Prompt", exact: true })).toBeFocused()
})

// Focus that rests nowhere is not handed to a control the reader cannot see: that would scroll the timeline to it. A
// reader far up in history who opens or closes Review keeps the row they read.
for (const newTimeline of [false, true]) {
  test(`opening and closing Review leaves a reader of old history where they were (${newTimeline ? "New" : "current"} timeline)`, async ({
    page,
  }) => {
    await setupTimeline(page, {
      messages: [userMessage(), assistantMessage([textPart("prt_review_place_latest", "Latest response.")])],
      settings: { newTimeline },
      seedHistory: true,
    })
    const scroller = page.locator(".scroll-view__viewport", { has: page.locator("[data-timeline-row]") })
    const read = page.getByText(/^Historical response 0\./)
    const panel = page.locator("#review-panel")
    const toggle = page.getByRole("button", { name: "Toggle review", exact: true })
    const search = page.locator('[data-component="timeline-search-bar"] input')
    const offset = () => scroller.evaluate((element) => element.scrollTop)
    const top = async () => Math.round((await read.boundingBox())?.y ?? Number.NaN)

    await expect(page.getByText("Latest response.", { exact: true })).toBeInViewport()
    await scroller.hover()
    await page.mouse.wheel(0, -100_000)
    await expect.poll(offset).toBe(0)
    await expect(read).toBeInViewport()

    // The reader clicks in the timeline, searches it and closes Find. Focus then rests on the page, and the timeline
    // is what had it last. The latest reply's Copy is still mounted, far below.
    await read.click()
    await expect(scroller).toBeFocused()
    await page.keyboard.press("ControlOrMeta+f")
    await expect(search).toBeFocused()
    await page.keyboard.press("Escape")
    await expect(search).toHaveCount(0)
    const before = await top()

    await toggle.click()
    await expect(toggle).toHaveAttribute("aria-expanded", "true")
    await expect(panel.getByRole("button", { name: /^Review/ })).toBeVisible()
    await expect.poll(offset).toBe(0)
    await expect.poll(top).toBe(before)

    await toggle.click()
    await expect(toggle).toHaveAttribute("aria-expanded", "false")
    await expect(panel).toHaveAttribute("aria-hidden", "true")
    await expect.poll(offset).toBe(0)
    await expect.poll(top).toBe(before)
  })
}

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
