import { base64Encode } from "@opencode-ai/util/encode"
import type { OpenCodeEvent, SessionMessageInfo } from "@opencode-ai/client/promise"
import { expect, test, type Page } from "@playwright/test"
import { currentSession, mockOpenCodeServer } from "../utils/mock-server"
import { expectSessionTitle } from "../utils/waits"

const directory = "C:/OpenCode/SubagentNavigation"
const projectID = "proj_subagent_navigation"
const parentID = "ses_subagent_parent"
const childID = "ses_subagent_child"
const parentTitle = "Parent session"
const childTitle = "Subagent child session"
// Child session pages derive their heading from the task part that spawned them.
const taskDescription = "Inspect child navigation"

test.use({ viewport: { width: 1440, height: 900 } })

test("navigates to a subagent child session missing from the session list", async ({ page }) => {
  await setup(page)
  await openChildFromParent(page)

  await expectSessionTitle(page, taskDescription)
  await expect(page.getByRole("heading", { name: parentTitle })).toHaveCount(0)

  await expect(page.getByRole("button", { name: "Toggle review", exact: true })).toBeVisible()
})

test("returns to the parent session with Escape", async ({ page }) => {
  await setup(page)
  await openChildFromParent(page)
  await expectSessionTitle(page, taskDescription)

  await page.keyboard.press("Escape")

  await Promise.all([expect(page).toHaveURL(sessionHref(parentID)), expectSessionTitle(page, parentTitle)])
})

test("shows parent lineage while the child timeline loads", async ({ page }) => {
  await setup(page)
  const requested = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  await page.route(
    (url) =>
      url.pathname === `/api/session/${childID}/message` && url.port === (process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"),
    async (route) => {
      requested.resolve()
      await release.promise
      await route.fallback()
    },
  )

  await page.goto(sessionHref(parentID))
  await expectSessionTitle(page, parentTitle)
  await page.getByRole("button", { name: "Used 1 Agent", exact: true }).click()
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
    (url) => url.pathname === `/api/session/${childID}` && url.port === (process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"),
    async (route) => {
      requested.resolve()
      await release.promise
      await route.fallback()
    },
  )
  await page.goto(sessionHref(parentID))
  await expectSessionTitle(page, parentTitle)

  await page.getByRole("button", { name: "Used 1 Agent", exact: true }).click()
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
    (url) => url.pathname === `/api/session/${childID}` && url.port === (process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"),
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

async function setup(page: Page, events?: () => OpenCodeEvent[]) {
  await mockOpenCodeServer(page, {
    directory,
    project: {
      id: projectID,
      worktree: directory,
      vcs: "git",
      name: "subagent-navigation",
      time: { created: 1700000000000, updated: 1700000000000 },
      sandboxes: [],
    },
    provider: {
      all: [
        {
          id: "opencode",
          name: "OpenCode",
          models: {
            "claude-opus-4-6": { id: "claude-opus-4-6", name: "Claude Opus 4.6", limit: { context: 200_000 } },
          },
        },
      ],
      connected: ["opencode"],
      default: { providerID: "opencode", modelID: "claude-opus-4-6" },
    },
    sessions: [session(parentID, parentTitle, 1700000000000), childSession()],
    pageMessages: (sessionID) => ({ items: sessionID === parentID ? parentMessages() : [] }),
    events,
    eventRetry: events ? 16 : undefined,
  })
  // The child session resolves by ID but is absent from the session list,
  // matching a subagent session that has not been loaded into the list cache yet.
  await page.route(
    (url) => url.pathname === "/api/session" && url.port === (process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"),
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify({
          data: [currentSession(session(parentID, parentTitle, 1700000000000))],
          cursor: {},
        }),
      }),
  )
  await configurePage(page)
}

async function openChildFromParent(page: Page) {
  await page.goto(sessionHref(parentID))
  await expectSessionTitle(page, parentTitle)
  await page.getByRole("button", { name: "Used 1 Agent", exact: true }).click()

  const card = page.locator(`a[href="${sessionHref(childID)}"]`)
  await expect(card).toBeVisible()
  await card.click()

  await expect(page).toHaveURL(new RegExp(`/server/.+/session/${childID}$`), { timeout: 15_000 })
}

function session(id: string, title: string, created: number, extra?: Record<string, unknown>) {
  return {
    id,
    slug: id,
    projectID,
    directory,
    title,
    version: "dev",
    time: { created, updated: created },
    ...extra,
  }
}

function childSession() {
  return session(childID, childTitle, 1700000001000, { parentID })
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

async function configurePage(page: Page) {
  const server = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`
  await page.addInitScript(
    ({ directory, server, sessionId }) => {
      localStorage.setItem(
        "opencode.global.dat:server",
        JSON.stringify({
          projects: { local: [{ worktree: directory, expanded: true }] },
          lastProject: { local: directory },
        }),
      )
      localStorage.setItem("opencode.window.browser.dat:tabs", JSON.stringify([{ type: "session", server, sessionId }]))
    },
    { directory, server, sessionId: parentID },
  )
}

function sessionHref(sessionID: string) {
  const server = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`
  return `/server/${base64Encode(server)}/session/${sessionID}`
}
