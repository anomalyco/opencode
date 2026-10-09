import type { SessionMessageAssistant, SessionMessageInfo } from "@opencode/client/promise"
import { expect, test, type Page } from "@playwright/test"
import { pageMessagesFrom, seed, sessionHref } from "../utils/app"
import { trackPageErrors } from "../utils/errors"
import { fixture, installTimelineSettings, mockStressTimeline } from "../utils/session-fixture"
import {
  assistantMessage,
  messageUpdated,
  sessionID,
  setupTimeline,
  status,
  textPart,
  userMessage,
  userText,
} from "../utils/timeline"
import { expectSessionTitle } from "../utils/waits"

test.use({ serviceWorkers: "block" })

test.describe("timeline history", () => {
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

  test("navigates every turn from the user index and previews unloaded replies on hover", async ({ page }) => {
    const messages = Array.from({ length: 40 }, (_, index) => {
      const value = String(index).padStart(4, "0")
      const id = `msg_0${value}_turn_a_user`

      return [
        userMessage([userText(`Prompt number ${index}`, { id: `prt_0${value}_turn_prompt` })], {
          id,
          created: 1690000000000 + index * 10_000,
        }),
        assistantMessage([{ id: `prt_0${value}_turn_text`, type: "text", text: `Response number ${index}` }], {
          id: `msg_0${value}_turn_b_assistant`,
          parentID: id,
          created: 1690000001000 + index * 10_000,
        }),
      ]
    }).flat()
    const loads: (string | undefined)[] = []
    await setupTimeline(page, {
      sessionMessages: messages,
      pageMessages: pageMessagesFrom({ [sessionID]: messages }),
      onMessages: (request) => {
        if (request.phase === "start") loads.push(request.before)
      },
    })

    const navigator = page.locator('[data-component="session-turn-navigator"]')
    const turns = navigator.locator("[data-turn]")
    const preview = navigator.locator('[data-slot="session-turn-navigator-preview"]')
    // The index lists every turn without paging the transcript.
    await expect(turns).toHaveCount(40)
    expect(loads).toEqual([undefined])

    await turns.nth(39).hover()
    await expect(preview).toContainText("Prompt number 39")
    await expect(preview).toContainText("Response number 39")

    // An unloaded turn fetches only its own latest reply, not the transcript around it.
    await turns.nth(0).hover()
    await expect(preview).toContainText("Prompt number 0")
    await expect(preview).toContainText("Response number 0")
    await expect(preview).not.toContainText("Response number 1")
    expect(loads).toEqual([undefined])

    await turns.nth(0).click()
    await expect(page.locator("#message-msg_00000_turn_a_user")).toBeInViewport()
    await timelineScroller(page).hover()
    await expect(turns.nth(0)).toHaveAttribute("data-state", "active")
    expect(loads.length).toBeGreaterThan(1)
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
        ...(scenario.error ? { error: scenario.error } : {}),
      }

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

  for (const shape of ["assistant-only", "mixed"] as const) {
    test(`renders the ${shape} tail before parent hydration and preserves it afterward`, async ({ page }) => {
      const session = { ...fixture.sessions[0]!, id: `ses_hydration_${shape}` }

      // Compact's initial 40 and the next 20 begin with an assistant; page three supplies its parent.
      const messages = Array.from({ length: 61 }, (_, index): SessionMessageInfo => {
        const id = `msg_hydration_${index}`
        const time = { created: 1700000000000 + index * 1_000 }

        if (index === 0 || (shape === "mixed" && index === 59))
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

        if (shape === "mixed")
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
})

declare global {
  interface Window {
    __historyRootProbe?: { arm(): string[]; hidden: boolean; settle(final: ProbeFinal): void; settled: boolean }
  }
}

async function openStressTarget(page: Page, input: Parameters<typeof mockStressTimeline>[1] = {}) {
  await mockStressTimeline(page, input)
  await installTimelineSettings(page)
  await seed(page, {
    projects: { local: [{ worktree: fixture.directory, expanded: true }] },
    lastProject: { local: fixture.directory },
  })
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
