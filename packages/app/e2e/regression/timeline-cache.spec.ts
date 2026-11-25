import { expect, test, type Locator, type Page } from "@playwright/test"
import type { OpenCodeEvent, SessionMessageInfo } from "@opencode/client/promise"
import { timelinePresets } from "@opencode/session-ui/timeline/detail"
import { expected, messages } from "../utils/markdown-sessions"
import { expectPath, holdRoute, seed, sessionHref, type SeedInput } from "../utils/app"
import type { MockServerConfig } from "../utils/mock-server"
import { fixture, installTimelineSettings, mockStressTimeline } from "../utils/session-fixture"
import {
  assistantMessage,
  historyMessages,
  partDelta,
  revertCleared,
  revertStaged,
  session,
  sessionID,
  setupTimeline,
  textPart,
  timelineRowTops,
  userMessage,
  validateTimelineMessages,
  waitForVisualSettle,
} from "../utils/timeline"
import { mockWorkspace } from "../utils/workspace"

test.use({ viewport: { width: 1440, height: 900 }, serviceWorkers: "block" })

type Reveal = { pending: number; clipped: string[]; bottomError: number; tables: number; codeBlocks: number }

const otherSessionID = "ses_place_other"

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

        window.__coldReveal = {
          pending: content.querySelectorAll('[data-component="markdown"]:not([data-markdown-ready])').length,
          clipped: [...content.querySelectorAll<HTMLElement>("[data-timeline-key]")].flatMap((row) =>
            (row.firstElementChild?.getBoundingClientRect().height ?? 0) > row.getBoundingClientRect().height + 1
              ? [row.dataset.timelineKey!]
              : [],
          ),
          // The viewport runs on under the composer; its visible part ends at the composer region.
          bottomError:
            (spacer?.getBoundingClientRect().bottom ?? Infinity) -
            root.getBoundingClientRect().bottom +
            parseFloat(getComputedStyle(root).scrollPaddingBottom),
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
      const reveal = await page.evaluate(() => window.__coldReveal)
      expect(reveal).toMatchObject({ pending: 0, clipped: [], tables: 1, codeBlocks: 4 })
      expect(Math.abs(reveal?.bottomError ?? Infinity)).toBeLessThanOrEqual(1)
      // The gap above the composer is part of the tail: the status lane, then the activity pill and its gap.
      const spacer = page.locator('[data-timeline-row="bottom-spacer"]')
      await expect(spacer).toBeVisible()
      expect(await spacer.evaluate((element) => element.getBoundingClientRect().height)).toBe(92)
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

test("reloads a transcript only after inline file links have their final styling", async ({ page }) => {
  const sessionID = "ses_cold_inline_paths"
  await mockWorkspace(page, {
    name: "ColdInlinePaths",
    sessions: [{ id: sessionID, title: "Cold inline paths" }],
    findFiles: ({ query }) => (query === "src/file.ts" ? ["src/file.ts"] : []),
    pageMessages: () => ({
      items: [
        { id: "user_cold_paths", type: "user", text: "Review these files", time: { created: 1 } },
        {
          id: "answer_cold_paths",
          type: "assistant",
          agent: "build",
          model: { id: "test", providerID: "opencode" },
          time: { created: 2, completed: 3 },
          content: [
            {
              type: "text",
              text: "| Area | Files |\n| --- | --- |\n| App | `src/file.ts`, `src/file.ts` |\n| Missing | `missing/file.ts` |",
            },
          ],
        },
      ],
    }),
  })
  await page.goto(sessionHref(sessionID))
  const answer = page.locator('[data-timeline-part-id="answer_cold_paths:text:0"]')
  const content = page.locator("[data-timeline-virtual-content]")
  await expect(answer.locator('code[data-inline-code-kind="path"]')).toHaveCount(2)
  await expect(content).toHaveCSS("visibility", "visible")
  const held = await holdRoute(page, /\/api\/fs\/find\?/)

  try {
    await page.reload({ waitUntil: "domcontentloaded" })
    await held.arrived
    await expect(answer.getByRole("table", { includeHidden: true })).toBeAttached()
    await expect(content).toHaveCSS("visibility", "hidden")
    const editor = page.locator('[data-component="composer-editor"]')
    await expect(editor).toBeEditable()
    await editor.fill("The composer still works")
    await expect(editor).toHaveText("The composer still works")

    const reveal = await content.evaluateHandle((root) => {
      type PathReveal = { kinds?: (string | null)[] }

      const state: PathReveal = {}

      const observer = new MutationObserver(() => {
        if (!root.checkVisibility({ checkVisibilityCSS: true })) return
        state.kinds = [...root.querySelectorAll("code")].map((code) => code.getAttribute("data-inline-code-kind"))
        observer.disconnect()
      })

      observer.observe(root, { attributes: true, attributeFilter: ["style"] })

      return state
    })

    held.release()
    await expect(content).toHaveCSS("visibility", "visible")
    expect(await reveal.evaluate((state) => state.kinds)).toEqual(["path", "path", null])
    await reveal.dispose()
    await expect(answer.locator("code")).toHaveText(["src/file.ts", "src/file.ts", "missing/file.ts"])
    await expect(answer.locator('code[data-inline-code-kind="path"]')).toHaveText(["src/file.ts", "src/file.ts"])
    await expect(answer.getByText("missing/file.ts", { exact: true })).not.toHaveAttribute("data-inline-code-kind")
  } finally {
    held.release()
  }
})

test("keeps verified inline paths across a workspace tab switch", async ({ page }) => {
  const directory = "C:/OpenCode/InlinePaths"
  const other = "C:/OpenCode/OtherInlinePaths"
  const sourceID = "ses_inline_source"
  const targetID = "ses_inline_target"
  const queries: { query: string; directory: string }[] = []
  const existing = new Set([directory])
  await page.clock.setFixedTime(new Date("2026-10-21T00:00:00Z"))

  const workspace = await mockWorkspace(page, {
    name: "InlinePaths",
    directory,
    project: { sandboxes: [other] },
    sessions: [
      { id: sourceID, title: "Known path" },
      { id: targetID, title: "Missing path", directory: other },
    ],
    pageMessages: (id) => ({
      items: [
        { id: `user_${id}`, type: "user", text: "Check the file", time: { created: 1 } },
        {
          id: `answer_${id}`,
          type: "assistant",
          agent: "build",
          model: { id: "test", providerID: "opencode" },
          time: { created: 2, completed: 3 },
          content: [{ type: "text", text: "Inspect `src/file.ts`." }],
        },
      ],
    }),
    findFiles: (input) => {
      queries.push({ query: input.query, directory: input.directory })

      return existing.has(input.directory) ? ["src/file.ts"] : []
    },
  })

  await page.goto(sessionHref(sourceID))
  const source = part(page, sourceID).locator("code")
  await expect(source).toHaveAttribute("data-inline-code-kind", "path")
  const original = await source.elementHandle()
  await tab(page, targetID).click()
  const target = part(page, targetID).locator("code")
  await expect(target).toHaveText("src/file.ts")
  await expect.poll(() => queries.some((query) => query.directory === other)).toBe(true)
  await expect(target).not.toHaveAttribute("data-inline-code-kind")
  expect(await original!.evaluate((node) => node.isConnected)).toBe(false)

  const count = queries.length
  const held = await holdRoute(page, /\/api\/fs\/find\?/)

  try {
    await tab(page, sourceID).click()
    await expect(source).toBeVisible()
    // The source workspace's timeline is kept while the other workspace is selected, so its links need no new lookup.
    expect(await source.evaluate((node, original) => node === original, original)).toBe(true)
    await expect(source).toHaveAttribute("data-inline-code-kind", "path")
    expect(held.requests).toHaveLength(0)
    expect(queries).toHaveLength(count)
  } finally {
    held.release()
  }

  // Markdown that renders again repeats its lookups: expired positives keep their styling while revalidation is
  // pending, and negatives must discover new files. Link results last as long as the session screen, which going
  // Home unmounts, so the text changes in place.
  await page.clock.setFixedTime(new Date("2026-10-21T00:01:01Z"))
  const refresh = await holdRoute(page, /\/api\/fs\/find\?/)

  try {
    await workspace.push([textEnded(sourceID, directory)])
    await refresh.arrived
    await expect(part(page, sourceID)).toContainText("again")
    await expect(source).toHaveAttribute("data-inline-code-kind", "path")
  } finally {
    refresh.release()
  }

  existing.add(other)
  await tab(page, targetID).click()
  await expect(target).toBeVisible()
  await workspace.push([textEnded(targetID, other)])
  await expect(part(page, targetID)).toContainText("again")
  await expect(target).toHaveAttribute("data-inline-code-kind", "path")
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

// Each cached view provides its own Markdown context, so it must pass the app's code wrap setting on.
test("wraps the code blocks of a cached view when the setting is on", async ({ page }) => {
  await mockStressTimeline(page, { pageMessages: () => ({ items: messages[fixture.sourceID] }) })
  await installTimelineSettings(page)
  await page.addInitScript(() => {
    const settings = JSON.parse(localStorage.getItem("settings.v3")!)
    localStorage.setItem(
      "settings.v3",
      JSON.stringify({ ...settings, general: { ...settings.general, wrapCodeBlocks: true } }),
    )
  })
  await page.goto(sessionHref(fixture.sourceID))

  const markdown = page.locator(
    `[data-timeline-part-id="${expected[fixture.sourceID].answerID}"] [data-component="markdown"]`,
  )

  await expect(markdown).toHaveAttribute("data-markdown-ready", "")
  await expect(markdown).toHaveAttribute("data-code-wrap", "")
  await expect(markdown.locator('[data-component="markdown-code"] > pre').first()).toHaveCSS("white-space", "pre-wrap")
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

test("keeps the old workspace's shell on its own Location while destination history is loading", async ({ page }) => {
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
    await expect(page.locator("[data-session-title] h1")).toHaveText(fixture.expected.targetTitle)
    output.text += "Output after returning\n"
    await tab(page, fixture.sourceID).click()
    await expect(shell.locator('[data-slot="bash-result"]')).toContainText("Output after returning")
    expect(await original!.evaluate((element) => element.isConnected)).toBe(true)
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
  // Chromium recreates every @font-face as "unloaded", keeping its downloaded file, whenever a lazily loaded
  // stylesheet with @layer rules activates ahead of one already applied, so the preloaded face's status alone is
  // not stable. Once fonts settle, the first layout of new code must take that file at once, which marks the
  // current face loaded; a face that still has to fetch its file reports "loading" here instead.
  expect(
    await page.evaluate(async () => {
      await document.fonts.ready
      const code = document.body.appendChild(document.createElement("code"))
      code.style.font = "440 13px var(--font-family-mono)"
      code.textContent = "code"
      code.getBoundingClientRect()
      const loaded = document.fonts.check('440 13px "IBM Plex Mono"')
      code.remove()

      return loaded
    }),
  ).toBe(true)
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

// A view that is not shown leaves the document, and its scroll element comes back at offset 0.
test("returns a reader to the rows they left from another narrow-screen view", async ({ page }) => {
  const timeline = await openHistory(page)
  const rows = await readHistory(page, timeline.scroller, 700)

  await timeline.views.getByRole("tab", { name: "Changes", exact: true }).click()
  await expect(timeline.content).toHaveCount(0)
  await timeline.views.getByRole("tab", { name: "Session", exact: true }).click()
  await expectRowsInPlace(page, timeline.scroller, rows)
})

test("returns a reader to the rows they left under an older page that landed while another view showed", async ({
  page,
}) => {
  const older = Promise.withResolvers<void>()
  const timeline = await openHistory(page, { older: older.promise })

  try {
    // The start of the loaded history asks for the older page, which is held back.
    const rows = await readHistory(page, timeline.scroller, 100_000)
    await timeline.asked
    const content = (await timeline.content.elementHandle())!
    const height = await content.evaluate((element) => parseFloat(element.style.height))

    await timeline.views.getByRole("tab", { name: "Changes", exact: true }).click()
    await expect(timeline.content).toHaveCount(0)
    older.resolve()
    // The page lands in the timeline that is not shown: its rows are in the list, above the reader's.
    await expect.poll(() => content.evaluate((element) => parseFloat(element.style.height))).toBeGreaterThan(height)
    await timeline.views.getByRole("tab", { name: "Session", exact: true }).click()
    await expectRowsInPlace(page, timeline.scroller, rows)
  } finally {
    older.resolve()
  }
})

test("returns a reader to the rows they left when the window narrows onto another view and widens again", async ({
  page,
}) => {
  const timeline = await openHistory(page)
  // A narrow window that last showed Changes remembers that view while it is wide.
  await timeline.views.getByRole("tab", { name: "Changes", exact: true }).click()
  await expect(timeline.content).toHaveCount(0)
  await page.setViewportSize({ width: 1056, height: 844 })
  const rows = await readHistory(page, timeline.scroller, 700)

  // No click: the window only narrows through the breakpoint and widens again.
  await page.setViewportSize({ width: 700, height: 844 })
  await expect(timeline.content).toHaveCount(0)
  await page.setViewportSize({ width: 1056, height: 844 })
  await expectRowsInPlace(page, timeline.scroller, rows)
})

test("returns a reader to the rows they left from another session's tab", async ({ page }) => {
  const timeline = await openHistory(page)
  await page.setViewportSize({ width: 1056, height: 844 })
  const rows = await readHistory(page, timeline.scroller, 700)

  await tab(page, otherSessionID).click()
  await expect(page.getByText("Other session prompt", { exact: true })).toBeVisible()
  await tab(page, sessionID).click()
  await expectRowsInPlace(page, timeline.scroller, rows)
})

test("returns a reader to the rows they left from Home, in a view that is built again", async ({ page }) => {
  const timeline = await openHistory(page)
  await page.setViewportSize({ width: 1056, height: 844 })
  const rows = await readHistory(page, timeline.scroller, 700)

  await page.getByRole("button", { name: "Home", exact: true }).click()
  await expect(timeline.content).toHaveCount(0)
  await page.goBack()
  await expectRowsInPlace(page, timeline.scroller, rows)
})

// The place is kept apart from the 16 views and the 16 sets of row sizes, which the 34 sessions push out. A session
// opened by its tab keeps the views, and one opened by a route change builds the session screen again.
test("returns a reader to the rows they left after 34 other sessions were opened", async ({ page }) => {
  // 34 sessions are opened one after another.
  test.setTimeout(180_000)
  const others = Array.from({ length: 34 }, (_, index) => `ses_place_${String(index).padStart(2, "0")}`)
  const timeline = await openHistory(page, { others })
  await page.setViewportSize({ width: 1056, height: 844 })
  const rows = await readHistory(page, timeline.scroller, 700)
  const left = (await timeline.content.elementHandle())!

  for (const [index, id] of others.entries()) {
    if (index < 17) await tab(page, id).click()

    if (index >= 17) await route(page, id)
    await expect(page.getByText(`Prompt of ${id}`, { exact: true })).toBeVisible()
  }

  await route(page, sessionID)
  await expectRowsInPlace(page, timeline.scroller, rows)
  // The view on screen was built again, without the row sizes of the one the reader left.
  expect(await left.evaluate((element) => element.isConnected)).toBe(false)
})

test("returns a reader whose passage was removed meanwhile to the end, which they follow from then on", async ({
  page,
}) => {
  const timeline = await openHistory(page, { streaming: true })
  await page.setViewportSize({ width: 1056, height: 844 })
  await readHistory(page, timeline.scroller, 700)

  await tab(page, otherSessionID).click()
  await expect(page.getByText("Other session prompt", { exact: true })).toBeVisible()
  // A revert hides the rows the reader was on, and every row after them.
  await timeline.revert("msg_00034_history_a_user")
  await tab(page, sessionID).click()
  await expect(timeline.scroller.getByText(/^Historical response 33\. /)).toBeInViewport()
  await expect(timeline.scroller.getByText(/^Historical response 34\. /)).toHaveCount(0)

  // The rows come back and the reply goes on: the reader is at the end of each.
  await timeline.revert(undefined)
  await expect(timeline.scroller.getByText("Checking the route", { exact: true })).toBeInViewport()
  await timeline.send(partDelta("prt_place_tail", `\n\n${"Arrived after the undo.\n\n".repeat(30)}The new end.`))
  await expect(timeline.scroller.getByText("The new end.", { exact: true })).toBeInViewport()
})

// A row that wraps again at another width is taller, and its words are elsewhere in it. The place names a letter.
test("returns a reader to the words they left after the window narrowed while they were away", async ({ page }) => {
  const timeline = await openHistory(page, { words: true })
  await page.setViewportSize({ width: 1220, height: 844 })
  await readHistory(page, timeline.scroller, 700)
  const word = await wordAtReadingLine(timeline.scroller)

  await page.getByRole("button", { name: "Home", exact: true }).click()
  await expect(timeline.content).toHaveCount(0)
  await page.setViewportSize({ width: 490, height: 844 })
  await page.goBack()
  // The same words, within a line: the reader's letter is back where it was, and the marked word is beside it.
  await expect
    .poll(async () => Math.abs((await wordTop(timeline.scroller, word.text)) - word.top))
    .toBeLessThanOrEqual(word.line)
  await waitForVisualSettle(page, ["[data-timeline-virtual-content]"])
  expect(Math.abs((await wordTop(timeline.scroller, word.text)) - word.top)).toBeLessThanOrEqual(word.line)
})

test("returns a reader who followed to the new end of a session that grew meanwhile", async ({ page }) => {
  const timeline = await openHistory(page, { streaming: true })
  await page.setViewportSize({ width: 1056, height: 844 })
  await expect(timeline.scroller.getByText("Checking the route", { exact: true })).toBeInViewport()

  await tab(page, otherSessionID).click()
  await expect(page.getByText("Other session prompt", { exact: true })).toBeVisible()
  await timeline.send(partDelta("prt_place_tail", `\n\n${"Arrived while away.\n\n".repeat(30)}The new end.`))
  await tab(page, sessionID).click()
  await expect(timeline.scroller.getByText("The new end.", { exact: true })).toBeInViewport()
})

// A transcript that loads in pages of 16 messages, on a narrow screen, with another session open in a tab. `older`
// holds each older page back. `streaming`: its last reply is still under way. `others`: more sessions open in tabs.
// `words`: no two words of a reply are the same, so a word names one place in the transcript.
async function openHistory(
  page: Page,
  input: { older?: Promise<void>; streaming?: boolean; others?: string[]; words?: boolean } = {},
) {
  const transcript = validateTimelineMessages([
    ...(input.words ? wordyMessages(40) : historyMessages(40)),
    userMessage(),
    assistantMessage([textPart("prt_place_tail", "Checking the route")], { completed: !input.streaming }),
  ])

  const asked = Promise.withResolvers<void>()
  const reader = session()

  const timeline = await setupTimeline(page, {
    sessions: [
      reader,
      session({ id: otherSessionID, title: "Other session" }),
      ...(input.others ?? []).map((id) => session({ id, title: `Other ${id}` })),
    ],
    tabs: [sessionID, otherSessionID, ...(input.others ?? [])],
    sessionMessages: transcript,
    viewport: { width: 390, height: 844 },
    pageMessages: (id, limit, before) => {
      if (id === otherSessionID)
        return {
          items: [userMessage([textPart("prt_place_other", "Other session prompt")], { id: "msg_place_other" })],
        }

      if (id !== sessionID)
        return { items: [userMessage([textPart(`prt_${id}`, `Prompt of ${id}`)], { id: `msg_${id}` })] }
      const end = before ? transcript.findIndex((message) => message.id === before) : transcript.length
      const start = Math.max(0, end - Math.min(16, limit))

      return { items: transcript.slice(start, end), cursor: start ? transcript[start]!.id : undefined }
    },
    beforeMessagesResponse: ({ before }) => (before ? input.older : undefined) ?? Promise.resolve(),
    onMessages: (request) => {
      if (request.before) asked.resolve()
    },
  })

  const content = page.locator("[data-timeline-virtual-content]")

  return {
    send: timeline.send,
    content,
    scroller: page.locator(".scroll-view__viewport", { has: content }),
    views: page.getByRole("tablist", { name: "Session view", exact: true }),
    /** An older page was asked for. */
    asked: asked.promise,
    /** Reverts the session to before a message, or undoes that, as the server reports it and answers from then on. */
    revert: (messageID: string | undefined) => {
      reader.revert = messageID ? { messageID } : undefined

      return timeline.send(
        messageID ? revertStaged({ sessionID, revert: { messageID } }) : revertCleared({ sessionID }),
      )
    },
  }
}

// The transcript of `historyMessages`, with replies made of words that each occur once.
function wordyMessages(count: number) {
  return Array.from({ length: count }, (_, index) => {
    const value = String(index).padStart(4, "0")
    const user = `msg_0${value}_history_a_user`

    return [
      userMessage(undefined, { id: user, created: 1690000000000 + index * 10_000 }),
      assistantMessage(
        [
          textPart(
            `prt_0${value}_history_text`,
            Array.from({ length: 90 }, (_, word) => `r${index}w${word}`).join(" "),
          ),
        ],
        { id: `msg_0${value}_history_b_assistant`, parentID: user, created: 1690000001000 + index * 10_000 },
      ),
    ]
  }).flat()
}

// The word at the reading line, 40% of the way down from the session header to the composer region: its text, where
// its top is on the screen, and the height of its line.
function wordAtReadingLine(scroller: Locator) {
  return scroller.evaluate((element) => {
    const view = element.getBoundingClientRect()
    const style = getComputedStyle(element)
    const top = view.top + (parseFloat(style.scrollPaddingTop) || 0)
    const y = top + (view.bottom - (parseFloat(style.scrollPaddingBottom) || 0) - top) * 0.4
    const caret = document.caretPositionFromPoint(view.left + view.width / 2, y)

    if (!caret || !(caret.offsetNode instanceof Text)) throw new Error("No text at the reading line")
    const text = caret.offsetNode.data
    const start = text.lastIndexOf(" ", Math.max(0, caret.offset - 1)) + 1
    const space = text.indexOf(" ", start)
    const end = space < 0 ? text.length : space
    const range = document.createRange()
    range.setStart(caret.offsetNode, start)
    range.setEnd(caret.offsetNode, end)

    return {
      text: text.slice(start, end),
      top: range.getBoundingClientRect().top,
      line: parseFloat(getComputedStyle(caret.offsetNode.parentElement!).lineHeight),
    }
  })
}

// Where the top of a word that occurs once is on the screen.
function wordTop(scroller: Locator, word: string) {
  return scroller.evaluate((element, word) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)

    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const at = ` ${node.textContent} `.indexOf(` ${word} `)

      if (at < 0) continue
      const range = document.createRange()
      range.setStart(node, at)
      range.setEnd(node, at + word.length)

      return range.getBoundingClientRect().top
    }

    return Number.NaN
  }, word)
}

// Scrolls up from the end, and returns where each row in view is drawn once the timeline has come to rest.
async function readHistory(page: Page, scroller: Locator, distance: number) {
  const tail = scroller.getByText("Checking the route", { exact: true })
  await expect(tail).toBeInViewport()
  await scroller.hover()
  await page.mouse.wheel(0, -distance)
  await expect(tail).not.toBeInViewport()
  await waitForVisualSettle(page, ["[data-timeline-virtual-content]"])
  const rows = await timelineRowTops(scroller)
  expect(Object.keys(rows).length).toBeGreaterThan(1)

  return rows
}

// The rows are drawn where they were, and still are once the timeline has come to rest.
async function expectRowsInPlace(page: Page, scroller: Locator, rows: Record<string, number>) {
  await expect.poll(() => timelineRowTops(scroller, Object.keys(rows))).toEqual(rows)
  await waitForVisualSettle(page, ["[data-timeline-virtual-content]"])
  expect(await timelineRowTops(scroller, Object.keys(rows))).toEqual(rows)
}

function placeholderHistory(id: string) {
  return { items: [{ id: `msg_${id}`, type: "user", text: `History for ${id}`, time: { created: 1 } }] } satisfies {
    items: SessionMessageInfo[]
  }
}

function part(page: Page, sessionID: string) {
  return page.locator(`[data-timeline-part-id="answer_${sessionID}:text:0"]`)
}

function textEnded(sessionID: string, directory: string): OpenCodeEvent {
  return {
    id: `evt_text_${sessionID}`,
    created: 4,
    type: "session.text.ended",
    location: { directory },
    durable: { aggregateID: sessionID, seq: 0, version: 1 },
    data: { sessionID, assistantMessageID: `answer_${sessionID}`, ordinal: 0, text: "Inspect `src/file.ts` again." },
  }
}

function tab(page: Page, sessionID: string) {
  return page.locator(`[data-titlebar-tab-link][href="${sessionHref(sessionID)}"]`)
}

// Opens a session by its route alone, as a link outside the tabs does.
function route(page: Page, sessionID: string) {
  return page.evaluate((path) => {
    history.pushState({}, "", path)
    dispatchEvent(new PopStateEvent("popstate"))
  }, sessionHref(sessionID))
}

// The source and target sessions open as titlebar tabs of one expanded project.
async function openTabs(page: Page, input: Partial<MockServerConfig>, extra: SeedInput = {}) {
  const mock = await mockStressTimeline(page, input)
  await seed(page, {
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

declare global {
  interface Window {
    __coldReveal?: Reveal
    __tabPaint?: TabPaint
  }
}

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

      window.__tabPaint = state
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
          // The part of the viewport above the composer region, which the timeline scrolls on under.
          const box = root.getBoundingClientRect()
          const view = { top: box.top, bottom: box.bottom - parseFloat(getComputedStyle(root).scrollPaddingBottom) }

          // A frame counts only when the row is painted: inside the viewport and not hidden by CSS.
          const inView = (element: Element) => {
            const rect = element.getBoundingClientRect()

            return (
              rect.bottom > view.top &&
              rect.top < view.bottom &&
              element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
            )
          }

          const visible = [...root.querySelectorAll<HTMLElement>("[data-message-id]")].flatMap((element) => {
            const id = element.dataset.messageId

            return id && inView(element) && destination.has(id) ? [id] : []
          })

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
  const read = () => page.evaluate(() => window.__tabPaint!.first)

  return {
    async firstPaint() {
      await expect.poll(read).toBeDefined()
      await expect.poll(() => page.evaluate(() => window.__tabPaint!.settled)).toBe(true)

      return (await read())!
    },
    stop: () =>
      page.evaluate(() => {
        const state = window.__tabPaint!
        state.stop()

        return state.removed
      }),
  }
}
