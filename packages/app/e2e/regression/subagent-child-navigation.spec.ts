import { base64Encode } from "@opencode-ai/util/encode"
import type { OpenCodeEvent, SessionMessageInfo } from "@opencode-ai/client/promise"
import { expect, test, type Page } from "@playwright/test"
import { currentSession, mockOpenCodeServer } from "../utils/mock-server"
import { expectSessionTitle } from "../utils/waits"

const directory = "C:/OpenCode/SubagentNavigation"
const projectID = "proj_subagent_navigation"
const parentID = "ses_subagent_parent"
const childID = "ses_subagent_child"
const grandchildID = "ses_subagent_grandchild"
const parentTitle = "Parent session"
const childTitle = "Subagent child session"
const grandchildTitle = "Nested subagent session"
// Child session pages derive their heading from the task part that spawned them.
const taskDescription = "Inspect child navigation"
const nestedTaskDescription = "Inspect nested navigation"

test.use({ viewport: { width: 1440, height: 900 } })

test("navigates to a subagent child session missing from the session list", async ({ page }) => {
  await setup(page)
  await openChildFromParent(page)

  await expectSessionTitle(page, taskDescription)
  await expect(page.getByRole("heading", { name: parentTitle })).toHaveCount(0)

  const titlebarRight = page.locator("#opencode-titlebar-right")
  await expect(titlebarRight.getByRole("button", { name: "Toggle review" })).toHaveCount(1)
})

test("keeps the root tab active for a nested subagent", async ({ page }) => {
  await setup(page)
  await openChildFromParent(page)
  await expectSessionTitle(page, taskDescription)

  const card = page.locator(`a[href="${sessionHref(grandchildID)}"]`)
  await expect(card).toBeVisible()
  await card.click()

  await expect(page).toHaveURL(new RegExp(`/server/.+/session/${grandchildID}$`), { timeout: 15_000 })
  await expectSessionTitle(page, nestedTaskDescription)

  const rootTab = page.locator(`[data-titlebar-tab-slot]:has(a[href="${sessionHref(parentID)}"])`)
  await expect(rootTab).toHaveAttribute("data-active", "true")
  await expect(page.locator("[data-titlebar-tab-slot]:visible")).toHaveCount(1)
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

  await page.locator(`a[href="${sessionHref(childID)}"]`).click()
  await requested.promise
  await Promise.all([expect(page).toHaveURL(sessionHref(parentID)), expectSessionTitle(page, parentTitle)]).finally(
    () => release.resolve(),
  )

  await expectSessionTitle(page, taskDescription)
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
  await expect(page.getByRole("button", { name: "Close Tab" })).toBeVisible()
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
    sessions: [session(parentID, parentTitle, 1700000000000), childSession(), grandchildSession()],
    pageMessages: (sessionID) => ({
      items: sessionID === parentID ? parentMessages() : sessionID === childID ? childMessages() : [],
    }),
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

function grandchildSession() {
  return session(grandchildID, grandchildTitle, 1700000002000, { parentID: childID })
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

function childMessages(): SessionMessageInfo[] {
  const userID = "msg_user_0002"
  const assistantID = "msg_assistant_0002"
  return [
    {
      id: userID,
      type: "user",
      time: { created: 1700000002000 },
      text: "Delegate nested work to a subagent",
    },
    {
      id: assistantID,
      type: "assistant",
      time: { created: 1700000003000, completed: 1700000004000 },
      model: { id: "claude-opus-4-6", providerID: "opencode" },
      agent: "build",
      cost: 0.01,
      tokens: { input: 100, output: 200, reasoning: 0, cache: { read: 0, write: 0 } },
      finish: "stop",
      content: [
        {
          type: "tool",
          id: "call_subagent_0002",
          name: "subagent",
          time: { created: 1700000003000, ran: 1700000003000, completed: 1700000004000 },
          state: {
            status: "completed",
            input: { description: nestedTaskDescription, agent: "explore", prompt: "Inspect the nested work." },
            content: [{ type: "text", text: "Nested subagent finished" }],
            metadata: { sessionID: grandchildID },
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
