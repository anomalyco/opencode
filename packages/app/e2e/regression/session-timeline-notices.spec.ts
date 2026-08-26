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
          state: {
            status: "running",
            input: { description: "Inspect code" },
            metadata: { status: "running", ...(childID ? { sessionID: childID } : {}) },
          },
          time: { created: 2 },
        },
      ]
    : [{ type: "text", text: "Working" }],
  time: { created: 2, ...(completed ? { completed: 3 } : {}) },
})

test("moves blocking work to the background with Ctrl+B", async ({ page }) => {
  await setupTimeline(page, { sessionMessages: [user, assistant(false, true)] })
  const card = page.locator('[data-component="task-tool-card"]')
  await expect(card).toBeVisible()
  await expect(card).toContainText("Inspect code")
  await expect(card).not.toContainText("(background)")
  await expect(page.getByText("Called `subagent`", { exact: false })).toHaveCount(0)
  await expect(page.locator('[data-component="background-tool-control"]')).toHaveCount(0)
  const hint = page.locator('[data-component="session-background-hint"]')
  const hintPrefix = hint.locator('[data-slot="session-background-hint-prefix"]')
  await expect(hint).toBeVisible()
  await expect(page.locator('[data-timeline-row="Thinking"]')).toHaveCount(0)
  await expect
    .poll(async () => {
      const [cardBox, hintBox, prefixBox] = await Promise.all([
        card.boundingBox(),
        hint.boundingBox(),
        hintPrefix.boundingBox(),
      ])
      if (!cardBox || !hintBox || !prefixBox) return undefined
      return {
        aligned: Math.abs(cardBox.x - prefixBox.x) < 2,
        ordered: cardBox.y < hintBox.y,
      }
    })
    .toEqual({ aligned: true, ordered: true })

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
    sessionMessages: [user, assistant(false, true, childID)],
    sessions: [session(), session({ id: childID, parentID: sessionID, title: "Sleep for 5 minutes" })],
    sessionStatus: { [sessionID]: { type: "busy" }, [childID]: { type: "busy" } },
  })

  await expect(page.getByText(/move running work to the background/i)).toBeVisible()
  await page.locator('[data-component="task-tool-card"]').click()
  await expect(page).toHaveURL(new RegExp(`/session/${childID}$`))
  await expect(page.getByText(/move running work to the background/i)).toHaveCount(0)
})

test("shows a badge for active background work", async ({ page }) => {
  const childID = "ses_background_child"
  await setupTimeline(page, {
    sessionMessages: [user, assistant(true)],
    sessions: [session(), session({ id: childID, parentID: sessionID })],
    sessionStatus: { [childID]: { type: "busy" } },
  })

  await page.getByRole("button", { name: "Session details" }).click()
  const summary = page.getByRole("button", { name: "1 item running in background" })
  await expect(summary).toContainText("1")
  await expect(summary).toContainText("Running work in background")
  await summary.click()
  await expect(
    page.locator('[data-component="session-background-list"]').getByText("Agent", { exact: true }),
  ).toBeVisible()
})

test("separates blocking and already-backgrounded work into two rows", async ({ page }) => {
  const backgroundID = "ses_background_existing"
  const blockingID = "ses_background_blocking"
  const timeline = await setupTimeline(page, {
    sessionMessages: [
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

  const backgroundCard = page.locator('[data-timeline-part-id="call_backgrounded"]')
  await expect(page.getByText(/move running work to the background/i)).toBeVisible()
  await page.getByRole("button", { name: "Session details" }).click()
  const summary = page.getByRole("button", { name: "2 items running in background" })
  await expect(summary).toContainText("2")
  await summary.click()
  const list = page.locator('[data-component="session-background-list"]')
  await expect(list).toContainText("Background task")
  await expect(list).toContainText("sleep 120")
  await expect(backgroundCard).toContainText("Background task (background)")
  await expect(backgroundCard.locator('[data-component="session-progress-indicator-v2"]')).toBeVisible()
  await expect(
    page.locator('[data-timeline-part-id="call_shell_backgrounded"] [data-component="text-shimmer"]'),
  ).toHaveAttribute("data-active", "true")

  await timeline.transport.send({
    id: "evt_background_succeeded",
    created: Date.now(),
    type: "session.execution.succeeded",
    data: { sessionID: backgroundID },
  } as never)
  await expect(backgroundCard.locator('[data-component="session-progress-indicator-v2"]')).toHaveCount(0)
  await expect(backgroundCard).toContainText("Background task (background)")
})
