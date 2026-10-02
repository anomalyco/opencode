import { expect, test, type Page } from "@playwright/test"
import type { SessionMessageInfo } from "@opencode/client/promise"
import { timelinePresets } from "@opencode/session-ui/timeline/detail"
import { expected, messages } from "../utils/markdown-sessions"
import { expectPath, seed, sessionHref, type SeedInput } from "../utils/app"
import type { MockServerConfig } from "../utils/mock-server"
import { fixture, installTimelineSettings, mockStressTimeline } from "../utils/session-fixture"

test.use({ viewport: { width: 1440, height: 900 }, serviceWorkers: "block" })

type Reveal = { pending: number; clipped: string[]; bottomError: number; tables: number; codeBlocks: number }

for (const width of [1440, 390]) {
  test(`reveals a cold timeline at the tail only after Markdown is measured at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    const requested = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    await page.route(/markdown\.worker(?:-[^/?]+\.js|\.ts)(?:\?.*)?$/, async (route) => {
      requested.resolve()
      await release.promise
      await route.continue()
    })
    await page.addInitScript((partID) => {
      const observer = new MutationObserver(() => {
        const answer = document.querySelector<HTMLElement>(`[data-timeline-part-id="${partID}"]`)
        const content = answer?.closest<HTMLElement>("[data-timeline-virtual-content]")
        const root = content?.closest<HTMLElement>(".scroll-view__viewport")
        if (!answer || !content || !root || !content.checkVisibility({ checkVisibilityCSS: true })) return
        const spacer = content.querySelector('[data-timeline-row="bottom-spacer"]')
        ;(window as Window & { __coldReveal?: Reveal }).__coldReveal = {
          pending: content.querySelectorAll('[data-component="markdown"]:not([data-markdown-ready])').length,
          clipped: [...content.querySelectorAll<HTMLElement>("[data-timeline-key]")].flatMap((row) =>
            (row.firstElementChild?.getBoundingClientRect().height ?? 0) > row.getBoundingClientRect().height + 1
              ? [row.dataset.timelineKey!]
              : [],
          ),
          bottomError: (spacer?.getBoundingClientRect().bottom ?? Infinity) - root.getBoundingClientRect().bottom,
          tables: answer.querySelectorAll("table").length,
          codeBlocks: answer.querySelectorAll("pre").length,
        }
        observer.disconnect()
      })
      observer.observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ["style"] })
    }, expected[fixture.sourceID].answerID)
    await mockStressTimeline(page, { pageMessages: () => ({ items: messages[fixture.sourceID] }) })
    await installTimelineSettings(page)
    try {
      await page.goto(sessionHref(fixture.sourceID), { waitUntil: "domcontentloaded" })
      await requested.promise
      await expect(page.locator("[data-timeline-virtual-content]")).toHaveCSS("visibility", "hidden")
      release.resolve()
      await expect(page.locator("[data-timeline-virtual-content]")).toHaveCSS("visibility", "visible")
      const reveal = await page.evaluate(() => (window as Window & { __coldReveal?: Reveal }).__coldReveal)
      expect(reveal).toMatchObject({ pending: 0, clipped: [], tables: 1, codeBlocks: 4 })
      expect(Math.abs(reveal?.bottomError ?? Infinity)).toBeLessThanOrEqual(1)
      // The gap above the composer is part of the tail.
      const spacer = page.locator('[data-timeline-row="bottom-spacer"]')
      await expect(spacer).toBeVisible()
      expect(await spacer.evaluate((element) => element.getBoundingClientRect().height)).toBe(64)
    } finally {
      release.resolve()
    }
  })
}

test("paints cold and warm session tabs at the latest message", async ({ page }) => {
  await openTabs(page, { pageMessages: (id) => ({ items: fixture.messages[id] ?? [] }) })
  await installTimelineSettings(page)
  await page.goto(sessionHref(fixture.sourceID))
  await expectAtTail(page, fixture.expected.sourceMessageIDs.at(-1)!)

  // Cold: the first painted frame of the destination is already at its tail.
  const cold = await sampleTabPaint(page, fixture.targetID)
  await tab(page, fixture.targetID).click()
  const coldPaint = await cold.firstPaint()
  expect(coldPaint.last).toBe(true)
  expect(Math.abs(coldPaint.bottomError ?? Infinity)).toBeLessThanOrEqual(1)
  await expectAtTail(page, fixture.expected.targetMessageIDs.at(-1)!)

  // Warm: the cached view paints at its tail without replacing a node it painted first.
  await tab(page, fixture.sourceID).click()
  await expectAtTail(page, fixture.expected.sourceMessageIDs.at(-1)!)
  const warm = await sampleTabPaint(page, fixture.targetID)
  await tab(page, fixture.targetID).click()
  const warmPaint = await warm.firstPaint()
  expect(warmPaint.last).toBe(true)
  expect(Math.abs(warmPaint.bottomError ?? Infinity)).toBeLessThanOrEqual(1)
  await expectAtTail(page, fixture.expected.targetMessageIDs.at(-1)!)
  expect(await warm.stop()).toBe(0)
})

test("scrolls within a long answer without mounting unrelated history", async ({ page }) => {
  await openTimeline(page, messages[fixture.sourceID])
  const answer = page.locator(`[data-timeline-part-id="${expected[fixture.sourceID].answerID}"]`)
  await expect(answer.locator('[data-component="markdown"]')).toHaveAttribute("data-markdown-ready", "")
  await expect(answer.getByRole("table")).toHaveCount(1)
  const scroller = page.locator(".scroll-view__viewport", { has: answer })
  await expect
    .poll(() => scroller.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop))
    .toBeLessThanOrEqual(1)
  const rows = page.locator("[data-timeline-key]")
  const keys = await rows.evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("data-timeline-key")),
  )
  const top = await answer.evaluate((element) => element.getBoundingClientRect().top)

  await scroller.hover()
  await page.mouse.wheel(0, -240)

  await expect.poll(() => answer.evaluate((element) => element.getBoundingClientRect().top)).toBeCloseTo(top + 240, 0)
  expect(
    await rows.evaluateAll((elements) => elements.map((element) => element.getAttribute("data-timeline-key"))),
  ).toEqual(keys)
  await expect(answer.locator('[data-component="markdown"]')).toHaveAttribute("data-markdown-ready", "")
})

test("fills a short cold transcript before revealing it", async ({ page }) => {
  const history = messages[fixture.sourceID].slice(-6).map((message, index) => {
    if (message.type === "user") return { ...message, text: `Prompt ${index}`, metadata: undefined }
    if (message.type === "assistant")
      return { ...message, content: [{ type: "text" as const, text: `**Answer ${index}**` }] }
    return message
  })
  await openTimeline(page, history)
  for (const message of history) {
    if (message.type === "user") {
      await expect(page.locator(`[data-timeline-row="UserMessage"][data-message-id="${message.id}"]`)).toBeInViewport()
    }
    if (message.type === "assistant") {
      const answer = page.locator(`[data-timeline-part-id="${message.id}:text:0"]`)
      await expect(answer).toBeInViewport()
      await expect(answer.locator('[data-component="markdown"]')).toHaveAttribute("data-markdown-ready", "")
    }
  }
})

test("recovers from a failed cold history load when another session is selected", async ({ page }) => {
  await openTabs(page, { pageMessages: placeholderHistory })
  await page.route(`**/api/session/${fixture.targetID}/message?*`, (route) =>
    route.fulfill({ status: 500, json: { message: "History unavailable" } }),
  )
  await page.goto(sessionHref(fixture.sourceID))
  await expect(page.getByText(`History for ${fixture.sourceID}`, { exact: true })).toBeVisible()
  await tab(page, fixture.targetID).click()
  await expect(page.getByRole("heading", { name: "Something went wrong", exact: true })).toBeVisible()
  await tab(page, fixture.sourceID).click()
  await expect(page.getByText(`History for ${fixture.sourceID}`, { exact: true })).toBeVisible()
  await expect(page.getByRole("heading", { name: "Something went wrong", exact: true })).toHaveCount(0)
})

test("focuses Find in the selected cached timeline", async ({ page }) => {
  await openTabs(page, { pageMessages: placeholderHistory })
  await page.goto(sessionHref(fixture.sourceID))
  await expect(page.getByText(`History for ${fixture.sourceID}`, { exact: true })).toBeVisible()
  await tab(page, fixture.targetID).click()
  await expect(page.getByText(`History for ${fixture.targetID}`, { exact: true })).toBeVisible()
  await tab(page, fixture.sourceID).click()
  await expect(page.getByText(`History for ${fixture.sourceID}`, { exact: true })).toBeVisible()
  await page.keyboard.press("ControlOrMeta+f")
  const search = page.locator('[data-component="timeline-search-bar"] input')
  await expect(search).toBeFocused()
  await page.keyboard.type("History")
  await expect(search).toHaveValue("History")
  await tab(page, fixture.targetID).click()
  await expect(page.getByText(`History for ${fixture.targetID}`, { exact: true })).toBeVisible()
  await page.keyboard.press("ControlOrMeta+f")
  await expect(search).toBeFocused()
  await search.press("Escape")
  await expect(search).toHaveCount(0)
})

test("disposes the old workspace's shell while destination history is loading", async ({ page }) => {
  const destination = "C:/OpenCode/OtherProject"
  const requested = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const reads: string[] = []
  const output = { text: "Initial shell output\n" }
  await openTabs(
    page,
    {
      sessions: fixture.sessions.map((session) =>
        session.id === fixture.targetID ? { ...session, directory: destination } : session,
      ),
      pageMessages: (id) => ({
        items:
          id === fixture.sourceID
            ? ([
                { id: "msg_workspace_source", type: "user", text: "Follow the shell", time: { created: 1 } },
                {
                  id: "msg_workspace_shell",
                  type: "assistant",
                  agent: "build",
                  model: { id: "claude-opus-4-6", providerID: "opencode" },
                  time: { created: 2 },
                  content: [
                    {
                      type: "tool",
                      id: "call_workspace_shell",
                      name: "shell",
                      time: { created: 2 },
                      state: {
                        status: "running",
                        input: { command: "run checks" },
                        metadata: { shellID: "sh_workspace_source" },
                      },
                    },
                  ],
                },
              ] satisfies SessionMessageInfo[])
            : [],
      }),
      beforeMessagesResponse: async ({ sessionID }) => {
        if (sessionID !== fixture.targetID) return
        requested.resolve()
        await release.promise
      },
      // The shell runs in the source workspace only.
      shellOutput: (input) =>
        input.id === "sh_workspace_source" && input.directory === fixture.directory ? output.text : undefined,
    },
    {
      settings: {
        general: {
          timelineDetail: { ...timelinePresets[2].value, shell: { placement: "separate", details: "expanded" } },
        },
      },
    },
  )
  page.on("request", (request) => {
    const url = new URL(request.url())
    if (request.method() === "GET" && url.pathname === "/api/shell/sh_workspace_source/output")
      reads.push(url.searchParams.get("location[directory]") ?? "")
  })
  await page.goto(sessionHref(fixture.sourceID))
  const shell = page.locator('[data-timeline-part-id="call_workspace_shell"]')
  await expect(shell.locator('[data-slot="bash-result"]')).toContainText("Initial shell output")
  const original = await page.locator("[data-timeline-virtual-content]").elementHandle()
  try {
    await tab(page, fixture.targetID).click()
    await requested.promise
    await expect(page.locator("[data-session-title]")).toHaveText(fixture.expected.targetTitle)
    output.text += "Output after returning\n"
    await tab(page, fixture.sourceID).click()
    await expect(shell.locator('[data-slot="bash-result"]')).toContainText("Output after returning")
    expect(await original!.evaluate((element) => element.isConnected)).toBe(false)
    expect(reads.length).toBeGreaterThan(1)
    expect(reads.every((directory) => directory === fixture.directory)).toBe(true)
  } finally {
    release.resolve()
  }
})

test("loads the transcript code font before opening rich history", async ({ page }) => {
  const font = page.waitForResponse((response) => /IBMPlexMono-Text[^/]*\.woff2/.test(response.url()))
  await openTabs(page, {
    pageMessages: () => ({
      items: [{ id: "msg_font_source", type: "user", text: "A transcript with no code", time: { created: 1 } }],
    }),
  })
  await page.goto(sessionHref(fixture.sourceID))
  await expect(page.getByText("A transcript with no code", { exact: true })).toBeVisible()
  expect((await font).ok()).toBe(true)
  await expect.poll(() => page.evaluate(() => document.fonts.check('440 13px "IBM Plex Mono"'))).toBe(true)
})

test("waits for the requested session's history before constructing its cold timeline", async ({ page }) => {
  const requested = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  await openTabs(page, {
    pageMessages: (id) => ({ items: fixture.messages[id] ?? [] }),
    beforeMessagesResponse: async ({ sessionID }) => {
      if (sessionID !== fixture.targetID) return
      requested.resolve()
      await release.promise
    },
  })
  await page.goto(sessionHref(fixture.sourceID))
  await expectAtTail(page, fixture.expected.sourceMessageIDs.at(-1)!)
  try {
    await tab(page, fixture.targetID).click()
    await requested.promise
    await expect(page.locator("[data-timeline-virtual-content]")).toHaveCount(0)
    release.resolve()
    await expectAtTail(page, fixture.expected.targetMessageIDs.at(-1)!)
    await expect(page.locator("[data-timeline-virtual-content]")).toHaveCount(1)
  } finally {
    release.resolve()
  }
})

for (const grouped of [true, false]) {
  test(`restores a ${grouped ? "grouped" : "separate"} timeline after inactive updates and a resize`, async ({
    page,
  }) => {
    const history: Record<string, SessionMessageInfo[]> = Object.fromEntries(
      [fixture.sourceID, fixture.targetID].map((id) => [
        id,
        [
          { id: `msg_user_${id}`, type: "user", text: `Prompt for ${id}`, time: { created: 1 } },
          {
            id: `msg_assistant_${id}`,
            type: "assistant",
            agent: "build",
            model: { id: "claude-opus-4-6", providerID: "opencode" },
            time: { created: 2, completed: 3 },
            content: [
              {
                type: "tool",
                id: `tool_${id}`,
                name: "shell",
                time: { created: 2, completed: 3 },
                state: {
                  status: "completed",
                  input: { command: `echo ${id}` },
                  metadata: {},
                  content: [{ type: "text", text: `Output for ${id}` }],
                },
              },
              { type: "text", text: `Answer for ${id}` },
            ],
          },
        ] satisfies SessionMessageInfo[],
      ]),
    )
    const mock = await openTabs(
      page,
      { pageMessages: (id) => ({ items: history[id] ?? [] }) },
      {
        settings: {
          general: {
            timelineDetail: {
              ...timelinePresets[2].value,
              shell: { placement: grouped ? "grouped" : "separate", details: "collapsed" },
            },
          },
        },
      },
    )
    await page.goto(sessionHref(fixture.sourceID))
    await expect(page.getByText(`Answer for ${fixture.sourceID}`, { exact: true })).toBeVisible()
    if (grouped)
      await page
        .locator(
          '[data-component="collapsed-tool-group"] > [data-component="collapsible"] > [data-slot="collapsible-trigger"]',
        )
        .click()
    const shell = page.locator(`[data-timeline-part-id="tool_${fixture.sourceID}"]`)
    const trigger = shell.locator('[data-slot="collapsible-trigger"]')
    await trigger.click()
    await expect(shell.locator('[data-slot="bash-result"]')).toHaveText(`Output for ${fixture.sourceID}`)
    const original = await page.locator("[data-timeline-virtual-content]").elementHandle()

    await tab(page, fixture.targetID).click()
    await expect(page.getByText(`Answer for ${fixture.targetID}`, { exact: true })).toBeVisible()
    await expect(shell).toHaveCount(0)
    expect(await original!.evaluate((element) => element.isConnected)).toBe(false)
    await expect(page.locator("[data-timeline-virtual-content]")).toHaveCount(1)
    await mock.push([
      {
        id: "evt_cached_text",
        created: 4,
        type: "session.text.ended",
        location: { directory: fixture.directory },
        durable: { aggregateID: fixture.sourceID, seq: 0, version: 1 },
        data: {
          sessionID: fixture.sourceID,
          assistantMessageID: `msg_assistant_${fixture.sourceID}`,
          ordinal: 0,
          text: "Updated while inactive",
        },
      },
    ])
    // The cached source timeline applies the update while detached; the destination stays selected.
    await expect
      .poll(() => original!.evaluate((element) => element.textContent?.includes("Updated while inactive") ?? false))
      .toBe(true)
    expect(await original!.evaluate((element) => element.isConnected)).toBe(false)
    await expectPath(page, sessionHref(fixture.targetID))
    await expect(page.getByText(`Answer for ${fixture.targetID}`, { exact: true })).toBeVisible()
    await page.setViewportSize({ width: 900, height: 650 })
    await tab(page, fixture.sourceID).click()
    await expect(page.getByText("Updated while inactive", { exact: true })).toBeVisible()
    await expect(trigger).toHaveAttribute("aria-expanded", "true")
    await expect(shell.locator('[data-slot="bash-result"]')).toHaveText(`Output for ${fixture.sourceID}`)
    expect(await original!.evaluate((element) => element.isConnected)).toBe(true)
    await expect(page.locator("[data-timeline-virtual-content]")).toHaveCount(1)
    await expect
      .poll(() =>
        page
          .locator("[data-timeline-key]")
          .evaluateAll((rows) =>
            rows.every(
              (row) =>
                (row.firstElementChild?.getBoundingClientRect().height ?? 0) <= row.getBoundingClientRect().height + 1,
            ),
          ),
      )
      .toBe(true)
    await trigger.click()
    await expect(trigger).toHaveAttribute("aria-expanded", "false")
  })
}

function placeholderHistory(id: string) {
  return { items: [{ id: `msg_${id}`, type: "user", text: `History for ${id}`, time: { created: 1 } }] } satisfies {
    items: SessionMessageInfo[]
  }
}

function tab(page: Page, sessionID: string) {
  return page.locator(`[data-titlebar-tab-link][href="${sessionHref(sessionID)}"]`)
}

// The source and target sessions open as titlebar tabs of one expanded project.
async function openTabs(page: Page, input: Partial<MockServerConfig>, extra: SeedInput = {}) {
  const mock = await mockStressTimeline(page, input)
  await seed(page, {
    projects: { local: [{ worktree: fixture.directory, expanded: true }] },
    lastProject: { local: fixture.directory },
    tabs: [fixture.sourceID, fixture.targetID],
    ...extra,
  })
  return mock
}

async function openTimeline(page: Page, history: SessionMessageInfo[]) {
  await mockStressTimeline(page, { pageMessages: () => ({ items: history }) })
  await installTimelineSettings(page)
  await page.goto(sessionHref(fixture.sourceID))
  await expect(page.locator("[data-timeline-virtual-content]")).toHaveCSS("visibility", "visible")
}

async function expectAtTail(page: Page, lastUserID: string) {
  const content = page.locator("[data-timeline-virtual-content]")
  await expect(content).toHaveCSS("visibility", "visible")
  await expect(content.locator(`[data-timeline-row="UserMessage"][data-message-id="${lastUserID}"]`)).toBeInViewport()
  await expect
    .poll(() =>
      page
        .locator(".scroll-view__viewport", { has: content })
        .evaluate((element) => Math.abs(element.scrollHeight - element.clientHeight - element.scrollTop)),
    )
    .toBeLessThanOrEqual(1)
}

type TabPaint = { first?: { last: boolean; bottomError?: number }; settled: boolean; removed: number; stop(): void }

// Samples painted frames of the timeline showing `sessionID`: the first frame that shows any of its messages, and
// every node of the first settled frame (at the tail, Markdown rendered) that is later removed.
async function sampleTabPaint(page: Page, sessionID: string) {
  const history = fixture.messages[sessionID]!
  await page.evaluate(
    ({ ids, last }) => {
      const destination = new Set(ids)
      const painted = new WeakSet<Node>()
      let running = true
      const state: TabPaint = {
        settled: false,
        removed: 0,
        stop: () => {
          running = false
        },
      }
      ;(window as Window & { __tabPaint?: TabPaint }).__tabPaint = state
      new MutationObserver((records) => {
        if (!state.settled || !running) return
        records.forEach((record) =>
          record.removedNodes.forEach((node) => {
            if (painted.has(node)) state.removed += 1
            if (!(node instanceof Element)) return
            node.querySelectorAll("*").forEach((element) => {
              if (painted.has(element)) state.removed += 1
            })
          }),
        )
      }).observe(document.documentElement, { childList: true, subtree: true })
      const sample = () => {
        if (!running || state.settled) return
        const root = [...document.querySelectorAll<HTMLElement>(".scroll-view__viewport")].find((element) =>
          [...element.querySelectorAll<HTMLElement>("[data-message-id]")].some((row) =>
            destination.has(row.dataset.messageId!),
          ),
        )
        if (root) {
          const view = root.getBoundingClientRect()
          // A frame counts only when the row is painted: inside the viewport and not hidden by CSS.
          const inView = (element: Element) => {
            const rect = element.getBoundingClientRect()
            return (
              rect.bottom > view.top &&
              rect.top < view.bottom &&
              element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
            )
          }
          const visible = [...root.querySelectorAll<HTMLElement>("[data-message-id]")]
            .filter(inView)
            .map((element) => element.dataset.messageId!)
            .filter((id) => destination.has(id))
          const spacer = root.querySelector('[data-timeline-row="bottom-spacer"]')?.getBoundingClientRect()
          const bottomError = spacer ? spacer.bottom - view.bottom : undefined
          if (visible.length && !state.first) state.first = { last: visible.includes(last), bottomError }
          if (
            visible.includes(last) &&
            Math.abs(bottomError ?? Infinity) <= 1 &&
            !root.querySelector('[data-markdown-key="initial"]')
          ) {
            state.settled = true
            root.querySelectorAll<HTMLElement>("[data-timeline-key]").forEach((row) => {
              if (!inView(row)) return
              painted.add(row)
              row.querySelectorAll("*").forEach((element) => painted.add(element))
            })
            return
          }
        }
        requestAnimationFrame(() => setTimeout(sample, 0))
      }
      requestAnimationFrame(() => setTimeout(sample, 0))
    },
    {
      ids: history.map((message) => message.id),
      last: history.findLast((message) => message.type === "user")!.id,
    },
  )
  const read = () => page.evaluate(() => (window as Window & { __tabPaint?: TabPaint }).__tabPaint!.first)
  return {
    async firstPaint() {
      await expect.poll(read).toBeDefined()
      await expect
        .poll(() => page.evaluate(() => (window as Window & { __tabPaint?: TabPaint }).__tabPaint!.settled))
        .toBe(true)
      return (await read())!
    },
    stop: () =>
      page.evaluate(() => {
        const state = (window as Window & { __tabPaint?: TabPaint }).__tabPaint!
        state.stop()
        return state.removed
      }),
  }
}
