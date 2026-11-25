import type { SessionMessageInfo } from "@opencode/client/promise"
import { expect, test, type Locator } from "@playwright/test"
import {
  assistantMessage,
  historyMessages,
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

// A working turn shows controls the reader can use, such as a tool header and a link in a reply. The keyboard stops
// on each one where the reader can see it, and none is hidden from a screen reader.
for (const newTimeline of [false, true]) {
  test(`every Tab stop of a working turn can be seen and read (${newTimeline ? "New" : "current"} timeline)`, async ({
    page,
  }) => {
    await setupTimeline(page, {
      messages: [
        userMessage(),
        assistantMessage(
          [
            shell("prt_working_stop_shell", "completed", lines(5)),
            textPart("prt_working_stop_text", "See [the notes](https://example.com/notes) while this runs."),
          ],
          { completed: false },
        ),
      ],
      settings: { newTimeline, shellToolPartsExpanded: false },
    })
    await expect(page.getByRole("button", { name: "Stop" })).toBeVisible()
    await expect(page.getByText("while this runs.")).toBeVisible()

    // The timeline's stops in the order the key reaches them, from the control it starts on to the first stop outside.
    const walk = async (key: "Tab" | "Shift+Tab", from: Locator) => {
      await from.focus()
      const stops: { name: string; tool: boolean; hidden: boolean; shown: boolean }[] = []

      for (let press = 0; press < 20; press++) {
        await page.keyboard.press(key)

        const stop = await page.evaluate(() => {
          const element = document.activeElement

          if (!(element instanceof HTMLElement) || !element.closest("[data-timeline-row]")) return undefined
          const box = element.getBoundingClientRect()

          return {
            name: (element.getAttribute("aria-label") ?? element.textContent ?? "").trim().replace(/\s+/g, " "),
            tool: element.matches("button[aria-expanded]"),
            hidden: element.closest('[aria-hidden="true"]') !== null,
            shown:
              element.checkVisibility({ opacityProperty: true, visibilityProperty: true }) &&
              box.bottom > 0 &&
              box.top < innerHeight,
          }
        })

        if (stop) stops.push(stop)

        if (!stop && stops.length > 0) break
      }

      return stops
    }

    const forward = await walk("Tab", page.getByRole("button", { name: "More actions", exact: true }))
    const back = await walk("Shift+Tab", page.getByRole("textbox", { name: "Prompt", exact: true }))

    for (const stops of [forward, back]) {
      expect(stops.filter((stop) => stop.hidden || !stop.shown)).toEqual([])
      // The walk passed the turn's tool header and its link.
      expect(stops.some((stop) => stop.tool)).toBe(true)
      expect(stops.map((stop) => stop.name)).toContain("the notes")
    }
  })
}

// Focus that rests nowhere is not handed to a control the reader cannot see: that would scroll the timeline to it. A
// reader far up in history who opens or closes Review keeps the words they read where they are.
for (const newTimeline of [false, true]) {
  test(`opening and closing Review leaves a reader of old history where they were (${newTimeline ? "New" : "current"} timeline)`, async ({
    page,
  }) => {
    // Short turns: no row wraps again when Review narrows the timeline, so only a scroll can move the words.
    const turns = Array.from({ length: 30 }, (_, index) => {
      const value = String(index).padStart(4, "0")
      const user = `msg_0${value}_place_a_user`

      return [
        userMessage(undefined, { id: user, created: 1690000000000 + index * 10_000 }),
        assistantMessage([{ id: `prt_0${value}_place_text`, type: "text", text: `Old reply ${index}.` }], {
          id: `msg_0${value}_place_b_assistant`,
          parentID: user,
          created: 1690000001000 + index * 10_000,
        }),
      ]
    }).flat()

    await setupTimeline(page, { messages: turns, settings: { newTimeline } })
    const scroller = page.locator(".scroll-view__viewport", { has: page.locator("[data-timeline-row]") })
    const panel = page.locator("#review-panel")
    const toggle = page.getByRole("button", { name: "Toggle review", exact: true })
    const search = page.locator('[data-component="timeline-search-bar"] input')

    // How far down the screen the marked words are, read from the text itself. Their row may not be mounted.
    const place = () =>
      scroller.evaluate((element) => {
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)

        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const at = node.textContent?.indexOf("Old reply 1.") ?? -1

          if (at < 0) continue
          const range = new Range()
          range.setStart(node, at)
          range.setEnd(node, at + "Old reply 1.".length)

          return Math.round(range.getBoundingClientRect().top)
        }
      })

    await expect(page.getByText("Old reply 29.", { exact: true })).toBeInViewport()
    await scroller.hover()
    await page.mouse.wheel(0, -100_000)
    await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBe(0)
    await expect(page.getByText("Old reply 1.", { exact: true })).toBeInViewport()

    // The reader clicks in the timeline, searches it and closes Find. Focus then rests on the page, and the timeline
    // is what had it last. Copy under the latest reply is still mounted, far below.
    await page.getByText("Old reply 1.", { exact: true }).click()
    await expect(scroller).toBeFocused()
    await page.keyboard.press("ControlOrMeta+f")
    await expect(search).toBeFocused()
    await page.keyboard.press("Escape")
    await expect(search).toHaveCount(0)
    const before = await place()
    expect(before).toEqual(expect.any(Number))

    const words = async () => {
      const now = await place()

      if (now === undefined) return "gone"

      return Math.abs(now - Number(before)) <= 2 ? "in place" : `moved ${now - Number(before)} px`
    }

    await toggle.click()
    await expect(panel.getByRole("button", { name: /^Review/ })).toBeVisible()
    await expect.poll(words).toBe("in place")

    // While Review is open its toggle is in the panel; the header's hands over to it as the panel finishes opening.
    await panel.getByRole("button", { name: "Toggle review", exact: true }).click()
    await expect(toggle).toHaveAttribute("aria-expanded", "false")
    await expect(panel).toHaveAttribute("aria-hidden", "true")
    await expect.poll(words).toBe("in place")
  })
}

test("an older page that lands leaves the reader where they were while a link in an events row has focus", async ({
  page,
}) => {
  // On the New timeline a page that lands builds the links of an events row again. The focus rescue gave focus to the
  // new link, which the reader had scrolled out of view, and the browser scrolled the timeline back to it.
  const older = Promise.withResolvers<void>()
  const requests: { before?: string; phase: "start" | "end" }[] = []
  const later = "msg_1003_later_user"

  const messages: SessionMessageInfo[] = [
    ...historyMessages(20),
    userMessage(),
    assistantMessage([textPart("prt_events_started", "Started the server.")]),
    {
      id: "msg_1002_shell_finished",
      type: "synthetic",
      text: '<shell id="shell_notice" state="completed" command="bun serve.ts">\nlistening\n</shell>',
      description: "bun serve.ts",
      metadata: { source: "shell", shellID: "shell_notice", state: "completed" },
      time: { created: 1700000003000 },
    },
    userMessage(undefined, { id: later, created: 1700000004000 }),
    assistantMessage(
      [
        {
          id: "prt_events_later",
          type: "text",
          text: Array.from({ length: 60 }, (_, index) => `Later line ${index + 1}.`).join("\n\n"),
        },
      ],
      { id: "msg_1004_later_assistant", parentID: later, created: 1700000005000 },
    ),
  ]

  // The latest page starts at the turn with the events row. Everything older is one more page, held until released.
  const first = messages.findIndex((message) => message.id === userID)
  await setupTimeline(page, {
    sessionMessages: messages,
    settings: { newTimeline: true },
    pageMessages: (_, __, before) =>
      before ? { items: messages.slice(0, first) } : { items: messages.slice(first), cursor: messages[first]!.id },
    beforeMessagesResponse: ({ before }) => (before ? older.promise : Promise.resolve()),
    onMessages: (request) => requests.push(request),
  })
  const scroller = page.locator(".scroll-view__viewport", { has: page.locator("[data-timeline-row]") })
  const row = page.locator('[data-component="timeline-event-row"]')
  const link = row.getByRole("button", { name: /bun serve\.ts$/ })

  // How far down the screen the marked words are, read from the text itself.
  const place = () =>
    scroller.evaluate((element) => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)

      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const at = node.textContent?.indexOf("Later line 8.") ?? -1

        if (at < 0) continue
        const range = new Range()
        range.setStart(node, at)
        range.setEnd(node, at + "Later line 8.".length)

        return Math.round(range.getBoundingClientRect().top)
      }
    })

  await expect(page.getByText("Later line 60.", { exact: true })).toBeInViewport()
  await scroller.hover()
  await page.mouse.wheel(0, -100_000)
  await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBe(0)
  // At the top the timeline asks for the older page.
  await expect.poll(() => requests.some((request) => request.before && request.phase === "start")).toBe(true)

  // The reader opens the row, moves to its link with Tab and scrolls on: the link leaves the view, its row stays.
  await row.getByRole("button", { name: /^Finished/ }).click()
  await page.keyboard.press("Tab")
  await expect(link).toBeFocused()
  const view = (await scroller.boundingBox())!
  const box = (await link.boundingBox())!
  await page.mouse.wheel(0, Math.round(box.y + box.height - view.y) + 80)
  await expect(link).not.toBeInViewport()
  await expect(link).toBeFocused()
  await expect(page.getByText("Later line 8.", { exact: true })).toBeInViewport()
  const before = await place()
  expect(before).toEqual(expect.any(Number))

  const words = async () => {
    const now = await place()

    if (now === undefined) return "gone"

    return Math.abs(now - Number(before)) <= 2 ? "in place" : `moved ${now - Number(before)} px`
  }

  const height = await scroller.evaluate((element) => element.scrollHeight)
  older.resolve()
  await expect.poll(() => requests.some((request) => request.before && request.phase === "end")).toBe(true)
  // The older page has landed above the reader.
  await expect.poll(() => scroller.evaluate((element) => element.scrollHeight)).toBeGreaterThan(height)
  await expect.poll(words).toBe("in place")
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
