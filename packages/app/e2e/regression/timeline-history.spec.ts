import type { SessionMessageAssistant, SessionMessageInfo } from "@opencode/client/promise"
import { expect, test, type Page } from "@playwright/test"
import { sessionHref } from "../utils/app"
import { trackPageErrors } from "../utils/errors"
import { fixture, installTimelineSettings, mockStressTimeline } from "../utils/session-fixture"
import {
  assistantMessage,
  historyMessages,
  messageUpdated,
  partUpdated,
  sessionID,
  setupTimeline,
  status,
  stepStarted,
  textPart,
  userMessage,
  validateTimelineMessages,
} from "../utils/timeline"
import { expectSessionTitle } from "../utils/waits"
import { openSession } from "../utils/workspace"

test.use({ serviceWorkers: "block" })

test.describe("timeline history", () => {
  for (const scenario of [
    { name: "long reply", disabled: false, paragraphs: 60 },
    { name: "disabled divider", disabled: true, paragraphs: 60 },
    { name: "last screen", disabled: false, paragraphs: 11 },
  ])
    test(`reopens at locally unseen messages: ${scenario.name}`, async ({ page }) => {
      const id = "ses_new_messages"

      let messages = [
        userMessage([textPart("prt_new_prompt", "Explain the implementation")], { id: "msg_new_prompt", created: 1 }),
        assistantMessage([textPart("prt_seen", "Already read")], { id: "msg_seen", created: 2 }),
      ]

      await openSession(page, {
        name: "NewMessages",
        sessions: [{ id }],
        pageMessages: () => ({ items: messages }),
        seed: scenario.disabled ? { settings: { general: { newMessagesDivider: false } } } : undefined,
      })
      await expect(page.getByText("Already read", { exact: true })).toBeVisible()
      await expect(page.locator("[data-timeline-virtual-content]")).toHaveCSS("visibility", "visible")
      messages = [
        ...messages,
        assistantMessage(
          [
            textPart(
              "prt_new_reply",
              Array.from({ length: scenario.paragraphs }, (_, index) => `New paragraph ${index}.`).join("\n\n"),
            ),
          ],
          { id: "msg_new_reply", created: 3 },
        ),
      ]
      await page.reload()
      await expectSessionTitle(page, id)
      const notice = page.locator('[data-slot="session-timeline-notice"]').getByText("New", { exact: true })

      if (scenario.disabled) {
        await expect(page.getByText(`New paragraph ${scenario.paragraphs - 1}.`, { exact: true })).toBeInViewport()
        await expect(notice).toHaveCount(0)

        return
      }

      await expect(notice).toBeInViewport()
      await expect(page.getByText("New paragraph 0.", { exact: true })).toBeInViewport()
      const scroller = timelineScroller(page)

      if (scenario.name === "last screen") {
        await page.setViewportSize({ width: 1280, height: 600 })
        await expect
          .poll(() => scroller.evaluate((element) => element.scrollHeight - element.clientHeight))
          .toBeGreaterThan(12)
        const overflow = await scroller.evaluate((element) => element.scrollHeight - element.clientHeight)

        await page.setViewportSize({ width: 1280, height: 600 + overflow - 12 })
        await expect
          .poll(() => scroller.evaluate((element) => element.scrollHeight - element.clientHeight))
          .toBeCloseTo(12, 0)
      }

      const dismissal = await scroller.evaluateHandle((element, last) => {
        element.scrollTop = element.scrollHeight

        const paragraph = [...element.querySelectorAll("p")].find(
          (item) => item.textContent === `New paragraph ${last}.`,
        )

        if (!paragraph) throw new Error("Missing the last new paragraph")

        const state = { before: paragraph.getBoundingClientRect().top, shift: 0, dismissed: false }

        const sample = () => {
          state.shift = Math.max(state.shift, Math.abs(paragraph.getBoundingClientRect().top - state.before))

          const notice = element.querySelector(
            '[data-timeline-row="NewMessages"] [data-slot="session-timeline-notice"]',
          )

          state.dismissed = !notice?.checkVisibility({ visibilityProperty: true })

          if (!state.dismissed) requestAnimationFrame(sample)
        }

        requestAnimationFrame(sample)
        element.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: 100_000 }))

        return state
      }, scenario.paragraphs - 1)

      await expect(page.getByText(`New paragraph ${scenario.paragraphs - 1}.`, { exact: true })).toBeInViewport()
      await expect(notice).toBeHidden()
      await expect.poll(() => dismissal.evaluate((state) => state.dismissed)).toBe(true)
      expect(await dismissal.evaluate((state) => state.shift)).toBeLessThanOrEqual(1)

      if (scenario.name === "last screen") {
        await page.setViewportSize({ width: 1280, height: 400 })
        await expect
          .poll(() => scroller.evaluate((element) => element.scrollHeight - element.clientHeight))
          .toBeGreaterThan(200)
        await scroller.evaluate((element) => {
          element.scrollTop = element.scrollHeight
          element.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: 1 }))
        })
        await expect(page.locator('[data-timeline-row="NewMessages"]')).toHaveCount(0)
        await expect(page.getByText("New paragraph 10.", { exact: true })).toBeInViewport()
      }
    })

  test("returning to a cached session lands on work streamed while another tab was open", async ({ page }) => {
    const other = "ses_new_other"

    let history = [userMessage(), assistantMessage([textPart("prt_cached_seen", "Read before switching")])]

    const workspace = await openSession(page, {
      name: "NewMessagesCached",
      sessions: [{ id: sessionID }, { id: other, directory: "C:/OpenCode/UnreadOther" }],
      pageMessages: (id) => ({
        items: id === other ? [userMessage([textPart("prt_other", "Other session")])] : history,
      }),
    })

    await expect(page.getByText("Read before switching", { exact: true })).toBeVisible()
    await page.locator(`[data-slot="titlebar-tabs"] a[href="${sessionHref(other)}"]`).click()
    await expect(page.getByText("Other session", { exact: true })).toBeVisible()

    const text = textPart(
      "prt_cached_reply",
      Array.from({ length: 40 }, (_, index) => `Cached reply ${index}.`).join("\n\n"),
    )

    const reply = assistantMessage([], { id: "msg_cached_new_reply", completed: false, created: 1700000002000 })

    history = [
      ...history,
      { ...reply, content: [{ type: "text", text: text.text }], time: { ...reply.time, completed: 1700000003000 } },
    ]

    await workspace.push([
      status("busy"),
      stepStarted(reply),
      ...partUpdated({
        ...text,
        messageID: reply.id,
      }),
      messageUpdated(reply),
      status("idle"),
      status("busy", 1, other),
    ])
    const tab = page.locator(`[data-slot="titlebar-tabs"] a[href="${sessionHref(sessionID)}"]`)

    // Wait for the stream to reach the active session before switching back.
    await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeVisible()
    await tab.click()
    await expect(
      page.locator('[data-slot="session-timeline-notice"]').getByText("New", { exact: true }),
    ).toBeInViewport()
    await expect(page.getByText("Cached reply 0.", { exact: true })).toBeInViewport()
    await page.getByRole("button", { name: "Jump to latest" }).click()
    await expect(page.getByText("Cached reply 39.", { exact: true })).toBeInViewport()
    await expect(page.locator('[data-timeline-row="NewMessages"]')).toHaveCount(0)
  })

  test("marks new work above an undelivered steer", async ({ page }) => {
    const id = "ses_unread_steer"

    let messages = [
      userMessage([textPart("prt_unread_prompt", "Read the code")], { id: "msg_1000_unread_prompt", created: 1 }),
      assistantMessage([textPart("prt_unread_seen", "Read work")], {
        id: "msg_1001_unread_work",
        parentID: "msg_1000_unread_prompt",
        created: 2,
        completed: false,
      }),
    ]

    await openSession(page, {
      name: "UnreadSteer",
      sessions: [{ id }],
      sessionStatus: { [id]: { type: "busy" } },
      pageMessages: () => ({ items: messages }),
      inbox: [
        {
          id: "msg_1002_unread_steer",
          sessionID: id,
          type: "user",
          delivery: "steer",
          payload: { text: "Waiting prompt" },
          time: { created: 3 },
        },
      ],
    })
    await expect(
      page.locator('[data-timeline-row="UserMessage"]').getByText("Waiting prompt", { exact: true }),
    ).toBeVisible()
    await expect(page.getByText("Read work", { exact: true })).toBeVisible()
    await expect(page.locator("[data-timeline-virtual-content]")).toHaveCSS("visibility", "visible")
    messages = [
      messages[0],
      assistantMessage(
        [
          textPart("prt_unread_seen", "Read work"),
          textPart("prt_unread_new", Array.from({ length: 60 }, (_, index) => `Unseen work ${index}.`).join("\n\n")),
        ],
        { id: "msg_1001_unread_work", parentID: "msg_1000_unread_prompt", created: 2, completed: false },
      ),
    ]
    await page.reload()
    await expect(page.locator('[data-timeline-row="NewMessages"]').getByText("New", { exact: true })).toBeInViewport()
    await expect(page.getByText("Unseen work 0.", { exact: true })).toBeInViewport()
  })

  test("lands at the true unread boundary when older unread history loads", async ({ page }) => {
    const id = "ses_unread_pages"

    let messages: SessionMessageInfo[] = [
      userMessage([textPart("prt_unread_pages_prompt", "Keep working")], { id: "msg_0000_unread_pages", created: 1 }),
      assistantMessage([textPart("prt_unread_pages_seen", "Read before leaving")], {
        id: "msg_0001_unread_pages",
        parentID: "msg_0000_unread_pages",
        created: 2,
      }),
    ]

    await openSession(page, {
      name: "UnreadPages",
      sessions: [{ id }],
      pageMessages: (_id, _limit, before) => {
        const end = before ? Number(before) : messages.length

        const start = Math.max(0, end - 20)

        return { items: messages.slice(start, end), cursor: start ? String(start) : undefined }
      },
    })
    await expect(page.getByText("Read before leaving", { exact: true })).toBeVisible()
    await expect(page.locator("[data-timeline-virtual-content]")).toHaveCSS("visibility", "visible")
    // The unread span exceeds the initial page and three enrichment pages.
    messages = [
      ...messages,
      ...Array.from({ length: 90 }, (_, index) =>
        assistantMessage([textPart(`prt_unread_page_${index}`, `Unread response ${index}`)], {
          id: `msg_${String(index + 2).padStart(4, "0")}_unread_pages`,
          parentID: "msg_0000_unread_pages",
          created: index + 3,
        }),
      ),
    ]
    await page.reload()
    const notice = page.locator('[data-timeline-key="new-messages:msg_0002_unread_pages:text:0"]')

    await expect(notice).toBeInViewport()
    await expect(page.getByText("Unread response 0", { exact: true })).toBeInViewport()
  })

  test("keeps unread replies before a prompt sent from another client", async ({ page }) => {
    const id = "ses_unread_remote"

    let messages = [
      userMessage([textPart("prt_remote_prompt", "Start working")], { id: "msg_remote_0", created: 1 }),
      assistantMessage([textPart("prt_remote_seen", "Already read")], { id: "msg_remote_1", created: 2 }),
    ]

    const view = await openSession(page, {
      name: "UnreadRemote",
      sessions: [{ id }],
      pageMessages: () => ({ items: messages }),
    })

    await expect(page.getByText("Already read", { exact: true })).toBeVisible()
    await expect(page.locator("[data-timeline-virtual-content]")).toHaveCSS("visibility", "visible")
    messages = [
      ...messages,
      assistantMessage([textPart("prt_remote_unread", "Unread before the other client's prompt")], {
        id: "msg_remote_2",
        created: 3,
      }),
      userMessage([textPart("prt_remote_other", "Sent from another client")], { id: "msg_remote_3", created: 4 }),
      assistantMessage(
        [textPart("prt_remote_reply", Array.from({ length: 40 }, (_, index) => `Remote reply ${index}.`).join("\n\n"))],
        { id: "msg_remote_4", created: 5 },
      ),
    ]
    await page.reload()
    await expect(page.locator('[data-timeline-key="new-messages:msg_remote_2:text:0"]')).toBeInViewport()
    await expect(page.getByText("Unread before the other client's prompt", { exact: true })).toBeInViewport()
    await view.editor.fill("Continue from this client")
    await view.editor.press("Enter")
    await expect(page.getByText("Remote reply 39.", { exact: true })).toBeInViewport()
    await expect(page.locator('[data-timeline-row="NewMessages"]')).toHaveCount(0)
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
    await page.clock.install()
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

  test("pages the timeline from the composer, resuming follow at the end and loading history at the top", async ({
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

    const pageHeight = await page
      .locator('[data-slot="session-timeline-visible"]')
      .evaluate((element) => element.clientHeight)

    await editor.press("PageUp")
    await expect.poll(top).toBeLessThan(resting - pageHeight * 0.6)
    expect(resting - (await top())).toBeLessThan(pageHeight)
    await expect(editor).toBeFocused()
    await expect(editor).toHaveText("keep this draft")
    expect(await caret()).toBe("keep this draft".length)

    // Paging back to the end follows new content again, as a wheel scroll there does.
    for (let index = 0; index < 10 && (await fromEnd()) > 1; index++) await editor.press("PageDown")
    await expect.poll(fromEnd).toBeLessThanOrEqual(1)
    await timeline.send(partUpdated(textPart("prt_page_keys_tail", "Arrived after paging down.\n\n".repeat(20))))
    await timeline.waitForPart("prt_page_keys_tail")
    await expect.poll(fromEnd).toBeLessThanOrEqual(1)

    // Paging to the top loads the older page, as scrolling there does.
    for (let index = 0; index < 30 && (await top()) > 1; index++) await editor.press("PageUp")
    await expect.poll(() => older[0]).toBe(messages[messages.length - 40]!.id)
    await expect(editor).toBeFocused()
    await expect(editor).toHaveText("keep this draft")
  })
})

declare global {
  interface Window {
    __historyRootProbe?: { arm(): string[]; hidden: boolean; settle(final: ProbeFinal): void; settled: boolean }
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
