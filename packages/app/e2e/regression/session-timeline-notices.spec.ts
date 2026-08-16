import { expect, test } from "@playwright/test"
import type { SessionMessageAssistant, SessionMessageInfo } from "@opencode-ai/client/promise"
import { session, sessionID, setupTimeline } from "../performance/timeline-stability/fixture"

const user = { id: "msg_user", type: "user", text: "Run it", time: { created: 1 } } satisfies SessionMessageInfo

const assistant = (completed: boolean, tool = false, childID?: string): SessionMessageAssistant => ({
  id: "msg_assistant",
  type: "assistant",
  agent: "build",
  model: { id: "model", providerID: "provider" },
  content: tool
    ? [
        {
          type: "tool",
          id: "call_subagent",
          name: "subagent",
          state: { status: "running", input: {}, metadata: childID ? { sessionID: childID } : {} },
          time: { created: 2 },
        },
      ]
    : [{ type: "text", text: "Working" }],
  time: { created: 2, ...(completed ? { completed: 3 } : {}) },
})

test("renders current protocol notices in CLI order", async ({ page }) => {
  const ownerWarnings: string[] = []
  page.on("console", (message) => {
    if (message.text().includes("computations created outside a `createRoot` or `render`"))
      ownerWarnings.push(message.text())
  })
  await setupTimeline(page, {
    currentMessages: [
      user,
      { id: "msg_agent", type: "agent-switched", agent: "explore", time: { created: 2 } },
      assistant(true),
      {
        id: "msg_subagent",
        type: "synthetic",
        text: "done",
        description: "Search code",
        metadata: { source: "subagent", agent: "explore", state: "completed" },
        time: { created: 4 },
      },
      {
        id: "msg_restart",
        type: "synthetic",
        text: "continue",
        description: "Continuing after restart",
        time: { created: 5 },
      },
      { id: "msg_skill", type: "skill", skill: "review", name: "Review", text: "instructions", time: { created: 6 } },
    ],
  })

  const notices = page.locator('[data-slot="session-timeline-notice"]')
  await expect(notices).toHaveCount(4)
  await expect(notices.nth(0)).toContainText("Agent · explore")
  await expect(notices.nth(1)).toContainText("explore finished · Search code")
  await expect(notices.nth(2)).toContainText("Continuing after restart")
  await expect(notices.nth(3)).toContainText("Skill · Review")
  expect(ownerWarnings).toEqual([])
})

test("moves blocking work to the background with Ctrl+B", async ({ page }) => {
  await setupTimeline(page, { currentMessages: [user, assistant(false, true)] })
  await expect(page.locator('[data-component="task-tool-card"]')).toBeVisible()
  await expect(page.getByText("Called `subagent`", { exact: false })).toHaveCount(0)
  await expect(page.locator('[data-component="background-tool-control"]')).toHaveCount(0)
  await expect(page.locator('[data-action="session-background-toggle"]')).toContainText("Move 1 subagent to background")

  const request = page.waitForRequest(
    (request) =>
      request.method() === "POST" && new URL(request.url()).pathname === `/api/session/${sessionID}/background`,
  )
  await page.keyboard.press("Control+b")
  await request
})

test("navigates from a running subagent card and hides background controls in the child", async ({ page }) => {
  const childID = "ses_running_child"
  await setupTimeline(page, {
    currentMessages: [user, assistant(false, true, childID)],
    sessions: [session(), session({ id: childID, parentID: sessionID, title: "Sleep for 5 minutes" })],
    sessionStatus: { [sessionID]: { type: "busy" }, [childID]: { type: "busy" } },
  })

  await expect(page.locator('[data-action="session-background-toggle"]')).toContainText("Move 1 subagent to background")
  await page.locator('[data-component="task-tool-card"]').click()
  await expect(page).toHaveURL(new RegExp(`/session/${childID}$`))
  await expect(page.locator('[data-component="session-background-dock"]')).toHaveCount(0)
})

test("shows a badge for active background work", async ({ page }) => {
  const childID = "ses_background_child"
  await setupTimeline(page, {
    currentMessages: [user, assistant(true)],
    sessions: [session(), session({ id: childID, parentID: sessionID })],
    sessionStatus: { [childID]: { type: "busy" } },
  })

  await expect(page.locator('[data-component="session-background-dock"]')).toContainText("1 subagent in background")
})

test("separates blocking and already-backgrounded work into two rows", async ({ page }) => {
  const backgroundID = "ses_background_existing"
  const blockingID = "ses_background_blocking"
  await setupTimeline(page, {
    currentMessages: [
      user,
      {
        id: "msg_backgrounded",
        type: "assistant",
        agent: "build",
        model: { id: "model", providerID: "provider" },
        content: [
          {
            type: "tool",
            id: "call_backgrounded",
            name: "subagent",
            state: {
              status: "completed",
              input: { description: "Background task" },
              content: [{ type: "text", text: "working" }],
              metadata: { sessionID: backgroundID, status: "running" },
            },
            time: { created: 2, completed: 3 },
          },
          {
            type: "tool",
            id: "call_shell_backgrounded",
            name: "shell",
            state: {
              status: "completed",
              input: { command: "sleep 120" },
              content: [{ type: "text", text: "working" }],
              metadata: { shellID: "shell_backgrounded", status: "running" },
            },
            time: { created: 2, completed: 3 },
          },
        ],
        time: { created: 2, completed: 3 },
      },
      {
        id: "msg_blocking",
        type: "assistant",
        agent: "build",
        model: { id: "model", providerID: "provider" },
        content: [
          {
            type: "tool",
            id: "call_blocking",
            name: "subagent",
            state: {
              status: "running",
              input: { description: "Foreground task" },
              metadata: { sessionID: blockingID },
            },
            time: { created: 4 },
          },
        ],
        time: { created: 4 },
      },
    ],
    sessions: [
      session(),
      session({ id: backgroundID, parentID: sessionID, title: "Background task" }),
      session({ id: blockingID, parentID: sessionID, title: "Foreground task" }),
    ],
    sessionStatus: {
      [sessionID]: { type: "busy" },
      [backgroundID]: { type: "busy" },
      [blockingID]: { type: "busy" },
    },
  })

  const dock = page.locator('[data-component="session-background-dock"]')
  await expect(dock).toContainText("Move 1 subagent to background")
  await expect(dock.getByText("Running 1 shell and 1 subagent in background", { exact: true })).toBeVisible()
  await expect(
    page.locator('[data-timeline-part-id="call_shell_backgrounded"] [data-component="text-shimmer"]'),
  ).toHaveAttribute("data-active", "true")
})
