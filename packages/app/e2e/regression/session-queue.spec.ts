import { expect, test, type Page } from "@playwright/test"
import type { OpenCodeEvent } from "@opencode-ai/client/promise"
import { base64Encode } from "@opencode-ai/util/encode"
import { mockOpenCodeServer } from "../utils/mock-server"
import { expectAppVisible } from "../utils/waits"

const directory = "C:/OpenCode/SessionQueueRegression"
const projectID = "proj_session_queue_regression"
const sessionID = "ses_session_queue_regression"
const server = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`

type InboxRow = {
  id: string
  sessionID: string
  timeCreated: number
  type: "user"
  payload: { text: string; metadata?: Record<string, unknown> }
  delivery: "steer" | "queue"
}

function createQueueMock(seed: string[]) {
  const rows: InboxRow[] = seed.map((text, index) => ({
    id: `inb_seed_${index + 1}`,
    sessionID,
    timeCreated: 1700000000000 + index,
    type: "user",
    payload: { text },
    delivery: "queue",
  }))
  const events: OpenCodeEvent[] = []
  const prompts: Record<string, unknown>[] = []
  const changes: { inboxID: string; action: "cancel" | "steer" }[] = []
  const log: string[] = []
  let sequence = 0
  const emit = (type: OpenCodeEvent["type"], data: OpenCodeEvent["data"]) => {
    sequence += 1
    events.push({
      id: `evt_queue_${sequence}`,
      type,
      created: Date.now(),
      durable: { aggregateID: sessionID, seq: sequence, version: 1 },
      data,
    } as OpenCodeEvent)
  }
  return {
    rows,
    prompts,
    changes,
    log,
    events: () => events.splice(0),
    onPrompt: (input: { sessionID: string; body: Record<string, unknown> }) => {
      prompts.push(input.body)
      log.push(`prompt:${String(input.body.delivery ?? "steer")}`)
      const row: InboxRow = {
        id: typeof input.body.id === "string" ? input.body.id : `inb_mock_${sequence}`,
        sessionID: input.sessionID,
        timeCreated: Date.now(),
        type: "user",
        payload: {
          text: typeof input.body.text === "string" ? input.body.text : "",
          ...(input.body.metadata === undefined ? {} : { metadata: input.body.metadata as Record<string, unknown> }),
        },
        delivery: input.body.delivery === "queue" ? "queue" : "steer",
      }
      rows.push(row)
      emit("session.inbox.enqueued", {
        sessionID: input.sessionID,
        inboxID: row.id,
        item: { type: "user", payload: row.payload, delivery: row.delivery },
      })
    },
    onInboxChange: (input: { sessionID: string; inboxID: string; action: "cancel" | "steer" }) => {
      changes.push({ inboxID: input.inboxID, action: input.action })
      log.push(`${input.action}:${input.inboxID}`)
      const index = rows.findIndex((row) => row.id === input.inboxID)
      const row = rows[index]
      if (!row) return
      if (input.action === "cancel") {
        rows.splice(index, 1)
        emit("session.inbox.cancelled", { sessionID: input.sessionID, inboxID: input.inboxID })
        return
      }
      row.delivery = "steer"
      emit("session.inbox.delivery.changed", {
        sessionID: input.sessionID,
        inboxID: input.inboxID,
        delivery: "steer",
      })
    },
  }
}

async function openSession(page: Page, mock: ReturnType<typeof createQueueMock>, followUpBehavior?: "queue" | "steer") {
  if (followUpBehavior) {
    await page.addInitScript(
      (behavior) => localStorage.setItem("settings.v3", JSON.stringify({ general: { followUpBehavior: behavior } })),
      followUpBehavior,
    )
  }
  await mockOpenCodeServer(page, {
    directory,
    project: {
      id: projectID,
      worktree: directory,
      vcs: "git",
      name: "session-queue-regression",
      time: { created: 1700000000000, updated: 1700000000000 },
      sandboxes: [],
    },
    provider: {
      all: [
        {
          id: "opencode",
          name: "OpenCode",
          models: { "queue-model": { id: "queue-model", name: "Queue Model", limit: { context: 200_000 } } },
        },
      ],
      connected: ["opencode"],
      default: { providerID: "opencode", modelID: "queue-model" },
    },
    sessions: [
      {
        id: sessionID,
        slug: "session-queue-regression",
        projectID,
        directory,
        title: "Session queue regression",
        version: "dev",
        time: { created: 1700000000000, updated: 1700000000000 },
      },
    ],
    pageMessages: () => ({ items: [] }),
    sessionStatus: () => ({ [sessionID]: { type: "running" } }),
    inbox: () => mock.rows.map((row) => ({ ...row, payload: { ...row.payload } })),
    onPrompt: mock.onPrompt,
    onInboxChange: mock.onInboxChange,
    events: mock.events,
  })
  await page.goto(`/server/${base64Encode(server)}/session/${sessionID}`)
  const composer = page.locator('[data-component="composer"]')
  await expectAppVisible(composer)
  return {
    composer,
    input: composer.locator('[data-component="composer-editor"]'),
    rows: page.locator('[data-component="session-queue-row"]'),
  }
}

test("follow-up preference controls Enter while Mod+Enter uses the alternate delivery", async ({ page }) => {
  const mock = createQueueMock([])
  const view = await openSession(page, mock, "queue")

  await view.input.fill("queue this follow-up")
  await expect(view.composer.locator('[data-action="composer-alternate-delivery"]')).toContainText("Steer")
  await view.input.press("Enter")
  await expect(view.rows.getByText("queue this follow-up", { exact: true })).toBeVisible()

  await view.input.fill("steer this correction")
  await view.input.press("ControlOrMeta+Enter")
  await expect.poll(() => mock.prompts.map((prompt) => prompt.delivery)).toEqual(["queue", "steer"])
  await expect(view.input).toHaveText("")
})

test("dragging reorders queued prompts", async ({ page }) => {
  const mock = createQueueMock(["first queued prompt", "second queued prompt", "third queued prompt"])
  const view = await openSession(page, mock)
  await expect(view.rows).toHaveCount(3)

  const first = view.rows.filter({ hasText: "first queued prompt" })
  const third = view.rows.filter({ hasText: "third queued prompt" })
  await first.getByRole("button", { name: "Reorder queued prompt" }).hover()
  await page.mouse.down()
  const target = await third.boundingBox()
  if (!target) throw new Error("The target queue row is not visible")
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 10 })
  await page.mouse.up()

  await expect(view.rows.locator('[data-action="session-queue-edit"]')).toHaveText([
    "second queued prompt",
    "third queued prompt",
    "first queued prompt",
  ])
  expect(mock.prompts.map((prompt) => prompt.text)).toEqual([
    "second queued prompt",
    "third queued prompt",
    "first queued prompt",
  ])
  expect(mock.changes).toEqual([
    { inboxID: "inb_seed_1", action: "cancel" },
    { inboxID: "inb_seed_2", action: "cancel" },
    { inboxID: "inb_seed_3", action: "cancel" },
  ])
})

test("editing restores the existing draft and replaces only the original queue position", async ({ page }) => {
  const mock = createQueueMock(["first queued prompt", "tighten the error copy", "third queued prompt"])
  const view = await openSession(page, mock)
  const original = view.rows.getByText("tighten the error copy", { exact: true })
  await expect(original).toBeVisible()

  await view.input.fill("my in-progress draft")
  await original.click()
  await expect(view.input).toHaveText("tighten the error copy")
  await view.input.press("Escape")
  await expect(view.input).toHaveText("my in-progress draft")

  await original.click()
  await expect(view.input).toHaveText("tighten the error copy")
  await view.input.fill("tighten the error copy and add a retry hint")
  await expect(view.input).toHaveText("tighten the error copy and add a retry hint")
  await view.input.press("Enter")

  await expect(view.rows.locator('[data-action="session-queue-edit"]')).toHaveText([
    "first queued prompt",
    "tighten the error copy and add a retry hint",
    "third queued prompt",
  ])
  await expect(view.input).toHaveText("my in-progress draft")
  expect(mock.prompts.map((prompt) => prompt.text)).toEqual([
    "tighten the error copy and add a retry hint",
    "tighten the error copy and add a retry hint",
    "third queued prompt",
  ])
  expect(mock.prompts.every((prompt) => prompt.delivery === "queue" && prompt.resume === false)).toBe(true)
  expect(mock.changes.map((change) => change.action)).toEqual(["cancel", "cancel", "cancel"])
  expect(mock.log[0]).toBe("prompt:queue")
})
