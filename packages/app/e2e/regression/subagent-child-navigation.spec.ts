import type { OpenCodeEvent, SessionMessageInfo } from "@opencode/client/promise"
import { timelinePresets } from "@opencode/session-ui/timeline/detail"
import { expect, test, type Locator, type Page } from "@playwright/test"
import { expectPath, SERVER, sessionHref } from "../utils/app"
import { currentSession } from "../utils/mock-server"
import { assistantMessage, session, sessionID, setupTimeline, textPart, userMessage } from "../utils/timeline"
import { expectSessionTitle } from "../utils/waits"
import { mockWorkspace } from "../utils/workspace"

const directory = "C:/OpenCode/SubagentNavigation"

const projectID = "proj_subagentnavigation"

const serverPort = new URL(SERVER).port

const parentID = "ses_subagent_parent"

const childID = "ses_subagent_child"

const grandchildID = "ses_subagent_grandchild"

const greatGrandchildID = "ses_subagent_great_grandchild"

const parentTitle = "Parent session"

const childTitle = "Subagent child session"

const grandchildTitle = "Nested subagent session"

const greatGrandchildTitle =
  "Deep research subagent session investigating a very long chain of agent registry failures and navigation breadcrumbs"

// Child session pages derive their heading from the task part that spawned them.
const taskDescription = "Inspect child navigation"

test.use({ viewport: { width: 1440, height: 900 } })

test("navigates to a subagent child session missing from the session list", async ({ page }) => {
  await setup(page)
  await openChildFromParent(page)

  await expectSessionTitle(page, taskDescription)
  await expect(page.getByRole("heading", { name: parentTitle })).toHaveCount(0)

  await expect(page.getByRole("button", { name: "Toggle review", exact: true })).toBeVisible()

  // Escape returns to the parent session.
  await page.keyboard.press("Escape")
  await Promise.all([expect(page).toHaveURL(sessionHref(parentID)), expectSessionTitle(page, parentTitle)])
})

test("keeps the parent title anchored when opening a subagent", async ({ page }) => {
  await setup(page)

  for (const direction of ["ltr", "rtl"] as const) {
    await page.goto(sessionHref(parentID))
    await page.evaluate((direction) => (document.documentElement.dir = direction), direction)
    await expectSessionTitle(page, parentTitle)

    const start = await titleInlineStart(page.locator("[data-session-title]").getByRole("heading", { name: parentTitle }))

    await page.getByRole("button", { name: "1 tool", exact: true }).click()
    await page.locator(`a[href="${sessionHref(childID)}"]`).click()
    await expectSessionTitle(page, taskDescription)

    const breadcrumb = page.locator('[data-slot="session-title-parent"]')

    await expect(breadcrumb).toHaveText(parentTitle)
    await expect.poll(() => titleInlineStart(breadcrumb)).toBeCloseTo(start, 0)
    await breadcrumb.click()
    await expectSessionTitle(page, parentTitle)
    await expect
      .poll(() => titleInlineStart(page.locator("[data-session-title]").getByRole("heading", { name: parentTitle })))
      .toBeCloseTo(start, 0)
  }
})

test("navigates from a running subagent card and hides background controls in the child", async ({ page }) => {
  const runningChildID = "ses_running_child"
  await setupTimeline(page, {
    settings: { timelineDetail: { ...timelinePresets[2].value, subagents: { placement: "separate" } } },
    sessionMessages: [
      { id: "msg_user", type: "user", text: "Run it", time: { created: 1 } },
      {
        id: "msg_assistant",
        type: "assistant",
        agent: "build",
        model: { id: "model", providerID: "provider" },
        content: [
          {
            type: "tool",
            id: "call_subagent",
            name: "subagent",
            state: {
              status: "running",
              input: { description: "Inspect code" },
              metadata: { status: "running", sessionID: runningChildID },
            },
            time: { created: 2 },
          },
        ],
        time: { created: 2 },
      },
    ],
    sessions: [session(), session({ id: runningChildID, parentID: sessionID, title: "Sleep for 5 minutes" })],
    sessionStatus: { [sessionID]: { type: "busy" }, [runningChildID]: { type: "busy" } },
  })
  const hint = page.getByRole("button", { name: /move running work to the background/i })
  await expect(hint).toBeVisible()
  await page.locator('[data-component="task-tool-card"]').click()
  await expect(page).toHaveURL(new RegExp(`/session/${runningChildID}$`))
  await expect(hint).toHaveCount(0)
})

test("opens a directly linked nested subagent in its root session tab", async ({ page }) => {
  await setup(page, undefined, 1)
  await page.goto(sessionHref(grandchildID), { waitUntil: "domcontentloaded" })

  await expect(page.locator('[data-slot="session-title-parent"]')).toHaveText(childTitle)
  await expect(page.locator('[data-slot="session-title-child"]')).toHaveText(grandchildTitle)
  const tabs = page.locator('[data-slot="titlebar-tabs"] [data-titlebar-tab-slot]')
  await expect(tabs.locator(`a[href="${sessionHref(grandchildID)}"]`)).toHaveCount(1)
  await expect(tabs).toHaveCount(1)
  await expect(tabs.locator('[data-slot="tab-title"]')).toHaveText(parentTitle)
})

test("shows the full ancestor path and navigates to an earlier subagent", async ({ page }) => {
  await setup(page, undefined, 2)
  await page.goto(sessionHref(greatGrandchildID), { waitUntil: "domcontentloaded" })

  await expect(page.locator("[data-timeline-virtual-content]")).toBeAttached()
  const header = page.locator("[data-session-title]")
  await expect(header.locator('[data-slot="session-title-ancestor"]')).toHaveText([parentTitle, childTitle])
  await expect(header.locator('[data-slot="session-title-parent"]')).toHaveText(grandchildTitle)
  await expect(header.getByRole("heading", { name: greatGrandchildTitle })).toBeVisible()

  await header.getByRole("button", { name: childTitle, exact: true }).click()
  await expect(page).toHaveURL(sessionHref(childID))
  await expect(page.locator("[data-session-title]").getByRole("heading", { name: childTitle })).toBeVisible()
  await expect(page.locator('[data-slot="titlebar-tabs"] [data-titlebar-tab-slot]')).toHaveCount(1)
})

test("keeps the active nested session visible in a narrow desktop header", async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 720 })
  await setup(page, undefined, 2)
  await page.goto(sessionHref(greatGrandchildID), { waitUntil: "domcontentloaded" })

  const header = page.locator("[data-session-title]")
  const heading = header.getByRole("heading", { name: greatGrandchildTitle })
  const separator = header.locator('[data-slot="session-title-ancestors"] + [data-slot="session-title-separator"]')
  await expect(header.locator('[data-slot="session-title-ancestor"]')).toHaveText([parentTitle, childTitle])
  await expect(heading).toBeInViewport()
  await expect(separator).toBeInViewport()
  const bounds = await heading.boundingBox()
  expect(bounds).not.toBeNull()
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(820)

  await page.evaluate(() => document.documentElement.setAttribute("dir", "rtl"))
  await expect(heading).toBeInViewport()
  await expect(separator).toBeInViewport()

  const root = header.locator(`[data-slot="session-title-ancestor"][data-session-id="${parentID}"]`)
  await root.focus()
  await expect(root).toBeFocused()
  await root.press("Enter")
  await expect(page).toHaveURL(sessionHref(parentID))
})

test("shows parent lineage while the child timeline loads", async ({ page }) => {
  await setup(page)
  const requested = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  await page.route(
    (url) => url.pathname === `/api/session/${childID}/message` && url.port === serverPort,
    async (route) => {
      requested.resolve()
      await release.promise
      await route.fallback()
    },
  )

  await page.goto(sessionHref(parentID))
  await expectSessionTitle(page, parentTitle)
  await page.getByRole("button", { name: "1 tool", exact: true }).click()
  await page.locator(`a[href="${sessionHref(childID)}"]`).click()
  await Promise.all([requested.promise, expect(page).toHaveURL(sessionHref(childID))])
  await Promise.all([
    expect(page.locator('[data-slot="session-title-parent"]')).toHaveText(parentTitle),
    expect(page.locator('[data-slot="session-title-child"]')).toHaveText(childTitle),
  ]).finally(() => release.resolve())
  await expectSessionTitle(page, taskDescription)
})

test("keeps the parent visible while the child session resolves", async ({ page }) => {
  await setup(page)
  const requested = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  await page.route(
    (url) => url.pathname === `/api/session/${childID}` && url.port === serverPort,
    async (route) => {
      requested.resolve()
      await release.promise
      await route.fallback()
    },
  )
  await page.goto(sessionHref(parentID))
  await expectSessionTitle(page, parentTitle)

  await page.getByRole("button", { name: "1 tool", exact: true }).click()
  await page.locator(`a[href="${sessionHref(childID)}"]`).click()
  await requested.promise
  await Promise.all([expect(page).toHaveURL(sessionHref(parentID)), expectSessionTitle(page, parentTitle)]).finally(
    () => release.resolve(),
  )

  await expectSessionTitle(page, taskDescription)
})

test("keeps the parent tab selected while a loaded child session resolves", async ({ page }) => {
  await setup(page)
  await openChildFromParent(page)
  await expectSessionTitle(page, taskDescription)
  await page.goBack()
  await Promise.all([expect(page).toHaveURL(sessionHref(parentID)), expectSessionTitle(page, parentTitle)])

  const requested = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  await page.route(
    (url) => url.pathname === `/api/session/${childID}` && url.port === serverPort,
    async (route) => {
      requested.resolve()
      await release.promise
      await route.fallback()
    },
  )

  const parentTab = page.locator("[data-titlebar-tab-slot]", {
    has: page.locator('[data-slot="tab-title"]', { hasText: parentTitle }),
  })

  await page.locator(`a[href="${sessionHref(childID)}"]`).click()
  await Promise.all([requested.promise, expect(page).toHaveURL(sessionHref(childID))])
  await Promise.all([
    expect(parentTab).toHaveAttribute("data-active", "true"),
    expect(page.locator('[data-slot="session-title-parent"]')).toHaveText(parentTitle),
  ]).finally(() => release.resolve())
  await expectSessionTitle(page, taskDescription)

  const home = page.getByRole("button", { name: "Home" })
  await home.click()
  await expect(page).toHaveURL("/")
  const childTab = page.locator(`[data-slot="titlebar-tabs"] a[href="${sessionHref(childID)}"]`)
  await expect(childTab).toHaveCount(1)
  await childTab.click()
  await Promise.all([expect(page).toHaveURL(sessionHref(childID)), expectSessionTitle(page, taskDescription)])
})

test("shows the not found fallback when the viewed session is deleted", async ({ page }) => {
  const events: OpenCodeEvent[] = []
  await setup(page, () => events.splice(0, 1))
  await openChildFromParent(page)
  await expectSessionTitle(page, taskDescription)

  events.push({
    id: "evt_session_deleted",
    created: 1700000003000,
    type: "session.deleted",
    durable: { aggregateID: childID, seq: 1, version: 2 },
    location: { directory },
    data: { sessionID: childID },
  })

  await expect(page.getByText("This session cannot be found")).toBeVisible()
  await expect(page.getByRole("button", { name: "Close Tab", exact: true })).toBeVisible()
  await expect(page.getByRole("heading", { name: taskDescription })).toHaveCount(0)
})

test.describe("session ID links", () => {
  const target = "ses_0123456789abcdefghijklmnop"
  const missing = "ses_abcdefghijklmnopqrstuvwxyz"

  test("opens a verified session from agent prose or inline code with the keyboard", async ({ page }) => {
    await setupTimeline(page, {
      sessions: [session(), session({ id: target, title: "Linked session" })],
      messages: [
        userMessage(),
        assistantMessage([textPart("prt_session_links", `Visit ${target} or \`${target}\` to see the result.`)]),
      ],
    })
    const markdown = page.locator('[data-component="markdown"]').filter({ hasText: `Visit ${target}` })
    await expect(markdown).toHaveAttribute("data-markdown-ready", "")
    await expect(markdown.getByRole("button", { name: target })).toHaveCount(2)
    await markdown
      .getByRole("button", { name: target })
      .filter({ has: page.locator("code") })
      .press("Enter")
    await expectPath(page, sessionHref(target))
    await expect(page.locator(`[data-titlebar-tab-link][href$="/session/${target}"]`)).toContainText("Linked session")
  })

  test("does not navigate to an ID that is absent from the current server", async ({ page }) => {
    await setupTimeline(page, {
      messages: [userMessage(), assistantMessage([textPart("prt_session_missing", `See ${missing}.`)])],
    })
    const markdown = page.locator('[data-component="markdown"]').filter({ hasText: `See ${missing}.` })
    await expect(markdown).toHaveAttribute("data-markdown-ready", "")
    await markdown.getByRole("button", { name: missing }).click()
    await expect(page.getByText("This session cannot be found")).toBeVisible()
    await expectPath(page, sessionHref(sessionID))
  })
})

async function setup(page: Page, events?: () => OpenCodeEvent[], nestedDepth: 0 | 1 | 2 = 0) {
  await mockWorkspace(page, {
    name: "SubagentNavigation",
    sessions: [
      { id: parentID, title: parentTitle, created: 1700000000000 },
      { id: childID, title: childTitle, created: 1700000001000, parentID },
      ...(nestedDepth >= 1
        ? [{ id: grandchildID, title: grandchildTitle, created: 1700000002000, parentID: childID }]
        : []),
      ...(nestedDepth >= 2
        ? [{ id: greatGrandchildID, title: greatGrandchildTitle, created: 1700000003000, parentID: grandchildID }]
        : []),
    ],
    pageMessages: (sessionID) => ({ items: sessionID === parentID ? parentMessages() : [] }),
    events,
    eventRetry: events ? 16 : undefined,
    seed: { tabs: [parentID] },
  })
  // The child session resolves by ID but is absent from the session list,
  // matching a subagent session that has not been loaded into the list cache yet.
  await page.route(
    (url) => url.pathname === "/api/session" && url.port === serverPort,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify({
          data: [
            currentSession({
              id: parentID,
              slug: parentID,
              projectID,
              directory,
              title: parentTitle,
              version: "dev",
              time: { created: 1700000000000, updated: 1700000000000 },
            }),
          ],
          cursor: {},
        }),
      }),
  )
}

function titleInlineStart(title: Locator) {
  return title.evaluate((element) => {
    const range = document.createRange()

    range.selectNodeContents(element)

    const bounds = range.getBoundingClientRect()

    return document.documentElement.dir === "rtl" ? bounds.right : bounds.left
  })
}

async function openChildFromParent(page: Page) {
  await page.goto(sessionHref(parentID))
  await expectSessionTitle(page, parentTitle)
  await page.getByRole("button", { name: "1 tool", exact: true }).click()

  const card = page.locator(`a[href="${sessionHref(childID)}"]`)
  await expect(card).toBeVisible()
  await card.click()

  await expect(page).toHaveURL(new RegExp(`/server/.+/session/${childID}$`), { timeout: 15_000 })
}

function parentMessages(): SessionMessageInfo[] {
  const userID = "msg_user_0001"
  const assistantID = "msg_assistant_0001"

  return [
    {
      id: userID,
      type: "user",
      time: { created: 1700000000000 },
      text: "Delegate work to a subagent",
    },
    {
      id: assistantID,
      type: "assistant",
      time: { created: 1700000001000, completed: 1700000002000 },
      model: { id: "claude-opus-4-6", providerID: "opencode" },
      agent: "build",
      cost: 0.01,
      tokens: { input: 100, output: 200, reasoning: 0, cache: { read: 0, write: 0 } },
      finish: "stop",
      content: [
        {
          type: "tool",
          id: "call_subagent_0001",
          name: "subagent",
          time: { created: 1700000001000, ran: 1700000001000, completed: 1700000002000 },
          state: {
            status: "completed",
            input: { description: taskDescription, agent: "explore", prompt: "Inspect the delegated work." },
            content: [{ type: "text", text: "Subagent finished" }],
            metadata: { sessionID: childID },
          },
        },
      ],
    },
  ]
}
