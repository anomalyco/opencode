import { expect, test } from "@playwright/test"
import type { SessionMessageAssistant, SessionMessageInfo } from "@opencode-ai/client/promise"
import {
  compactionDelta,
  compactionEnded,
  compactionFailed,
  compactionStarted,
  event,
  session,
  sessionID,
  setupTimeline,
} from "../performance/timeline-stability/fixture"

const user = { id: "msg_user", type: "user", text: "Run it", time: { created: 1 } } satisfies SessionMessageInfo

const assistant = (
  completed: boolean,
  tool = false,
  childID?: string,
  background = false,
): SessionMessageAssistant => ({
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
            input: { description: "Inspect code", ...(background ? { background: true } : {}) },
            metadata: { status: "running", ...(childID ? { sessionID: childID } : {}) },
          },
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
    sessionMessages: [
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
  await expect(notices).toHaveClass([/text-text-weak/, /text-text-weak/, /text-text-weak/, /text-text-weak/])
  await expect(notices.locator(".text-text-strong")).toHaveCount(0)
  expect(ownerWarnings).toEqual([])
})

test("renders a compaction summary while it streams and after completion", async ({ page }) => {
  const timeline = await setupTimeline(page, { sessionMessages: [user, assistant(true)] })

  await timeline.send(
    compactionStarted({
      sessionID,
      reason: "manual",
      recent: "",
    }),
  )

  const compaction = page.locator('[data-component="session-compaction-message"]')
  await expect(compaction.getByText("Session compacted", { exact: true })).toBeVisible()

  await timeline.send(
    compactionDelta({
      sessionID,
      text: "## Checkpoint\n\nStreamed implementation details.",
    }),
  )
  await expect(compaction.getByRole("heading", { name: "Checkpoint" })).toBeVisible()
  await expect(compaction).toContainText("Streamed implementation details.")

  await timeline.send(
    compactionEnded({
      sessionID,
      reason: "manual",
      text: "## Checkpoint\n\nFinal implementation details.",
      recent: "",
    }),
  )
  await expect(compaction).toContainText("Final implementation details.")
  await expect(compaction).not.toContainText("Streamed implementation details.")
})

test("updates running compactions to failed and cancelled boundaries", async ({ page }) => {
  const timeline = await setupTimeline(page, { sessionMessages: [user, assistant(true)] })

  await timeline.send(compactionStarted({ sessionID, reason: "auto", recent: "" }))
  await timeline.send(compactionDelta({ sessionID, text: "Partial summary that should be discarded." }))
  await timeline.send(
    compactionFailed({
      sessionID,
      reason: "auto",
      error: {
        type: "compaction.failed",
        message: 'Error: {"error":{"type":"ProviderError","message":"The provider rejected the summary."}}',
      },
    }),
  )

  const compactions = page.locator('[data-component="session-compaction-message"]')
  const failed = compactions.filter({ hasText: "The provider rejected the summary." })
  await expect(failed.getByText("Session compacted", { exact: true })).toBeVisible()
  await expect(failed.getByText("ProviderError: The provider rejected the summary.", { exact: true })).toBeVisible()
  await expect(failed).not.toContainText("Partial summary that should be discarded.")

  await timeline.send(compactionStarted({ sessionID, reason: "manual", recent: "" }))
  await timeline.send(
    compactionFailed({
      sessionID,
      reason: "manual",
      error: { type: "aborted", message: "Cancellation detail should stay hidden." },
    }),
  )

  await expect(compactions).toHaveCount(2)
  const cancelled = compactions.filter({ hasNotText: "The provider rejected the summary." })
  await expect(cancelled.getByText("Session compacted", { exact: true })).toBeVisible()
  await expect(cancelled).not.toContainText("Cancellation detail should stay hidden.")
})

test("shows a delegating row while subagent input streams", async ({ page }) => {
  await setupTimeline(page, {
    sessionMessages: [
      user,
      {
        ...assistant(false),
        content: [
          {
            type: "tool",
            id: "call_subagent",
            name: "subagent",
            state: { status: "streaming", input: "" },
            time: { created: 2 },
          },
        ],
      },
    ],
  })

  const delegating = page.locator('[data-component="task-tool-delegating"]')
  await expect(delegating).toBeVisible()
  const shimmer = delegating.locator('[data-component="text-shimmer"]')
  await expect(shimmer).toHaveAttribute("aria-label", "Delegating agent...")
  await expect(shimmer).toHaveCSS("line-height", "16px")
  const icon = delegating.locator('[data-slot="icon-svg"]')
  await expect(icon.locator('use[href="#opencode-v2-icon-subagent"]')).toBeVisible()
  await expect(icon).toHaveCSS("color", "rgb(174, 174, 174)")
  await expect(page.locator('[data-component="task-tool-card"]')).toHaveCount(0)
  await expect(page.locator('[data-timeline-row="Thinking"]')).toHaveCount(0)
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

test("waits for completion before labeling requested background work", async ({ page }) => {
  await setupTimeline(page, { sessionMessages: [user, assistant(false, true, undefined, true)] })
  await expect(page.locator('[data-component="task-tool-card"]')).not.toContainText("(background)")
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
