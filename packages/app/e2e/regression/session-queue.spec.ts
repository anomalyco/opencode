import { expect, test, type Page } from "@playwright/test"
import type { OpenCodeEvent, SessionInboxInfo, SessionMessageInfo } from "@opencode/client/promise"
import { PromptInput } from "@opencode/schema/prompt-input"
import { SessionInbox } from "@opencode/schema/session-inbox"
import { SessionMessage } from "@opencode/schema/session-message"
import { Schema } from "effect"
import { provider } from "../utils/app"
import type { MockServerConfig } from "../utils/mock-server"
import { openSession } from "../utils/workspace"

const sessionID = "ses_session_queue_regression"

// The session.prompt payload, as the server's endpoint validates it.
const PromptBody = Schema.Struct({
  id: SessionMessage.ID.pipe(Schema.optional),
  ...PromptInput.Prompt.fields,
  metadata: SessionInbox.UserPayload.fields.metadata,
  delivery: SessionInbox.Delivery.pipe(Schema.optional),
  resume: Schema.Boolean.pipe(Schema.optional),
})

const decodePromptBody = Schema.decodeUnknownSync(PromptBody)

type InboxRow = {
  id: string
  sessionID: string
  time: { created: number }
  type: "user"
  payload: {
    text: string
    metadata?: typeof PromptBody.Type.metadata
    files?: Extract<SessionInboxInfo, { type: "user" }>["payload"]["files"]
    agents?: Extract<SessionInboxInfo, { type: "user" }>["payload"]["agents"]
  }
  delivery: SessionInbox.Delivery
}

function storedFile(file: NonNullable<typeof PromptBody.Type.files>[number]) {
  const inline = file.uri.startsWith("data:")

  const stored: NonNullable<InboxRow["payload"]["files"]>[number] = {
    data: inline ? file.uri.slice(file.uri.indexOf(",") + 1) : "",
    mime: inline ? file.uri.slice("data:".length, file.uri.indexOf(";")) : "text/plain",
    source: inline ? { type: "inline" } : { type: "uri", uri: file.uri },
    name: file.name,
    description: file.description,
    mention: file.mention,
  }

  return stored
}

function createQueueMock(seed: string[], messages: SessionMessageInfo[] = []) {
  const rows: InboxRow[] = seed.map((text, index) => ({
    id: `inb_seed_${index + 1}`,
    sessionID,
    time: { created: 1700000000000 + index },
    type: "user",
    payload: { text },
    delivery: "queue",
  }))

  const events: OpenCodeEvent[] = []
  const prompts: (typeof PromptBody.Type)[] = []
  const compactions: SessionInboxInfo[] = []
  const changes: { inboxID: string; action: "cancel" | "steer" | "queue" }[] = []
  const log: string[] = []
  let sequence = 0

  const emit = <Type extends OpenCodeEvent["type"]>(
    type: Type,
    data: Extract<OpenCodeEvent, { type: Type }>["data"],
  ) => {
    sequence += 1
    // SAFETY: `type` selects `data` from the same OpenCodeEvent member, so the pair is that member.
    events.push({
      id: `evt_queue_${sequence}`,
      type,
      created: Date.now(),
      durable: { aggregateID: sessionID, seq: sequence, version: type === "session.tool.success" ? 2 : 1 },
      data,
    } as OpenCodeEvent)
  }

  return {
    rows,
    compactions,
    prompts,
    changes,
    log,
    messages,
    emit,
    events: () => events.splice(0),
    onPrompt: (input: Parameters<NonNullable<MockServerConfig["onPrompt"]>>[0]) => {
      const body = decodePromptBody(input.body)
      prompts.push(body)
      log.push(`prompt:${body.delivery ?? "steer"}`)

      const row: InboxRow = {
        id: body.id ?? `inb_mock_${sequence}`,
        sessionID: input.sessionID,
        time: { created: Date.now() },
        type: "user",
        payload: { text: body.text },
        delivery: body.delivery ?? "steer",
      }

      if (body.metadata !== undefined) row.payload.metadata = body.metadata

      // Store attachments the way the server materializes them, so re-admissions round-trip.
      if (body.files !== undefined) row.payload.files = body.files.map(storedFile)

      if (body.agents !== undefined)
        row.payload.agents = body.agents.map((agent) => ({ name: agent.name, mention: agent.mention }))
      rows.push(row)
      emit("session.inbox.enqueued", {
        sessionID: input.sessionID,
        inboxID: row.id,
        item: { type: "user", payload: row.payload, delivery: row.delivery },
      })
    },
    onCompact: (input: Parameters<NonNullable<MockServerConfig["onCompact"]>>[0]) => {
      log.push("compact")
      compactions.push({
        id: Schema.decodeUnknownSync(SessionMessage.ID)(input.body.id),
        sessionID: input.sessionID,
        time: { created: Date.now() },
        type: "compaction",
        payload: {},
        delivery: "steer",
      })
    },
    onInboxChange: (input: { sessionID: string; inboxID: string; action: "cancel" | "steer" | "queue" }) => {
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

      row.delivery = input.action
      emit("session.inbox.delivery.changed", {
        sessionID: input.sessionID,
        inboxID: input.inboxID,
        delivery: input.action,
      })
    },
  }
}

async function openQueue(
  page: Page,
  mock: ReturnType<typeof createQueueMock>,
  followUpBehavior?: "queue" | "steer",
  revert?: string,
) {
  const model = { id: "queue-model", name: "Queue Model" }

  const options: Parameters<typeof openSession>[1] = {
    name: "SessionQueueRegression",
    sessions: [
      {
        id: sessionID,
        title: "Session queue regression",
        model: { id: model.id, providerID: "opencode" },
        revert: revert ? { messageID: revert } : undefined,
      },
    ],
    provider: provider(model),
    pageMessages: () => ({ items: mock.messages }),
    sessionStatus: () => ({ [sessionID]: { type: "running" } }),
    inbox: () => [...mock.rows.map((row) => ({ ...row, payload: { ...row.payload } })), ...mock.compactions],
    onPrompt: mock.onPrompt,
    onCompact: mock.onCompact,
    onInboxChange: mock.onInboxChange,
    events: mock.events,
  }

  if (followUpBehavior) options.seed = { settings: { general: { followUpBehavior } } }
  await openSession(page, options)
  const composer = page.locator('[data-component="composer"]')

  return {
    composer,
    input: composer.locator('[data-component="composer-editor"]'),
    rows: page.locator('[data-component="session-queue-row"]'),
  }
}

async function runSlash(page: Page, input: Awaited<ReturnType<typeof openQueue>>["input"], name: string) {
  await input.pressSequentially(`/${name}`)
  await expect(page.locator('[data-component="composer-suggestions"] [data-suggestion-id][data-active]')).toContainText(
    `/${name}`,
  )
  await input.press("Enter")
}

function userRow(page: Page, messageID: string) {
  return page.locator(
    `[data-timeline-virtual-content] [data-timeline-row="UserMessage"][data-message-id="${messageID}"]`,
  )
}

test("follow-up preference controls Enter while Mod+Enter uses the alternate delivery", async ({ page }) => {
  const mock = createQueueMock([])
  const view = await openQueue(page, mock, "queue")

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
  mock.rows[0].payload.files = [
    { data: "aGk=", mime: "text/plain", source: { type: "uri", uri: "file:///repo/main.ts" }, name: "main.ts" },
  ]
  const view = await openQueue(page, mock)
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
  // A re-admitted file keeps the URI it came from instead of becoming an inline snapshot.
  expect(mock.prompts[2].files).toMatchObject([{ uri: "file:///repo/main.ts", name: "main.ts" }])
  expect(mock.changes).toEqual([
    { inboxID: "inb_seed_1", action: "cancel" },
    { inboxID: "inb_seed_2", action: "cancel" },
    { inboxID: "inb_seed_3", action: "cancel" },
  ])
})

for (const change of ["reorder", "edit"] as const) {
  test(`a ${change} that cannot re-admit a prompt leaves the queue unchanged`, async ({ page }) => {
    const order = ["first queued prompt", "second queued prompt", "third queued prompt"]
    const mock = createQueueMock(order)
    const admit = mock.onPrompt
    // The last prompt's re-admission fails after the server admitted it, so its response is lost.
    mock.onPrompt = (input) => {
      admit(input)

      if (input.body.text === order[2]) throw new Error("Connection lost after admission")
    }

    const view = await openQueue(page, mock)
    await expect(view.rows).toHaveCount(3)

    if (change === "reorder") {
      const first = view.rows.filter({ hasText: order[0] })
      const second = view.rows.filter({ hasText: order[1] })
      await first.getByRole("button", { name: "Reorder queued prompt" }).hover()
      await page.mouse.down()
      const target = await second.boundingBox()

      if (!target) throw new Error("The target queue row is not visible")
      await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 10 })
      await page.mouse.up()
    }

    if (change === "edit") {
      await view.rows.getByText(order[1], { exact: true }).click()
      await expect(view.input).toHaveText(order[1])
      await expect(view.input).toBeFocused()
      await view.input.press("End")
      await view.input.pressSequentially(", edited")
      await view.input.press("Enter")
    }

    // The replacements admitted before the failure are withdrawn; the originals stay in place.
    await expect.poll(() => mock.log.includes(`cancel:${mock.prompts.at(-1)?.id}`)).toBe(true)
    await expect.poll(() => mock.changes.length).toBe(mock.prompts.length)
    expect(mock.changes.every((entry) => entry.action === "cancel" && !entry.inboxID.startsWith("inb_seed_"))).toBe(
      true,
    )
    await expect(view.rows.locator('[data-action="session-queue-edit"]')).toHaveText(order)
    expect(mock.rows.map((row) => row.payload.text)).toEqual(order)

    // A failed edit keeps its draft in the composer so nothing typed is lost.
    if (change === "edit") await expect(view.input).toHaveText("second queued prompt, edited")
  })
}

test("editing restores the existing draft and replaces only the original queue position", async ({ page }) => {
  const mock = createQueueMock(["first queued prompt", "tighten the error copy", "third queued prompt"])
  const view = await openQueue(page, mock)
  const original = view.rows.getByText("tighten the error copy", { exact: true })
  await expect(original).toBeVisible()

  await view.input.fill("my in-progress draft")
  await original.click()
  await expect(view.input).toHaveText("tighten the error copy")
  await expect(view.input).toBeFocused()
  await view.input.press("Escape")
  await expect(view.input).toHaveText("my in-progress draft")

  await original.click()
  await expect(view.input).toHaveText("tighten the error copy")
  await expect(view.input).toBeFocused()
  // fill() on a composer that holds text can append, so extend the loaded text instead.
  await view.input.press("End")
  await view.input.pressSequentially(" and add a retry hint")
  await expect(view.input).toHaveText("tighten the error copy and add a retry hint")
  await view.input.press("Enter")

  await expect(view.rows.locator('[data-action="session-queue-edit"]')).toHaveText([
    "first queued prompt",
    "tighten the error copy and add a retry hint",
    "third queued prompt",
  ])
  await expect(view.input).toHaveText("my in-progress draft")
  // One rewrite from the edited position: the replacement, then the prompts after it.
  expect(mock.prompts.map((prompt) => prompt.text)).toEqual([
    "tighten the error copy and add a retry hint",
    "third queued prompt",
  ])
  expect(mock.prompts.every((prompt) => prompt.delivery === "queue" && prompt.resume === false)).toBe(true)
  expect(mock.changes).toEqual([
    { inboxID: "inb_seed_2", action: "cancel" },
    { inboxID: "inb_seed_3", action: "cancel" },
  ])
  expect(mock.log[0]).toBe("prompt:queue")
})

for (const delivery of ["queue", "steer"] as const) {
  test(`editing a prompt the server delivered meanwhile keeps the edit draft (${delivery})`, async ({ page }) => {
    const mock = createQueueMock(["first queued prompt", "second queued prompt"])
    const view = await openQueue(page, mock, "queue")
    await view.rows.getByText("second queued prompt", { exact: true }).click()
    await expect(view.input).toHaveText("second queued prompt")
    await expect(view.input).toBeFocused()
    await view.input.press("End")
    await view.input.pressSequentially(", edited")
    // The server delivers the original before the edit lands; this client has not heard yet.
    mock.rows.splice(1, 1)
    await view.input.press(delivery === "queue" ? "Enter" : "ControlOrMeta+Enter")

    await expect(page.getByText("Request failed")).toBeVisible()
    await expect(view.input).toHaveText("second queued prompt, edited")
    expect(mock.prompts).toEqual([])
    expect(mock.changes).toEqual([])
  })
}

for (const change of ["reorder", "edit"] as const) {
  test(`a staged revert refuses a queue ${change}, whose admission would commit it`, async ({ page }) => {
    const order = ["first queued prompt", "second queued prompt"]

    const mock = createQueueMock(order, [
      { id: "msg_queue_delivered", type: "user", text: "First prompt", time: { created: 1 } },
    ])

    const view = await openQueue(page, mock, undefined, "msg_queue_delivered")
    await expect(view.rows).toHaveCount(2)

    if (change === "reorder") {
      await view.rows.filter({ hasText: order[0] }).getByRole("button", { name: "Reorder queued prompt" }).hover()
      await page.mouse.down()
      const target = await view.rows.filter({ hasText: order[1] }).boundingBox()

      if (!target) throw new Error("The target queue row is not visible")
      await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 10 })
      await page.mouse.up()
    }

    if (change === "edit") await view.rows.getByText(order[1], { exact: true }).click()

    await expect(page.getByText("Redo the revert before you reorder or edit queued prompts")).toBeVisible()
    await expect(view.rows.locator('[data-action="session-queue-edit"]')).toHaveText(order)
    await expect(view.input).toHaveText("")
    expect(mock.prompts).toEqual([])
    expect(mock.changes).toEqual([])
  })
}

test("editing drops a file whose mention was deleted and keeps unmentioned context", async ({ page }) => {
  const mock = createQueueMock(["inspect @main.ts here"])
  mock.rows[0].payload.files = [
    {
      data: "aGk=",
      mime: "text/plain",
      source: { type: "uri", uri: "file:///repo/main.ts" },
      name: "main.ts",
      mention: { start: 8, end: 16, text: "@main.ts" },
    },
    { data: "bm90ZXM=", mime: "text/plain", source: { type: "uri", uri: "file:///repo/notes.md" }, name: "notes.md" },
  ]
  const view = await openQueue(page, mock)
  await view.rows.getByText("inspect @main.ts here", { exact: true }).click()
  await expect(view.input).toHaveText("inspect @main.ts here")
  // The edit focuses the composer a frame after loading it; keys sent earlier miss it.
  await expect(view.input).toBeFocused()
  await view.input.press("ControlOrMeta+a")
  await view.input.pressSequentially("inspect here")
  await view.input.press("Enter")

  await expect.poll(() => mock.prompts.length).toBe(1)
  expect(mock.prompts[0].files?.map((file) => file.uri)).toEqual(["file:///repo/notes.md"])
})

test("editing a comment-only prompt keeps its notes once", async ({ page }) => {
  const note = "The user made the following comment regarding line 2 of /repo/app.ts: check the guard"
  const mock = createQueueMock([note])
  mock.rows[0].payload.metadata = {
    displayText: "",
    comments: [
      {
        path: "/repo/app.ts",
        comment: "check the guard",
        selection: { startLine: 2, startChar: 0, endLine: 2, endChar: 0 },
        origin: "review",
      },
    ],
  }
  const view = await openQueue(page, mock)
  // With no display text, the editor shows the note itself, so the edit owns it as text.
  await view.rows.getByText(note, { exact: true }).click()
  await expect(view.input).toHaveText(note)
  await view.input.press("End")
  await view.input.pressSequentially(", please")
  await expect(view.input).toHaveText(`${note}, please`)
  await view.input.press("Enter")

  await expect.poll(() => mock.prompts.length).toBe(1)
  expect(mock.prompts[0].text).toBe(`${note}, please`)
  expect(mock.prompts[0].metadata).toMatchObject({ displayText: `${note}, please`, comments: [] })
})

test("Undo cancels only the selected queued prompt and focuses the restored input", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const text = "Review the detailed error report and check every step of the retry path ".repeat(4)
  const rest = ["first queued prompt", ...Array.from({ length: 5 }, (_, index) => `queued follow-up ${index + 1}`)]
  const mock = createQueueMock([...rest.slice(0, 1), text, ...rest.slice(1)])
  const view = await openQueue(page, mock)
  await expect(view.rows).toHaveCount(7)

  // A long prompt in a long queue on a narrow screen keeps its icon-only Undo usable.
  const undo = view.rows.filter({ hasText: text }).getByRole("button", { name: "Undo" })
  await expect(undo).toHaveText("")
  await undo.hover()
  await expect(page.getByRole("tooltip")).toHaveText("Undo")
  await undo.click()
  await expect(view.rows.locator('[data-action="session-queue-edit"]')).toHaveText(rest)
  await expect(view.input).toHaveText(text)
  await expect(view.input).toBeFocused()
  expect(mock.changes).toEqual([{ inboxID: "inb_seed_2", action: "cancel" }])
  expect(mock.prompts).toEqual([])
})

test("Undo appends to an existing draft and restores inline attachments", async ({ page }) => {
  const mock = createQueueMock(["queued with image"])
  mock.rows[0].payload.files = [
    {
      data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==",
      mime: "image/png",
      source: { type: "inline" },
      name: "shot.png",
    },
  ]
  const view = await openQueue(page, mock)
  await view.input.fill("my draft")
  await view.rows.getByRole("button", { name: "Undo" }).click()
  await expect(view.rows).toHaveCount(0)
  await expect(view.input).toHaveText("my draft\n\nqueued with image")
  await expect(view.input).toBeFocused()
  await expect(view.composer.getByRole("img", { name: "shot.png" })).toBeVisible()
  expect(mock.changes).toEqual([{ inboxID: "inb_seed_1", action: "cancel" }])
})

test("Undo of a comment-only prompt keeps the draft text and restores the comment once", async ({ page }) => {
  const comment = "check the guard"
  const mock = createQueueMock([`The user made the following comment regarding line 2 of /repo/app.ts: ${comment}`])
  mock.rows[0].payload.metadata = {
    displayText: "",
    comments: [
      {
        path: "/repo/app.ts",
        comment,
        selection: { startLine: 2, startChar: 0, endLine: 2, endChar: 0 },
        origin: "review",
      },
    ],
  }
  mock.rows[0].payload.files = [
    {
      data: "aGk=",
      mime: "text/plain",
      source: { type: "uri", uri: "file:///repo/app.ts?start=2&end=2" },
      name: "app.ts",
    },
  ]
  const view = await openQueue(page, mock)
  await view.input.fill("my draft")
  await view.rows.getByRole("button", { name: "Undo" }).click()

  await expect(view.rows).toHaveCount(0)
  await expect(view.input).toHaveText("my draft")
  const cards = view.composer.locator('[data-component="composer-attachments"] [data-component="attachment-card"]')
  await expect(cards).toHaveCount(1)
  await expect(cards).toContainText(comment)

  // The resubmission carries the draft text with no stray break and the comment's file exactly once.
  await view.input.press("Enter")
  await expect.poll(() => mock.prompts.length).toBe(1)
  expect(mock.prompts[0].text).toBe(
    `my draft\nThe user made the following comment regarding line 2 of /repo/app.ts: ${comment}`,
  )
  expect(mock.prompts[0].files?.map((file) => file.uri)).toEqual(["file:///repo/app.ts?start=2&end=2"])
})

test("Undo preserves mentioned file and agent references on resubmission", async ({ page }) => {
  const mock = createQueueMock(["inspect @main.ts with @build"])
  mock.rows[0].payload.files = [
    {
      data: "aGk=",
      mime: "text/plain",
      source: { type: "uri", uri: "file:///repo/main.ts" },
      name: "main.ts",
      mention: { start: 8, end: 16, text: "@main.ts" },
    },
  ]
  mock.rows[0].payload.agents = [{ name: "build", mention: { start: 22, end: 28, text: "@build" } }]
  const view = await openQueue(page, mock)
  await view.rows.getByRole("button", { name: "Undo" }).click()
  await expect(view.input).toHaveText("inspect @main.ts with @build")
  await view.input.press("Enter")
  await expect.poll(() => mock.prompts.length).toBe(1)
  // Like the TUI, a restored mention points at the file it named rather than a snapshot of it.
  expect(mock.prompts[0].files).toMatchObject([
    { uri: "file:///repo/main.ts", mention: { text: "@main.ts", start: 8, end: 16 } },
  ])
  expect(mock.prompts[0].agents).toMatchObject([{ name: "build", mention: { text: "@build" } }])
})

for (const delivery of ["queue", "steer"] as const) {
  test(`${delivery === "queue" ? "Undo" : "/undo of a pending steer"} keeps unmentioned file context`, async ({
    page,
  }) => {
    // Another client (for example ACP) can attach a file without mentioning it.
    const mock = createQueueMock(["inspect this file"])
    const inboxID = mock.rows[0].id
    mock.rows[0].delivery = delivery
    mock.rows[0].payload.files = [
      {
        data: "aGk=",
        mime: "text/plain",
        source: { type: "uri", uri: "file:///repo/main.ts" },
        name: "main.ts",
        description: "the failing version",
      },
    ]
    const view = await openQueue(page, mock)

    if (delivery === "queue") await view.rows.getByRole("button", { name: "Undo" }).click()

    if (delivery === "steer") {
      await expect(userRow(page, inboxID)).toContainText("inspect this file")
      await runSlash(page, view.input, "undo")
    }

    // Like the TUI, the file returns attached without a mention, as a chip rather than prompt text.
    const chip = view.composer.locator('[data-slot="composer-context-file"]')

    await expect(view.input).toHaveText("inspect this file")
    await expect(chip).toHaveCount(1)
    await expect(chip).toContainText("main.ts")
    expect(mock.changes).toEqual([{ inboxID, action: "cancel" }])

    // Like the TUI's blank Enter, a chip alone sends nothing: without text the draft reads as blank.
    await expect(view.input).toBeFocused()
    await view.input.press("ControlOrMeta+a")
    await view.input.press("Backspace")
    await expect(view.input).toHaveText("")
    await expect(view.composer.locator('[data-action="composer-submit"]')).toHaveAttribute("aria-label", "Stop")
    await expect(chip).toHaveCount(1)

    await view.input.pressSequentially("inspect this file")
    await view.input.press("Enter")
    await expect.poll(() => mock.prompts.length).toBe(1)
    expect(mock.prompts[0].files).toMatchObject([
      { uri: "file:///repo/main.ts", name: "main.ts", description: "the failing version" },
    ])
    expect(mock.prompts[0].files?.[0]?.mention).toBeUndefined()
    await expect(chip).toHaveCount(0)
  })
}

test("reverting to another prompt replaces the file chips of an earlier restore", async ({ page }) => {
  const mock = createQueueMock(
    [],
    [
      { id: "msg_queue_first", type: "user", text: "First prompt", time: { created: 1 } },
      {
        id: "msg_queue_second",
        type: "user",
        text: "Second prompt",
        files: [
          { data: "aGk=", mime: "text/plain", source: { type: "uri", uri: "file:///repo/main.ts" }, name: "main.ts" },
        ],
        time: { created: 2 },
      },
    ],
  )

  const view = await openQueue(page, mock)
  const chip = view.composer.locator('[data-slot="composer-context-file"]')

  for (const [id, text, chips] of [
    ["msg_queue_second", "Second prompt", 1],
    ["msg_queue_first", "First prompt", 0],
  ] as const) {
    const row = userRow(page, id)

    await row.hover()
    await row.getByRole("button", { name: "Revert message" }).click()
    await expect(view.input).toHaveText(text)
    await expect(chip).toHaveCount(chips)
  }
})

test("/undo withdraws a pending steer without interrupting the running session", async ({ page }) => {
  const mock = createQueueMock([])
  const view = await openQueue(page, mock, "steer")
  const stops: string[] = []
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname

    if (path.endsWith("/interrupt") || path.endsWith("/wait") || path.endsWith("/revert/stage")) stops.push(path)
  })
  const text = "U2: Also check the retry path."
  await view.input.fill(text)
  await view.input.press("Enter")
  await expect.poll(() => mock.rows.map((row) => row.delivery)).toEqual(["steer"])
  await expect(view.input).toHaveText("")

  const inboxID = mock.rows[0].id
  const pending = userRow(page, inboxID)

  await expect(pending).toContainText(text)
  await runSlash(page, view.input, "undo")

  await expect(pending).toHaveCount(0)
  await expect(view.input).toHaveText(text)
  expect(mock.changes).toEqual([{ inboxID, action: "cancel" }])
  expect(stops).toEqual([])
})

test("reverting a delivered prompt leaves queued prompts alone, as in the TUI", async ({ page }) => {
  const mock = createQueueMock(
    ["U2: queued follow-up"],
    [{ id: "msg_queue_delivered", type: "user", text: "First prompt", time: { created: 1 } }],
  )

  const view = await openQueue(page, mock)
  const delivered = userRow(page, "msg_queue_delivered")

  const staged = page.waitForResponse(
    (response) => new URL(response.url()).pathname === `/api/session/${sessionID}/revert/stage`,
  )

  await delivered.hover()
  await delivered.getByRole("button", { name: "Revert message" }).click()
  expect((await staged).ok()).toBe(true)

  await expect(view.input).toHaveText("First prompt")
  expect(mock.changes).toEqual([])
  await expect(view.rows).toHaveCount(1)
})

test("a shell command cannot wait in the queue, as in the TUI", async ({ page }) => {
  const mock = createQueueMock([])
  const view = await openQueue(page, mock, "queue")
  const shells: string[] = []
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.endsWith(`/${sessionID}/shell`)) shells.push(request.url())
  })

  await view.input.pressSequentially("!")
  await view.input.pressSequentially("git status")
  await view.input.press("Enter")

  await expect(page.getByText("This prompt cannot be queued")).toBeVisible()
  await expect(view.input).toHaveText("git status")
  expect(shells).toEqual([])
  expect(mock.prompts).toEqual([])
})

test("/compact runs with the composer model and shows a queued compaction, as in the TUI", async ({ page }) => {
  const mock = createQueueMock(
    [],
    [{ id: "msg_queue_delivered", type: "user", text: "First prompt", time: { created: 1 } }],
  )

  const view = await openQueue(page, mock)
  const models: unknown[] = []
  page.on("request", (request) => {
    if (new URL(request.url()).pathname !== `/api/session/${sessionID}/model`) return
    mock.log.push("model")
    models.push(request.postDataJSON())
  })

  await expect(userRow(page, "msg_queue_delivered")).toContainText("First prompt")
  await runSlash(page, view.input, "compact")

  await expect(page.locator('[data-timeline-row="CompactionQueued"]')).toHaveText("Session compaction queued")
  // The row is optimistic; the model switch still precedes the admission.
  await expect.poll(() => mock.log).toEqual(["model", "compact"])
  expect(models).toMatchObject([{ model: { id: "queue-model", providerID: "opencode" } }])
})

for (const [action, status] of [
  ["Move to queue", "steering"],
  ["Delete", "steering"],
  ["Move to queue", "starting"],
  ["Delete", "starting"],
] as const) {
  test(`${action} on a ${status} pending steer replaces Revert, as in the TUI`, async ({ page }) => {
    // A steer waits behind work only once the running execution delivered input; before that it is starting.
    const delivered: SessionMessageInfo[] =
      status === "steering"
        ? [{ id: "msg_queue_delivered", type: "user", text: "First prompt", time: { created: 1 } }]
        : []

    const mock = createQueueMock(["U2: Also check the retry path."], delivered)
    const inboxID = mock.rows[0].id
    mock.rows[0].delivery = "steer"
    const view = await openQueue(page, mock)
    const pending = userRow(page, inboxID)

    await expect(pending).toContainText("U2: Also check the retry path.")
    const message = pending.locator('[data-component="user-message"]')

    if (status === "steering") await expect(message).toHaveAttribute("data-pending", "true")
    else await expect(message).not.toHaveAttribute("data-pending")
    await pending.hover()
    await expect(pending.getByRole("button", { name: "Revert message" })).toHaveCount(0)
    await pending.getByRole("button", { name: action }).click()

    await expect(pending).toHaveCount(0)
    expect(mock.changes).toEqual([{ inboxID, action: action === "Delete" ? "cancel" : "queue" }])
    // Neither action returns the prompt to the composer; a moved steer waits in the queue.
    await expect(view.input).toHaveText("")
    await expect(view.rows).toHaveCount(action === "Delete" ? 0 : 1)

    if (action === "Move to queue") await expect(view.rows).toContainText("U2: Also check the retry path.")
  })
}

test("/undo returns a pending steer's review comment to the composer", async ({ page }) => {
  const display = "tighten this"
  const comment = "check the guard"

  const mock = createQueueMock([
    `${display}\nThe user made the following comment regarding line 2 of /repo/app.ts: ${comment}`,
  ])

  const row = mock.rows[0]
  row.delivery = "steer"
  row.payload.metadata = {
    displayText: display,
    comments: [
      {
        path: "/repo/app.ts",
        comment,
        selection: { startLine: 2, startChar: 0, endLine: 2, endChar: 0 },
        origin: "review",
      },
    ],
  }
  // The comment's context file, which a resubmission regenerates from the restored comment.
  row.payload.files = [
    {
      data: "aGk=",
      mime: "text/plain",
      source: { type: "uri", uri: "file:///repo/app.ts?start=2&end=2" },
      name: "app.ts",
    },
  ]
  const view = await openQueue(page, mock)

  const pending = userRow(page, row.id)

  await expect(pending).toContainText(display)
  await runSlash(page, view.input, "undo")

  await expect(pending).toHaveCount(0)
  await expect(view.input).toHaveText(display)
  // The comment card is the only card: its context file is regenerated from it, not restored twice.
  const cards = view.composer.locator('[data-component="composer-attachments"] [data-component="attachment-card"]')
  await expect(cards).toHaveCount(1)
  await expect(cards).toContainText(comment)
  expect(mock.changes).toEqual([{ inboxID: row.id, action: "cancel" }])
})

for (const delivery of ["steer", "queue"] as const) {
  test(`keeps finished tools above a pending ${delivery === "queue" ? "queue-to-steer" : "steer"} follow-up`, async ({
    page,
  }, testInfo) => {
    const model = { id: "queue-model", providerID: "opencode" }
    const userID = "msg_queue_initial_user"
    const assistantID = "msg_queue_continued_assistant"
    const followUp = "U2: Also check the retry path."

    const mock = createQueueMock(
      [],
      [
        { id: userID, type: "user", text: "U1: Inspect the queue ordering.", time: { created: 1700000000000 } },
        {
          id: "msg_queue_initial_assistant",
          type: "assistant",
          agent: "build",
          model,
          content: [{ type: "text", text: "A1: I will inspect the current implementation." }],
          finish: "tool-calls",
          time: { created: 1700000000001, completed: 1700000000002 },
        },
      ],
    )

    const view = await openQueue(page, mock, delivery)
    const transcript = page.locator("[data-timeline-virtual-content]")
    const thinking = transcript.locator('[data-timeline-row="Thinking"]')
    const working = transcript.locator('[data-component="session-working"]')
    await expect(transcript.getByText("A1: I will inspect the current implementation.", { exact: true })).toBeVisible()
    await expect(thinking).toHaveCount(0)
    await expect(view.input).toBeEditable()
    await view.input.fill(followUp)
    await view.input.press("Enter")
    await expect.poll(() => mock.rows.map((row) => row.delivery)).toEqual([delivery])
    await expect(view.input).toHaveText("")

    const inboxID = mock.rows[0].id
    const pending = transcript.locator(`[data-timeline-row="UserMessage"][data-message-id="${inboxID}"]`)

    if (delivery === "queue") {
      const queued = view.rows.filter({ hasText: followUp })
      await expect(queued).toBeVisible()
      await expect(pending).toHaveCount(0)
      await expect(thinking).toHaveCount(0)
      await queued.hover()
      await queued.getByRole("button", { name: "Steer", exact: true }).click()
      await expect.poll(() => mock.changes).toEqual([{ inboxID, action: "steer" }])
    }

    await expect(view.rows).toHaveCount(0)
    await expect(pending).toContainText(followUp)
    await expect(thinking).toHaveCount(0)

    const bubble = pending.locator('[data-slot="user-message-text"]')

    const colors =
      delivery === "steer"
        ? {
            delivered: await userRow(page, userID)
              .locator('[data-slot="user-message-text"]')
              .evaluate((element) => ({
                background: getComputedStyle(element).backgroundColor,
                text: getComputedStyle(element).color,
              })),
            pending: await bubble.evaluate((element) => {
              const probe = document.createElement("span")
              probe.style.backgroundColor = "var(--v2-background-bg-layer-02)"
              probe.style.color = "var(--v2-text-text-base)"
              element.appendChild(probe)

              const colors = {
                background: getComputedStyle(probe).backgroundColor,
                text: getComputedStyle(probe).color,
              }

              probe.remove()

              return colors
            }),
          }
        : undefined

    if (colors) {
      await expect(bubble).toHaveCSS("background-color", colors.pending.background)
      await expect(bubble).toHaveCSS("color", colors.pending.text)
      await pending.hover()
      await expect(pending.locator('[data-slot="user-message-meta"]')).toHaveText(
        /^Pending\s*·\s*Build\s*·\s*Queue Model$/,
      )
      await bubble.evaluate((element) => (element.dataset.deliveryMarker = "pending"))
    }

    // The next assistant step still belongs to U1: U2 has been admitted, not delivered.
    mock.emit("session.step.started", {
      sessionID,
      assistantMessageID: assistantID,
      agent: "build",
      model,
      started: Date.now(),
    })

    for (const tool of [
      { id: "tool_queue_read", name: "read", input: { path: "src/queue.ts" } },
      { id: "tool_queue_grep", name: "grep", input: { pattern: "retry", path: "src" } },
    ]) {
      const ref = { sessionID, assistantMessageID: assistantID, id: tool.id }
      mock.emit("session.tool.input.started", { ...ref, name: tool.name })
      mock.emit("session.tool.input.ended", { ...ref, text: JSON.stringify(tool.input) })
      mock.emit("session.tool.called", { ...ref, input: tool.input, executed: true })
      mock.emit("session.tool.success", {
        ...ref,
        content: [{ type: "text", text: "Inspection complete." }],
        executed: true,
      })
    }

    mock.emit("session.step.ended", {
      sessionID,
      assistantMessageID: assistantID,
      finish: "tool-calls",
      cost: 0,
      tokens: { input: 100, output: 20, reasoning: 0, cache: { read: 0, write: 0 } },
    })
    const tools = page.locator('[data-timeline-part-ids="tool_queue_read,tool_queue_grep"]')
    await expect(tools).toBeVisible()
    await expect(tools).toHaveText(/^Used\s*2\s*Read, Grep$/)
    await expect(tools.locator('[data-component="context-tool-group-trigger"]')).toHaveAttribute(
      "aria-label",
      "Used 2 Read, Grep",
    )
    await expect(thinking).toHaveCount(0)
    await expect(pending).toBeVisible()
    expect(mock.rows.map((row) => ({ id: row.id, delivery: row.delivery }))).toEqual([
      { id: inboxID, delivery: "steer" },
    ])
    await transcript.screenshot({ path: testInfo.outputPath("pending-steer.png") })

    await expect(tools.or(working).or(pending)).toHaveText([
      /^Used\s*2\s*Read, Grep$/,
      /^Working/,
      /U2: Also check the retry path\./,
    ])
    await expect(transcript.locator('[data-timeline-row="AssistantPart"]').filter({ has: tools })).toHaveAttribute(
      "data-message-id",
      userID,
    )
    await expect
      .poll(async () => {
        const boxes = await Promise.all([tools.boundingBox(), working.boundingBox(), pending.boundingBox()])

        return (
          boxes.every((box) => box !== null) &&
          boxes[0]!.y + boxes[0]!.height <= boxes[1]!.y &&
          boxes[1]!.y + boxes[1]!.height <= boxes[2]!.y
        )
      })
      .toBe(true)

    mock.rows.splice(0, 1)
    mock.emit("session.inbox.delivered", { sessionID, inboxID })
    await expect(thinking).toHaveCount(0)
    await expect(pending).toHaveCount(1)
    await expect(pending.or(working)).toHaveText([/U2: Also check the retry path\./, /^Working/])

    if (colors) {
      await expect(bubble).toHaveAttribute("data-delivery-marker", "pending")
      await expect(pending.locator('[data-slot="user-message-meta"]')).toHaveText(/^Build\s*·\s*Queue Model$/)
      await expect(bubble).toHaveCSS("background-color", colors.delivered.background)
      await expect(bubble).toHaveCSS("color", colors.delivered.text)
      await expect(bubble).toHaveCSS("transition-property", "background-color, color")
      await transcript.screenshot({ path: testInfo.outputPath("delivered-steer.png") })
      await page.emulateMedia({ reducedMotion: "reduce" })
      await expect(bubble).toHaveCSS("transition-duration", "0s")
    }

    await expect(transcript.locator('[data-timeline-row="UserMessage"]')).toHaveCount(2)
    await expect(transcript.locator('[data-timeline-row="AssistantPart"]').filter({ has: tools })).toHaveAttribute(
      "data-message-id",
      userID,
    )

    const later = { sessionID, assistantMessageID: "msg_queue_follow_up_assistant" }
    mock.emit("session.step.started", { ...later, agent: "build", model, started: Date.now() })
    mock.emit("session.text.started", { ...later, ordinal: 0 })
    mock.emit("session.text.ended", { ...later, ordinal: 0, text: "A3: Now checking the retry path for U2." })

    const response = transcript
      .locator('[data-timeline-row="AssistantPart"]')
      .filter({ hasText: "A3: Now checking the retry path for U2." })

    await expect(response).toHaveAttribute("data-message-id", inboxID)
    await expect(thinking).toHaveCount(0)
    await expect(tools.or(pending).or(response)).toHaveText([
      /^Used\s*2\s*Read, Grep$/,
      /U2: Also check the retry path\./,
      /A3: Now checking the retry path for U2\./,
    ])
  })
}
