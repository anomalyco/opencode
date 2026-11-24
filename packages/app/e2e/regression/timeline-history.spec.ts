import type { SessionMessageAssistant, SessionMessageInfo } from "@opencode/client/promise"
import { expect, test, type Page } from "@playwright/test"
import { sessionHref } from "../utils/app"
import { trackPageErrors } from "../utils/errors"
import { fixture, installTimelineSettings, mockStressTimeline } from "../utils/session-fixture"
import {
  assistantMessage,
  historyMessages,
  messageUpdated,
  partDelta,
  partUpdated,
  session,
  sessionID,
  setupTimeline,
  status,
  textPart,
  userID,
  userMessage,
  validateTimelineMessages,
  waitForVisualSettle,
} from "../utils/timeline"
import { expectSessionTitle } from "../utils/waits"
import { openSession } from "../utils/workspace"

test.use({ serviceWorkers: "block" })

test.describe("timeline history", () => {
  test("jump to message searches offscreen history without moving the reader until selection", async ({ page }) => {
    const target = userMessage([textPart("prt_dispatch_note", "Use the loading dock for delivery")], {
      id: "msg_00000_dispatch",
      created: 1680000000000,
    })

    const messages = [
      target,
      ...historyMessages(45),
      userMessage(),
      assistantMessage([textPart("prt_active", "Checking the route")], { completed: false }),
    ]

    const timeline = await setupTimeline(page, {
      sessionMessages: messages,
      pageMessages: (_, limit, before) => {
        const end = before ? messages.findIndex((message) => message.id === before) : messages.length
        const start = Math.max(0, end - Math.min(16, limit))

        return { items: messages.slice(start, end), cursor: start ? messages[start]!.id : undefined }
      },
    })

    const scroller = timelineScroller(page)

    const old = scroller.getByText(target.text, { exact: true })

    await expect(scroller.getByText("Checking the route", { exact: true })).toBeInViewport()
    await expect(old).toHaveCount(0)
    const top = await scroller.evaluate((element) => element.scrollTop)

    const mod = await page.evaluate(() => (/Mac/.test(navigator.platform) ? "Meta" : "Control"))

    const search = page.getByRole("combobox", { name: "Jump to message" })

    await page.keyboard.press(`${mod}+Alt+g`)
    await expect(search).toBeFocused()
    await search.fill("loading dock")
    await expect(page.getByRole("option", { name: /Use the loading dock/ })).toBeVisible()
    await search.press("Escape")
    await expect(search).toBeHidden()
    expect(await scroller.evaluate((element) => element.scrollTop)).toBe(top)
    await expect(old).toHaveCount(0)

    await page.keyboard.press(`${mod}+Shift+p`)
    await page.getByRole("combobox").fill("sent prompts")
    await page.getByRole("option", { name: /Jump to message/ }).click()
    await expect(search).toBeFocused()
    await search.fill("loading dock")
    await expect(page.getByRole("option", { name: /Use the loading dock/ })).toBeVisible()
    await search.press("Enter")
    await expect(old).toBeInViewport()
    await timeline.send(partDelta("prt_active", "\n\nThe route is ready."))
    await expect(old).toBeInViewport()
    await expect(page).toHaveURL(new RegExp(`#message-${target.id}$`))
    await page.getByRole("button", { name: "Jump to latest" }).click()
    await expect(scroller.getByText("The route is ready.", { exact: true })).toBeInViewport()
  })

  test("jump to message pages back only as far as the prompt", async ({ page }) => {
    const target = userMessage([textPart("prt_dispatch_note", "Use the loading dock for delivery")], {
      id: "msg_00100_dispatch",
      created: 1690000000000,
    })

    const history = historyMessages(80)

    const messages = [
      ...history.slice(0, 100),
      target,
      ...history.slice(100),
      userMessage(),
      assistantMessage([textPart("prt_active", "Checking the route")], { completed: false }),
    ]

    let oldest = messages.length

    await setupTimeline(page, {
      sessionMessages: messages,
      pageMessages: (_, limit, before) => {
        const end = before ? messages.findIndex((message) => message.id === before) : messages.length
        const start = Math.max(0, end - Math.min(16, limit))

        // The picker lists older prompts in pages of 200 without touching the timeline; the timeline pages by 20.
        if (limit < 200) oldest = Math.min(oldest, start)

        return { items: messages.slice(start, end), cursor: start ? messages[start]!.id : undefined }
      },
    })

    const mod = await page.evaluate(() => (/Mac/.test(navigator.platform) ? "Meta" : "Control"))

    const search = page.getByRole("combobox", { name: "Jump to message" })

    await page.keyboard.press(`${mod}+Alt+g`)
    await search.fill("loading dock")
    await expect(page.getByRole("option", { name: /Use the loading dock/ })).toBeVisible()
    await search.press("Enter")
    await expect(timelineScroller(page).getByText(target.text, { exact: true })).toBeInViewport()
    expect(oldest).toBeGreaterThan(0)
  })

  test("restoring a paged transcript waits for another upward scroll before loading history", async ({ page }) => {
    const id = "ses_history_restore"
    const other = "ses_history_other"
    const text = Array.from({ length: 40 }, (_, index) => `Paragraph ${index}.`).join("\n\n")

    const messages = [
      userMessage([textPart("prt_restore_0", "Original prompt")], { id: "msg_restore_0", created: 1 }),
      assistantMessage([textPart("prt_restore_1", text)], { id: "msg_restore_1", created: 2 }),
      userMessage([textPart("prt_restore_2", "Middle prompt")], { id: "msg_restore_2", created: 3 }),
      assistantMessage([textPart("prt_restore_3", text)], { id: "msg_restore_3", created: 4 }),
      userMessage([textPart("prt_restore_4", "Another prompt")], { id: "msg_restore_4", created: 5 }),
      assistantMessage([textPart("prt_restore_5", text)], { id: "msg_restore_5", created: 6 }),
      userMessage([textPart("prt_restore_6", "Latest prompt")], { id: "msg_restore_6", created: 7 }),
      assistantMessage([textPart("prt_restore_7", text)], { id: "msg_restore_7", created: 8 }),
    ]

    const requests: (string | undefined)[] = []
    await openSession(page, {
      name: "HistoryRestore",
      sessions: [{ id }, { id: other, directory: "C:/OpenCode/HistoryOther" }],
      pageMessages: (session, _limit, before) => {
        if (session === other)
          return { items: [userMessage([textPart("prt_other", "Other session")], { id: "msg_other" })] }
        requests.push(before)

        if (before === "oldest") return { items: messages.slice(0, 1) }

        if (before === "older") return { items: messages.slice(1, -2), cursor: "oldest" }

        return { items: messages.slice(-2), cursor: "older" }
      },
    })
    const scroller = timelineScroller(page)
    await expect(page.locator("[data-timeline-virtual-content]")).toHaveCSS("visibility", "visible")
    // One upward gesture, without wheel momentum carrying across the page prepend.
    await scroller.evaluate((element) => {
      element.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: -1 }))
      element.scrollTop = 0
    })
    await expect.poll(() => requests).toEqual([undefined, "older"])
    await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBeGreaterThan(200)

    await page.locator(`[data-slot="titlebar-tabs"] a[href="${sessionHref(other)}"]`).click()
    await expect(page.getByText("Other session", { exact: true })).toBeVisible()
    // Only the return needs controlled time. A fake clock from the start also runs the first mount's frames late,
    // and a scroll to the end queued by one of them lands after the upward gesture.
    await page.clock.install()
    await page.locator(`[data-slot="titlebar-tabs"] a[href="${sessionHref(id)}"]`).click()
    await expect(page.locator("[data-timeline-virtual-content]")).toHaveCSS("visibility", "visible")
    // Exhaust the delayed leading-turn enrichment without a real-time sleep.
    await page.clock.runFor(1_000)
    expect(requests).toEqual([undefined, "older"])

    await scroller.evaluate((element) => {
      element.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: -1 }))
      element.scrollTop = 0
    })
    await expect(page.getByText("Original prompt", { exact: true })).toBeInViewport()
    expect(requests).toEqual([undefined, "older", "oldest"])
  })

  test("keeps visible rows fixed while an older page prepends", async ({ page }) => {
    const older = Promise.withResolvers<void>()
    const requests: { before?: string; phase: "start" | "end" }[] = []
    await openStressTarget(page, {
      beforeMessagesResponse: ({ before }) => (before ? older.promise : Promise.resolve()),
      onMessages: (request) => requests.push(request),
    })
    const scroller = timelineScroller(page)
    await scroller.hover()
    await page.mouse.wheel(0, -100_000)
    await expect.poll(() => requests.some((request) => request.before && request.phase === "start")).toBe(true)
    await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBeLessThanOrEqual(1)

    const keys = await scroller.evaluate((element) => {
      const view = element.getBoundingClientRect()

      return [...element.querySelectorAll<HTMLElement>("[data-timeline-part-id]")]
        .filter((row) => {
          const rect = row.getBoundingClientRect()

          return rect.bottom > view.top && rect.top < view.bottom
        })
        .flatMap((row) => (row.dataset.timelinePartId ? [row.dataset.timelinePartId] : []))
        .slice(0, 3)
    })

    expect(keys).toHaveLength(3)

    const positions = () =>
      scroller.evaluate((element, keys) => {
        const top = element.getBoundingClientRect().top

        return keys.map((key) => {
          const row = element.querySelector<HTMLElement>(`[data-timeline-part-id="${key}"]`)

          if (!row) return undefined

          return Math.round((row.getBoundingClientRect().top - top) * devicePixelRatio) / devicePixelRatio
        })
      }, keys)

    const before = await positions()
    const height = await scroller.evaluate((element) => element.scrollHeight)
    expect(requests.some((request) => request.before && request.phase === "end")).toBe(false)

    older.resolve()
    await expect.poll(() => requests.some((request) => request.before && request.phase === "end")).toBe(true)
    // The older page has landed above the visible rows.
    await expect.poll(() => scroller.evaluate((element) => element.scrollHeight)).toBeGreaterThan(height)
    await expect.poll(positions).toEqual(before)
  })

  // Each native scroll write forces a layout of the rows resized before it.
  test("corrects the scroll position once for each batch of rows an older page measures", async ({ page }) => {
    const messages = [
      ...historyMessages(40),
      userMessage(),
      assistantMessage([textPart("prt_active", "Checking the route")]),
    ]

    // Scroll writes on the timeline, counted for each synchronous run: a batch of measured rows is one run.
    await page.addInitScript(() => {
      const scrollTo = Element.prototype.scrollTo
      const runs: number[] = (window.__scrollWrites = [])
      const run = { open: false }

      Element.prototype.scrollTo = function (
        this: Element,
        ...args: [options?: ScrollToOptions] | [x: number, y: number]
      ) {
        if (this.matches(".scroll-view__viewport") && !run.open) {
          run.open = true
          runs.push(0)
          queueMicrotask(() => (run.open = false))
        }

        if (this.matches(".scroll-view__viewport")) runs[runs.length - 1]!++
        const scroll = scrollTo.bind(this)

        if (args.length === 2) return scroll(args[0], args[1])

        return scroll(args[0])
      }
    })
    await setupTimeline(page, {
      sessionMessages: messages,
      pageMessages: (_, limit, before) => {
        const end = before ? messages.findIndex((message) => message.id === before) : messages.length
        const start = Math.max(0, end - Math.min(16, limit))

        return { items: messages.slice(start, end), cursor: start ? messages[start]!.id : undefined }
      },
    })

    const scroller = timelineScroller(page)
    await expect(scroller.getByText("Checking the route", { exact: true })).toBeInViewport()
    await page.evaluate(() => window.__scrollWrites?.splice(0))
    // Each scroll to the top loads an older page, whose rows are measured above the reader.
    await scroller.hover()
    await expect(async () => {
      await page.mouse.wheel(0, -100_000)
      await expect(scroller.getByText(/^Historical response 0\. /)).toBeInViewport({ timeout: 1_000 })
    }).toPass()
    const writes = await page.evaluate(() => window.__scrollWrites ?? [])
    expect(writes.length).toBeGreaterThan(0)
    expect(Math.max(...writes)).toBe(1)
  })

  test("Jump to latest glides on while an older page loads above the view", async ({ page }) => {
    // A glide lets no other scroll jump the view to the end. The scroll that keeps the view's place when history
    // loads above it must still count, or the older page shows for a frame before the glide brings the view back.
    const older = Promise.withResolvers<void>()
    const requests: { before?: string; phase: "start" | "end" }[] = []
    await openStressTarget(page, {
      beforeMessagesResponse: ({ before }) => (before ? older.promise : Promise.resolve()),
      onMessages: (request) => requests.push(request),
    })
    const scroller = timelineScroller(page)
    await scroller.hover()
    await page.mouse.wheel(0, -100_000)
    await expect.poll(() => requests.some((request) => request.before && request.phase === "start")).toBe(true)
    await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBeLessThanOrEqual(1)
    const height = await scroller.evaluate((element) => element.scrollHeight)

    const fromEnd = () =>
      scroller.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop)

    // The glide runs on frames, so the test steps them. See "tab preview opens cold" in tabs.spec.ts for the pause.
    const start = Date.now()
    await page.clock.install({ time: start })
    await page.clock.pauseAt(start + 10_000)
    await page.getByRole("button", { name: "Jump to latest", exact: true }).click()
    await page.clock.runFor(100)
    const left = await fromEnd()
    const screen = await scroller.evaluate((element) => element.clientHeight)
    // The glide is under way: a good part of the last screen is still to go.
    expect(left).toBeGreaterThan(screen / 4)
    older.resolve()
    await expect.poll(() => scroller.evaluate((element) => element.scrollHeight)).toBeGreaterThan(height)
    // No frame has run since, so only the older page could have moved the view. None of the older page shows, and
    // the view is still short of the end, where the glide has it: a jump to the end would leave no distance.
    const landed = await fromEnd()
    expect(landed).toBeLessThanOrEqual(left)
    expect(landed).toBeGreaterThan(screen / 4)
    // The glide goes on from there, a part of the way in each frame.
    const gaps: number[] = []

    for (const _ of [1, 2, 3, 4]) {
      await page.clock.runFor(16)
      gaps.push(await fromEnd())
    }

    const steps = gaps.slice(1).map((gap, index) => gaps[index]! - gap)
    expect(Math.min(...gaps)).toBeGreaterThan(screen / 4)
    expect(Math.min(...steps)).toBeGreaterThan(0)
    expect(Math.max(...steps)).toBeLessThan(screen / 6)
    await page.clock.runFor(2_000)
    await expect.poll(fromEnd).toBeLessThanOrEqual(1)
  })

  test("mounts every part once and in order while paging to the start", async ({ page }) => {
    test.setTimeout(240_000)
    const errors = trackPageErrors(page)
    const held: (() => void)[] = []
    const loads = { started: 0, ended: 0 }
    await page.setViewportSize({ width: 1280, height: 1400 })
    await openStressTarget(page, {
      // Older pages land only between scroll steps, so a step never races the prepend.
      beforeMessagesResponse: ({ before }) =>
        before ? new Promise<void>((resolve) => held.push(resolve)) : Promise.resolve(),
      onMessages: (request) => {
        if (request.before && request.phase === "start") loads.started++

        if (request.before && request.phase === "end") loads.ended++
      },
    })
    const expectedParts = fixture.messages[fixture.targetID]!.flatMap(partIDs)
    const expectedMessages = fixture.expected.targetMessageIDs
    const seenParts = new Set<string>()
    const seenMessages = new Set<string>()

    for (;;) {
      const state = await visibleTimeline(page)
      expectOrdered(expectedParts, state.parts, "mounted parts")
      expectOrdered(expectedParts, state.visibleParts, "visible parts")
      expectOrdered(expectedMessages, state.messages, "mounted messages")
      expectOrdered(expectedMessages, state.visibleMessages, "visible messages")
      expect(state.errorToasts).toBe(0)
      state.parts.forEach((id) => seenParts.add(id))
      state.messages.forEach((id) => seenMessages.add(id))

      if (state.scrollTop <= 1 && seenParts.size === expectedParts.length) break

      if (held.length) {
        held.splice(0).forEach((release) => release())
        await expect.poll(() => loads.ended).toBe(loads.started)
        let previous = ""
        await expect
          .poll(async () => {
            const next = (await visibleTimeline(page)).signature
            const stable = next === previous
            previous = next

            return stable
          })
          .toBe(true)
        continue
      }

      // Scroll instantly and only as far as rows the virtualizer has measured, so neither a smooth wheel
      // animation nor estimated row heights can carry a step past an unmounted row.
      await timelineScroller(page).evaluate((element, delta) => {
        element.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -delta }))
        element.scrollTop -= delta
      }, state.mountedAbove)
      await expect
        .poll(async () => {
          const next = await visibleTimeline(page)

          return held.length > 0 || (next.signature !== state.signature && next.covered)
        })
        .toBe(true)
    }

    expect(expectedParts.filter((id) => !seenParts.has(id))).toEqual([])
    expect(expectedMessages.filter((id) => !seenMessages.has(id))).toEqual([])
    expect(errors).toEqual([])
  })

  for (const scenario of [
    { name: "completion", error: undefined, idleFirst: false },
    { name: "interruption", error: { type: "MessageAbortedError", message: "Stopped" }, idleFirst: true },
  ] as const) {
    test(`keeps visible content through ${scenario.name}`, async ({ page }) => {
      const history = Promise.withResolvers<void>()
      const requests: { before?: string; phase: "start" | "end" }[] = []
      const pages: { before?: string; limit: number }[] = []
      const roots: { sessionID: string; messageID: string }[] = []
      const sequence: string[] = []
      const messages = rootHistory()
      // SAFETY: rootHistory ends each generated turn with an assistant message.
      const last = messages.at(-1) as SessionMessageAssistant
      await page.addInitScript(installVisibilityProbe)

      const timeline = await setupTimeline(page, {
        sessionMessages: messages,
        sessionStatus: { [sessionID]: { type: "busy" } },
        viewport: { width: 646, height: 1385 },
        beforeMessagesResponse: (request) => (request.before ? history.promise : Promise.resolve()),
        onMessages: (request) => {
          requests.push(request)
          sequence.push(`messages:${request.phase}:${request.before ?? "latest"}`)
        },
        onMessage: (request) => roots.push(request),
        message: (requested, messageID) =>
          requested === sessionID ? messages.find((item) => item.id === messageID) : undefined,
        pageMessages: (_, limit, before) => {
          pages.push({ before, limit })
          const end = before ? messages.findIndex((message) => message.id === before) : messages.length
          const start = Math.max(0, end - limit)

          return { items: messages.slice(start, end), cursor: start > 0 ? messages[start]!.id : undefined }
        },
      })

      await expect(page.locator(`[data-timeline-part-id="${last.id}:text:0"]`)).toBeVisible()
      await expect(page.locator(`[data-timeline-part-id="${messages.at(-2)!.id}:text:0"]`)).toBeVisible()
      await timelineScroller(page).hover()
      await page.mouse.wheel(0, -100_000)
      await expect.poll(() => requests.filter((request) => request.phase === "start").length).toBe(2)
      expect(sequence).toEqual(["messages:start:latest", "messages:end:latest", `messages:start:${messages[2]!.id}`])

      // The probe samples every painted frame from here on; the steps below wait for projected state, not samples.
      expect(await page.evaluate(() => window.__historyRootProbe!.arm())).not.toEqual([])
      expect(await page.evaluate(() => window.__historyRootProbe!.hidden)).toBe(false)
      history.resolve()
      await expect.poll(() => requests.filter((request) => request.phase === "end").length).toBe(2)
      await expect(page.getByRole("button", { name: "Stop" })).toBeVisible()
      // The older page is projected above the kept rows.
      await expect(
        page.locator(`[data-timeline-row="UserMessage"][data-message-id="${messages[0]!.id}"]`),
      ).toBeAttached()
      expect(pages).toEqual([
        { before: undefined, limit: 40 },
        { before: messages[2]!.id, limit: 20 },
      ])
      expect(roots).toEqual([])

      const completed = {
        ...last,
        time: { ...last.time, completed: last.time.created + 15_000 },
      }

      if (scenario.error) completed.error = scenario.error

      const message = messageUpdated(completed)
      const idle = status("idle")
      // Idle ends the working turn, so its last text part shows the response actions. A completed step changes
      // nothing visible while the session is still busy; the idle that follows it proves both were projected.
      const actionsSelector = `[data-timeline-part-id="${last.id}:text:0"] [data-slot="text-part-copy-wrapper"]`
      const actions = page.locator(actionsSelector)
      // The final state: the response actions after a completion, the Interrupted notice after an interruption.
      const spacer = { selector: '[data-timeline-row="bottom-spacer"]' }
      await page.evaluate(
        (final) => window.__historyRootProbe!.settle(final),
        scenario.error
          ? {
              attached: [],
              visible: [spacer, { selector: '[data-slot="session-timeline-notice-label"]', text: "Interrupted" }],
            }
          : { attached: [actionsSelector], visible: [spacer] },
      )

      for (const event of scenario.idleFirst ? [idle, message] : [message, idle]) {
        await timeline.send(event)

        if (event === idle) {
          await expect(page.getByRole("button", { name: "Stop" })).toHaveCount(0)
          await expect(actions).toBeAttached()
        }

        if (event === message && scenario.error)
          await expect(page.getByText("Interrupted", { exact: true })).toBeVisible()
        await expect(page.locator("[data-timeline-virtual-content]")).toHaveCount(1)
        await expect(page.locator("[data-timeline-key]")).not.toHaveCount(0)
      }

      await expect(page.getByRole("button", { name: "Stop" })).toHaveCount(0)
      await expect(page.locator('[data-timeline-row="bottom-spacer"]')).toBeVisible()

      if (scenario.error) await expect(page.getByText("Interrupted", { exact: true })).toBeVisible()
      // The DOM can settle before the sampler's next frame; `hidden` is complete once a sample has shown the final state.
      await expect.poll(() => page.evaluate(() => window.__historyRootProbe!.settled)).toBe(true)
      expect(await page.evaluate(() => window.__historyRootProbe!.hidden)).toBe(false)
    })
  }

  for (const composition of ["assistant-only", "mixed"] as const) {
    test(`renders the ${composition} tail before parent hydration and preserves it afterward`, async ({ page }) => {
      const session = { ...fixture.sessions[0]!, id: `ses_hydration_${composition}` }

      // Compact's initial 40 and the next 20 begin with an assistant; page three supplies its parent.
      const messages = Array.from({ length: 61 }, (_, index): SessionMessageInfo => {
        const id = `msg_hydration_${index}`
        const time = { created: 1700000000000 + index * 1_000 }

        if (index === 0 || (composition === "mixed" && index === 59))
          return { id, type: "user", time, text: `Prompt ${index}` }

        return {
          id,
          type: "assistant",
          time: { ...time, completed: time.created + 500 },
          model: { id: "claude-opus-4-6", providerID: "opencode" },
          agent: "build",
          content: [{ type: "text", text: index === 60 ? "## Hydrated tail\n\n**Ready.**" : `Answer ${index}` }],
        }
      })

      const gates = [21, 1].map((index) => ({
        before: messages[index]!.id,
        parent: messages[index === 21 ? 1 : 0]!.id,
        requested: Promise.withResolvers<void>(),
        release: Promise.withResolvers<void>(),
      }))

      const requests: (string | undefined)[] = []
      await page.setViewportSize({ width: 1440, height: 900 })
      await mockStressTimeline(page, {
        sessions: [session],
        beforeMessagesResponse: async ({ before }) => {
          requests.push(before)

          if (!before) return
          const gate = gates.find((gate) => gate.before === before)

          if (!gate) throw new Error(`Unexpected older-page boundary: ${before}`)
          gate.requested.resolve()
          await gate.release.promise
        },
        pageMessages: (_, limit, before) => {
          expect(limit).toBe(before ? 20 : 40)
          const end = before ? messages.findIndex((message) => message.id === before) : messages.length
          const start = Math.max(0, end - limit)

          return { items: messages.slice(start, end), cursor: start > 0 ? messages[start]!.id : undefined }
        },
      })
      const tail = page.locator('[data-timeline-part-id="msg_hydration_60:text:0"]')
      const markdown = tail.locator('[data-component="markdown"]')
      const content = page.locator("[data-timeline-virtual-content]", { has: tail })
      const viewport = page.locator(".scroll-view__viewport", { has: tail })

      const orphan = page.locator('[data-timeline-row="AssistantPart"]', {
        has: page.locator('[data-timeline-part-id="msg_hydration_58:text:0"]'),
      })

      const expectReadyTail = async () => {
        await expect(content).toHaveCSS("visibility", "visible")
        await expect(markdown).toHaveAttribute("data-markdown-ready", "")
        await expect(markdown.getByRole("heading", { name: "Hydrated tail", exact: true })).toBeInViewport({
          ratio: 1,
        })
        await expect
          .poll(() =>
            viewport.evaluate((element) => Math.abs(element.scrollHeight - element.clientHeight - element.scrollTop)),
          )
          .toBeLessThanOrEqual(1)
      }

      try {
        await page.goto(sessionHref(session.id))
        await gates[0]!.requested.promise
        // This must pass while the first older response is still held.
        await expectReadyTail()
        await expect(orphan).toHaveAttribute("data-message-id", "msg_hydration_21")

        if (composition === "mixed")
          await expect(
            page.locator('[data-timeline-row="UserMessage"][data-message-id="msg_hydration_59"]'),
          ).toBeInViewport()
        const original = await markdown.elementHandle()

        for (const gate of gates) {
          await gate.requested.promise
          gate.release.resolve()
          // Parent ownership proves the page reached the projection, not just the network.
          await expect(orphan).toHaveAttribute("data-message-id", gate.parent)
          await expectReadyTail()
          expect(await markdown.evaluate((element, original) => element === original, original)).toBe(true)
        }

        expect(requests).toEqual([undefined, ...gates.map((gate) => gate.before)])

        const ids = await content
          .locator("[data-timeline-part-id]")
          .evaluateAll((elements) => elements.map((element) => element.getAttribute("data-timeline-part-id")))

        expect(new Set(ids).size).toBe(ids.length)
      } finally {
        gates.forEach((gate) => gate.release.resolve())
      }
    })
  }

  test("pages the timeline from the composer and the transcript by what shows between them and the header, resuming follow at the end and loading history at the top", async ({
    page,
  }) => {
    const messages = validateTimelineMessages([
      ...historyMessages(30),
      userMessage(),
      assistantMessage([textPart("prt_page_keys_text", "Paging from the composer")], { completed: false }),
    ])

    const older: string[] = []

    const timeline = await setupTimeline(page, {
      reducedMotion: true,
      message: (_, id) => messages.find((message) => message.id === id),
      pageMessages: (_, limit, before) => {
        const end = before ? messages.findIndex((message) => message.id === before) : messages.length
        const start = Math.max(0, end - limit)

        return { items: messages.slice(start, end), cursor: start > 0 ? messages[start]!.id : undefined }
      },
      onMessages: (request) => {
        if (request.before && request.phase === "start") older.push(request.before)
      },
    })

    const scroller = timelineScroller(page)
    const editor = page.locator('[data-component="composer-editor"]')
    const suggestions = page.locator('[data-component="composer-suggestions"]')
    const top = () => scroller.evaluate((element) => element.scrollTop)

    const fromEnd = () =>
      scroller.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop)

    const caret = () =>
      editor.evaluate((element) => {
        const selection = window.getSelection()!
        const range = document.createRange()
        range.setStart(element, 0)
        range.setEnd(selection.anchorNode!, selection.anchorOffset)

        return range.toString().length
      })

    await expect(page.locator("[data-timeline-virtual-content]")).toHaveCSS("visibility", "visible")
    await expect.poll(fromEnd).toBeLessThanOrEqual(1)
    await editor.click()

    // An open popup keeps the page keys: the timeline stays put and the query stays open.
    await page.keyboard.type("/")
    await expect(suggestions).toBeVisible()
    const resting = await top()
    await editor.press("PageUp")
    expect(await top()).toBe(resting)
    await expect(suggestions).toBeVisible()
    await expect(editor).toHaveText("/")
    await editor.press("Escape")
    await expect(suggestions).toBeHidden()
    await editor.press("Backspace")

    await page.keyboard.type("keep this draft")

    // The viewport runs on under the session header and the composer region; the reader sees what is between them.
    const shown = await page.evaluate(() => {
      const header = document.querySelector("[data-session-title]")!.getBoundingClientRect()
      const visible = document.querySelector('[data-slot="session-timeline-visible"]')!.getBoundingClientRect()

      return visible.bottom - header.bottom
    })

    // How far the first row below the header moves down the screen. The scroll offset would also count the rows that
    // measure above the view.
    const paged = async (press: () => Promise<void>) => {
      const key = await scroller.evaluate((element) => {
        const header = document.querySelector("[data-session-title]")!.getBoundingClientRect().bottom

        return [...element.querySelectorAll<HTMLElement>("[data-timeline-key]")].find(
          (row) => row.getBoundingClientRect().top >= header,
        )!.dataset.timelineKey!
      })

      const row = scroller.locator(`[data-timeline-key="${key}"]`)
      const from = (await row.boundingBox())!.y
      await press()

      return () => row.boundingBox().then((box) => Math.round(box!.y - from))
    }

    const toEnd = async () => {
      for (let index = 0; index < 10 && (await fromEnd()) > 1; index++) await editor.press("PageDown")
      await expect.poll(fromEnd).toBeLessThanOrEqual(1)
    }

    // A first visit measures the rows above, which moves the rows in view further. Visit them once before measuring.
    // The scroll offset does not say whether the page moved: the older page that this page asks for lands above the
    // view and raises it.
    const visited = await paged(() => editor.press("PageUp"))
    await expect.poll(visited).toBeGreaterThan(0)
    await toEnd()

    const fromComposer = await paged(() => editor.press("PageUp"))
    await expect.poll(fromComposer).toBeGreaterThan(shown * 0.6)
    const distance = await fromComposer()
    expect(distance).toBeLessThanOrEqual(shown)
    await expect(editor).toBeFocused()
    await expect(editor).toHaveText("keep this draft")
    expect(await caret()).toBe("keep this draft".length)
    await toEnd()

    // The same key pressed in the transcript moves the same page, not one that counts what the composer covers.
    await scroller.focus()
    const fromTranscript = await paged(() => page.keyboard.press("PageUp"))
    await expect.poll(async () => Math.abs((await fromTranscript()) - distance)).toBeLessThanOrEqual(1)

    // Paging back to the end follows new content again, as a wheel scroll there does.
    await toEnd()
    await timeline.send(partUpdated(textPart("prt_page_keys_tail", "Arrived after paging down.\n\n".repeat(20))))
    await timeline.waitForPart("prt_page_keys_tail")
    await expect.poll(fromEnd).toBeLessThanOrEqual(1)

    // Paging to the top loads the older page, as scrolling there does.
    for (let index = 0; index < 30 && (await top()) > 1; index++) await editor.press("PageUp")
    await expect.poll(() => older[0]).toBe(messages[messages.length - 40]!.id)
    await expect(editor).toBeFocused()
    await expect(editor).toHaveText("keep this draft")
  })

  test("a message hash and message navigation land the prompt below the session header and keep the hash in step", async ({
    page,
  }) => {
    const messages = validateTimelineMessages([
      ...historyMessages(20),
      userMessage(),
      assistantMessage([textPart("prt_cursor_tail", "Latest answer")]),
    ])

    const prompt = (index: number) => messages.filter((message) => message.type === "user")[index]!.id
    const selector = (index: number) => `[data-timeline-row="UserMessage"][data-message-id="${prompt(index)}"]`
    const row = (index: number) => page.locator(selector(index))
    const hash = () => page.evaluate(() => location.hash)

    // Where the prompt rests, against the lower edge of the session header and its fade, which cover the viewport's
    // top. Several scrolls land a prompt one after another, so only the place it stays at counts.
    const belowHeader = async (index: number) => {
      await waitForVisualSettle(page, [selector(index)], 6)

      return row(index).evaluate((element) =>
        Math.round(
          element.getBoundingClientRect().top -
            document.querySelector("[data-session-title]")!.getBoundingClientRect().bottom,
        ),
      )
    }

    await setupTimeline(page, { sessionMessages: messages })
    await expect(page.getByText("Latest answer", { exact: true })).toBeInViewport()
    await page.evaluate((id) => (location.hash = `#message-${id}`), prompt(10))
    expect(await belowHeader(10)).toBe(0)

    await page.keyboard.press("Control+Alt+BracketLeft")
    await expect.poll(hash).toBe(`#message-${prompt(9)}`)
    expect(await belowHeader(9)).toBe(0)
    await page.keyboard.press("Control+Alt+BracketRight")
    await expect.poll(hash).toBe(`#message-${prompt(10)}`)
    expect(await belowHeader(10)).toBe(0)

    // A link to a prompt whose rows are mounted and measured: nothing measures afterwards to correct where it lands.
    await page.evaluate((id) => (location.hash = `#message-${id}`), prompt(9))
    await expect.poll(hash).toBe(`#message-${prompt(9)}`)
    expect(await belowHeader(9)).toBe(0)

    await page.getByRole("button", { name: "Jump to latest" }).click()
    await expect.poll(hash).toBe("")
    const latest = page.getByText("Latest answer", { exact: true })
    await expect(latest).toBeInViewport()

    // Browser Back off a page anchor returns to the latest message, as Back off a prompt does.
    await page.evaluate(() => (location.hash = "#notes"))
    await expect.poll(hash).toBe("#notes")
    await timelineScroller(page).hover()
    await page.mouse.wheel(0, -5_000)
    await expect(latest).not.toBeInViewport()
    await page.evaluate(() => history.back())
    await expect.poll(hash).toBe("")
    await expect(latest).toBeInViewport()
  })

  // The timeline goes to the prompt while it is still hidden and its rows have no sizes. The prompt and its reply
  // then stand a few lines from the end of a short scroll range. A correction for the rows above moved the view
  // onto that end, which counted as the reader's return to the latest message: the link was dropped and the session
  // opened on its end. Without that, the range was still too short to bring the prompt up to its place.
  test("a link that opens the session on its newest prompt lands the prompt below the session header", async ({
    page,
  }) => {
    const messages = validateTimelineMessages([
      ...historyMessages(20),
      userMessage(),
      // Taller than the window, so the prompt is not within sight of the end once the reply has its size.
      assistantMessage([
        textPart("prt_cold_tail", Array.from({ length: 120 }, (_, index) => `Paragraph ${index}.`).join("\n\n")),
      ]),
    ])

    const selector = `[data-timeline-row="UserMessage"][data-message-id="${userID}"]`
    await setupTimeline(page, { sessionMessages: messages })
    await expect(page.getByText("Paragraph 119.", { exact: true })).toBeInViewport()

    // The same session again from a link, with nothing measured.
    await page.evaluate((id) => (location.hash = `#message-${id}`), userID)
    await page.reload()
    await expect(page.locator("[data-timeline-virtual-content]")).toHaveCSS("visibility", "visible")
    await expect(page.locator(selector)).toBeInViewport()
    await waitForVisualSettle(page, [selector], 6)
    expect(await page.evaluate(() => location.hash)).toBe(`#message-${userID}`)

    expect(
      await page
        .locator(selector)
        .evaluate((element) =>
          Math.round(
            element.getBoundingClientRect().top -
              document.querySelector("[data-session-title]")!.getBoundingClientRect().bottom,
          ),
        ),
    ).toBe(0)
  })

  // The timeline scrolls to a row by its index, for up to five seconds. A page of history that arrived above in that
  // time gave the index to another row, and the timeline went there.
  test("Find reaches its match when an older page arrives while the timeline scrolls to it", async ({ page }) => {
    const history = historyMessages(30)

    const all = validateTimelineMessages([
      ...history.slice(0, 40),
      userMessage(undefined, { id: "msg_00019_seek_a_user", created: 1690000195000 }),
      assistantMessage([textPart("prt_seek_match", "The needle rests here.")], {
        id: "msg_00019_seek_b_assistant",
        parentID: "msg_00019_seek_a_user",
        created: 1690000196000,
      }),
      ...history.slice(40),
      userMessage(),
      assistantMessage([textPart("prt_seek_tail", "The newest answer.")]),
    ])

    const older = Promise.withResolvers<void>()
    const requests: string[] = []
    await setupTimeline(page, {
      sessionMessages: all,
      pageMessages: (_session, _limit, before) =>
        before ? { items: all.slice(0, 20) } : { items: all.slice(20), cursor: "older" },
      beforeMessagesResponse: ({ before }) => (before ? older.promise : Promise.resolve()),
      onMessages: (request) => {
        if (request.before && request.phase === "start") requests.push(request.before)
      },
    })
    const scroller = timelineScroller(page)
    await expect(page.getByText("The newest answer.", { exact: true })).toBeInViewport()

    // Up to the top of what is loaded, which asks for the older page. It stays on its way.
    await scroller.hover()
    await page.mouse.wheel(0, -100_000)
    await expect.poll(() => requests).toEqual(["older"])
    await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBeLessThanOrEqual(1)

    // The last row stays mounted, and its index grows by the rows that land above.
    const rows = () =>
      scroller.evaluate((element) =>
        Math.max(...[...element.querySelectorAll<HTMLElement>("[data-index]")].map((row) => Number(row.dataset.index))),
      )

    const loaded = await rows()

    await page.keyboard.press("ControlOrMeta+f")
    const search = page.locator('[data-component="timeline-search-bar"] input')
    await expect(search).toBeFocused()

    // No frame runs between the start of the scroll to the match's row and the page that lands above it.
    const start = Date.now()
    await page.clock.install({ time: start })
    await page.clock.pauseAt(start + 10_000)
    await search.fill("needle rests")
    older.resolve()
    await expect.poll(rows).toBeGreaterThan(loaded)
    await page.clock.runFor(2_000)

    expect(
      await page.evaluate(() => {
        const match = [...(CSS.highlights.get("timeline-search-hit-active") ?? [])][0]

        if (!(match instanceof Range)) return "no match"
        const rect = match.getBoundingClientRect()
        const header = document.querySelector("[data-session-title]")!.getBoundingClientRect()
        const dock = document.querySelector('[data-component="session-composer-dock"]')!.getBoundingClientRect()

        return rect.height > 0 && rect.top >= header.bottom && rect.bottom <= dock.top ? "shown" : "out of sight"
      }),
    ).toBe("shown")
  })

  test("a hash for a prompt the revert hides, or one that does not exist, clears without paging history", async ({
    page,
  }) => {
    const messages = validateTimelineMessages([
      ...historyMessages(30),
      userMessage(),
      assistantMessage([textPart("prt_hash_missing_tail", "Reverted answer")]),
    ])

    const older: string[] = []
    const hash = () => page.evaluate(() => location.hash)

    await setupTimeline(page, {
      sessions: [session({ revert: { messageID: userID } })],
      message: (_, id) => messages.find((message) => message.id === id),
      pageMessages: (_, limit, before) => {
        const end = before ? messages.findIndex((message) => message.id === before) : messages.length
        const start = Math.max(0, end - limit)

        return { items: messages.slice(start, end), cursor: start > 0 ? messages[start]!.id : undefined }
      },
      onMessages: (request) => {
        if (request.before && request.phase === "start") older.push(request.before)
      },
    })
    await expect(page.locator("[data-timeline-virtual-content]")).toHaveCSS("visibility", "visible")
    const loaded = [...older]

    // The revert hides this prompt, and older pages hold only older messages, so neither link can ever load.
    await page.evaluate((id) => (location.hash = `#message-${id}`), userID)
    await expect.poll(hash).toBe("")
    await page.evaluate(() => (location.hash = "#message-msg_9999_missing"))
    await expect.poll(hash).toBe("")
    expect(older).toEqual(loaded)
  })
})

declare global {
  interface Window {
    __historyRootProbe?: { arm(): string[]; hidden: boolean; settle(final: ProbeFinal): void; settled: boolean }
    __scrollWrites?: number[]
  }
}

async function openStressTarget(page: Page, input: Parameters<typeof mockStressTimeline>[1] = {}) {
  await mockStressTimeline(page, input)
  await installTimelineSettings(page)
  await page.goto(sessionHref(fixture.targetID))
  await expectSessionTitle(page, fixture.expected.targetTitle)
  await expect(page.locator("[data-timeline-virtual-content]")).toHaveCSS("visibility", "visible")
}

function timelineScroller(page: Page) {
  return page.locator(".scroll-view__viewport", { has: page.locator("[data-timeline-row]") })
}

function visibleTimeline(page: Page) {
  return timelineScroller(page).evaluate((scroller) => {
    const view = scroller.getBoundingClientRect()

    const inView = (element: Element) => {
      const rect = element.getBoundingClientRect()

      return rect.bottom >= view.top && rect.top <= view.bottom
    }

    const parts = [...scroller.querySelectorAll<HTMLElement>("[data-timeline-part-id], [data-timeline-part-ids]")]

    const partIDs = (element: HTMLElement) =>
      [element.dataset.timelinePartId, ...(element.dataset.timelinePartIds?.split(",") ?? [])].filter(
        (id): id is string => !!id,
      )

    const messages = [...scroller.querySelectorAll<HTMLElement>("[data-message-id]")]
    const messageIDs = (elements: HTMLElement[]) => [...new Set(elements.map((element) => element.dataset.messageId!))]

    const firstRowTop = Math.min(
      ...[...scroller.querySelectorAll("[data-timeline-key]")].map((row) => row.getBoundingClientRect().top),
    )

    return {
      parts: parts.flatMap(partIDs),
      visibleParts: parts.filter(inView).flatMap(partIDs),
      messages: messageIDs(messages),
      visibleMessages: messageIDs(messages.filter(inView)),
      scrollTop: Math.round(scroller.scrollTop),
      // Mounted rows reach the top edge, so the virtualizer has rendered this position. Below 200px the
      // timeline requests the next older page instead.
      covered: scroller.scrollTop < 200 || firstRowTop <= view.top + 1,
      mountedAbove: Math.max(80, Math.floor(view.top - firstRowTop)),
      errorToasts: document.querySelectorAll(".toast-v2--error").length,
      signature: JSON.stringify([
        Math.round(scroller.scrollTop),
        Math.round(scroller.scrollHeight),
        parts.flatMap(partIDs),
      ]),
    }
  })
}

function expectOrdered(expected: string[], actual: string[], label: string) {
  expect(actual.length, `${label} should not be empty`).toBeGreaterThan(0)
  const present = new Set(actual)
  expect(actual, label).toEqual(expected.filter((id) => present.has(id)))
}

function partIDs(message: SessionMessageInfo) {
  if (message.type === "user") return [`${message.id}:text:0`]

  if (message.type !== "assistant") return []
  const ordinals = { text: 0, reasoning: 0 }

  return message.content.flatMap((part) => {
    if (part.type === "text" || part.type === "reasoning")
      return [`${message.id}:${part.type}:${ordinals[part.type]++}`]

    if (part.type === "tool") return [part.id]

    return []
  })
}

// 21 turns: the latest 40-message page starts at the second turn, so one older page of 20 reaches the first.
function rootHistory() {
  return Array.from({ length: 21 }, (_, index) => {
    const id = `msg_${String(index + 1001).padStart(4, "0")}_history_root_user`

    return [
      userMessage(undefined, { id, created: 1700000000000 + index * 2_000 }),
      assistantMessage([textPart(`prt_history_root_${index}`, `Assistant response ${index}`)], {
        id: `msg_${String(index + 1001).padStart(4, "0")}_history_root_assistant`,
        parentID: id,
        created: 1700000001000 + index * 2_000,
        completed: index < 20,
      }),
    ]
  }).flat()
}

// A state the probe waits to see painted: every `attached` selector matches, and every `visible` entry matches a
// visible element (with exactly `text`, when set).
type ProbeFinal = { attached: string[]; visible: { selector: string; text?: string }[] }

// Samples every painted frame and records whether any part that was visible when armed disappeared. After `settle`,
// it also records (`settled`) the first sample that shows the final state, so `hidden` then covers that frame.
function installVisibilityProbe() {
  const shown = (element: Element) => {
    const rect = element.getBoundingClientRect()

    return rect.width > 0 && rect.height > 0 && element.checkVisibility({ visibilityProperty: true })
  }

  const shows = (final: ProbeFinal) =>
    final.attached.every((selector) => document.querySelector(selector)) &&
    final.visible.every((entry) =>
      [...document.querySelectorAll(entry.selector)].some(
        (element) => shown(element) && (entry.text === undefined || element.textContent?.trim() === entry.text),
      ),
    )

  const visibleParts = () => {
    const viewport = document.querySelector("[data-timeline-virtual-content]")?.closest(".scroll-view__viewport")
    const view = viewport?.getBoundingClientRect()

    if (!viewport || !view) return []

    return [...viewport.querySelectorAll<HTMLElement>("[data-timeline-part-id]")]
      .filter((part) => {
        const rect = part.getBoundingClientRect()

        return rect.width > 0 && rect.height > 0 && rect.bottom > view.top && rect.top < view.bottom
      })
      .flatMap((part) => (part.dataset.timelinePartId ? [part.dataset.timelinePartId] : []))
  }

  // SAFETY: arm populates parts with visible part IDs; settle supplies the optional final state.
  const state = {
    armed: false,
    hidden: false,
    parts: [] as string[],
    final: undefined as ProbeFinal | undefined,
    settled: false,
    // Returns the parts that must stay visible.
    arm() {
      state.parts = visibleParts()
      state.armed = true

      return state.parts
    },
    settle(final: ProbeFinal) {
      state.final = final
      state.settled = false
    },
  }

  window.__historyRootProbe = state

  const sample = () => {
    if (state.armed) {
      const visible = new Set(visibleParts())

      if (state.parts.length === 0 || state.parts.some((partID) => !visible.has(partID))) state.hidden = true

      if (state.final && !state.settled) state.settled = shows(state.final)
    }

    requestAnimationFrame(() => setTimeout(sample, 0))
  }

  requestAnimationFrame(() => setTimeout(sample, 0))
}
