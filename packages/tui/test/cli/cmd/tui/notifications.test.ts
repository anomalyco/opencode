import { describe, expect, test } from "bun:test"
import Notifications from "../../../../src/feature-plugins/system/notifications"
import type { PermissionRequest, QuestionRequest, Session, V2Event } from "@opencode-ai/sdk/v2"
import type { TuiAttentionNotifyInput } from "@opencode-ai/plugin/tui"
import { createTuiPluginApi } from "../../../fixture/tui-plugin"

async function setup() {
  const notifications: TuiAttentionNotifyInput[] = []
  const handlers = new Map<V2Event["type"], ((event: V2Event) => void)[]>()
  const session = (id: string, title: string, parentID?: string): Session => ({
    id,
    title,
    slug: id,
    projectID: "project",
    directory: "/workspace",
    ...(parentID && { parentID }),
    version: "0.0.0-test",
    time: { created: 0, updated: 0 },
  })
  const sessions: Record<string, Session> = {
    session: session("session", "Demo session"),
    subagent: session("subagent", "Subagent session", "session"),
    abort: session("abort", "Abort session"),
    timeout: session("timeout", "Timeout session"),
  }

  await Notifications.tui(
    createTuiPluginApi({
      attention: {
        async notify(input) {
          notifications.push(input)
          return { ok: true, notification: true, sound: true }
        },
      },
      event: {
        on: <Type extends V2Event["type"]>(type: Type, handler: (event: Extract<V2Event, { type: Type }>) => void) => {
          const list = handlers.get(type) ?? []
          const wrapped = handler as (event: V2Event) => void
          list.push(wrapped)
          handlers.set(type, list)
          return () => {
            handlers.set(
              type,
              (handlers.get(type) ?? []).filter((item) => item !== wrapped),
            )
          }
        },
      },
      state: {
        session: {
          get: (sessionID: string) => sessions[sessionID],
          status: () => ({ type: "busy" }),
        },
      },
    }),
    undefined,
    {} as never,
  )

  return {
    notifications,
    emit(event: V2Event) {
      for (const handler of handlers.get(event.type) ?? []) handler(event)
    },
  }
}

function question(id: string, sessionID = "session"): QuestionRequest {
  return {
    id,
    sessionID,
    questions: [],
  }
}

function form(id: string, sessionID = "session"): Extract<V2Event, { type: "form.created" }>["data"]["form"] {
  return {
    id,
    sessionID,
    title: "Input requested",
    mode: "form",
    fields: [],
  }
}

function permission(id: string, sessionID = "session"): PermissionRequest {
  return {
    id,
    sessionID,
    permission: "edit",
    patterns: [],
    metadata: {},
    always: [],
  }
}

function durable(sessionID: string): { aggregateID: string; seq: number; version: 1 } {
  return { aggregateID: sessionID, seq: 0, version: 1 }
}

function executionStarted(id: string, sessionID = "session"): V2Event {
  return {
    id,
    created: 0,
    type: "session.execution.started",
    durable: durable(sessionID),
    data: { sessionID },
  }
}

function executionSucceeded(id: string, sessionID = "session"): V2Event {
  return {
    id,
    created: 0,
    type: "session.execution.succeeded",
    durable: durable(sessionID),
    data: { sessionID },
  }
}

function executionFailed(id: string, sessionID = "session"): V2Event {
  return {
    id,
    created: 0,
    type: "session.execution.failed",
    durable: durable(sessionID),
    data: {
      sessionID,
      error: { type: "unknown", message: "boom" },
    },
  }
}

const questionNotification: TuiAttentionNotifyInput = {
  title: "Demo session",
  message: "Question needs input",
  notification: { when: "blurred" },
  sound: { name: "question", when: "always" },
}

const formNotification: TuiAttentionNotifyInput = {
  title: "Input requested",
  message: "Input needs response",
  notification: { when: "blurred" },
  sound: { name: "question", when: "always" },
}

const titledFormNotification: TuiAttentionNotifyInput = {
  ...formNotification,
  title: "Confirm deployment",
}

const globalFormNotification: TuiAttentionNotifyInput = {
  ...formNotification,
  title: "demo-mcp is requesting input",
}

const permissionNotification: TuiAttentionNotifyInput = {
  title: "Demo session",
  message: "Permission needs input",
  notification: { when: "blurred" },
  sound: { name: "permission", when: "always" },
}

describe("internal notifications TUI plugin", () => {
  test("notifies for form, question, and permission requests with blurred notifications and always-on sounds", async () => {
    const harness = await setup()

    harness.emit({
      id: "event-1",
      created: 0,
      type: "form.created",
      data: { form: { ...form("form-1"), title: "Confirm deployment" } },
    })
    harness.emit({ id: "event-2", created: 0, type: "question.asked", data: question("question-1") })
    harness.emit({ id: "event-3", created: 0, type: "permission.asked", data: permission("permission-1") })

    expect(harness.notifications).toEqual([titledFormNotification, questionNotification, permissionNotification])
  })

  test("notifies for global forms once the TUI can render them", async () => {
    const harness = await setup()

    harness.emit({
      id: "event-1",
      created: 0,
      type: "form.created",
      data: { form: { ...form("form-1", "global"), title: "demo-mcp is requesting input" } },
    })

    expect(harness.notifications).toEqual([globalFormNotification])
  })

  test("dedupes pending forms, questions, and permissions until they are resolved", async () => {
    const harness = await setup()

    harness.emit({ id: "event-1", created: 0, type: "form.created", data: { form: form("form-1") } })
    harness.emit({ id: "event-2", created: 0, type: "form.created", data: { form: form("form-1") } })
    harness.emit({
      id: "event-3",
      created: 0,
      type: "form.cancelled",
      data: { sessionID: "session", id: "form-1" },
    })
    harness.emit({ id: "event-4", created: 0, type: "form.created", data: { form: form("form-1") } })

    harness.emit({ id: "event-5", created: 0, type: "question.asked", data: question("question-1") })
    harness.emit({ id: "event-6", created: 0, type: "question.asked", data: question("question-1") })
    harness.emit({
      id: "event-7",
      created: 0,
      type: "question.replied",
      data: { sessionID: "session", requestID: "question-1", answers: [] },
    })
    harness.emit({ id: "event-8", created: 0, type: "question.asked", data: question("question-1") })

    harness.emit({ id: "event-9", created: 0, type: "permission.asked", data: permission("permission-1") })
    harness.emit({ id: "event-10", created: 0, type: "permission.asked", data: permission("permission-1") })
    harness.emit({
      id: "event-11",
      created: 0,
      type: "permission.replied",
      data: { sessionID: "session", requestID: "permission-1", reply: "once" },
    })
    harness.emit({ id: "event-12", created: 0, type: "permission.asked", data: permission("permission-1") })

    expect(harness.notifications).toEqual([
      formNotification,
      formNotification,
      questionNotification,
      questionNotification,
      permissionNotification,
      permissionNotification,
    ])
  })

  test("notifies for terminal lifecycle events even when attached after execution started", async () => {
    const harness = await setup()

    harness.emit(executionSucceeded("event-1"))
    harness.emit(executionStarted("event-2"))
    harness.emit(executionSucceeded("event-3"))

    expect(harness.notifications).toEqual([
      {
        title: "Demo session",
        message: "Session done",
        notification: { when: "blurred" },
        sound: { name: "done", when: "always" },
      },
      {
        title: "Demo session",
        message: "Session done",
        notification: { when: "blurred" },
        sound: { name: "done", when: "always" },
      },
    ])
  })

  test("uses sound-only notifications and subagent_done sound for subagent sessions", async () => {
    const harness = await setup()

    harness.emit({
      id: "event-1",
      created: 0,
      type: "form.created",
      data: { form: { ...form("form-1", "subagent"), title: "Questions" } },
    })
    harness.emit(executionStarted("event-2", "subagent"))
    harness.emit(executionSucceeded("event-3", "subagent"))

    expect(harness.notifications).toEqual([
      {
        title: "Questions",
        message: "Input needs response",
        notification: false,
        sound: { name: "question", when: "always" },
      },
      {
        title: "Subagent session",
        message: "Session done",
        notification: false,
        sound: { name: "subagent_done", when: "always" },
      },
    ])
  })

  test("notifies session errors once and suppresses the following idle done notification", async () => {
    const harness = await setup()

    harness.emit(executionStarted("event-1"))
    harness.emit(executionFailed("event-2"))
    harness.emit(executionSucceeded("event-3"))

    expect(harness.notifications).toEqual([
      {
        title: "Demo session",
        message: "boom",
        notification: { when: "blurred" },
        sound: { name: "error", when: "always" },
      },
    ])
  })

  test("special-cases aborts and model response timeouts", async () => {
    const harness = await setup()

    harness.emit(executionStarted("event-1", "abort"))
    harness.emit({
      id: "event-2",
      created: 0,
      type: "session.error",
      data: { sessionID: "abort", error: { name: "MessageAbortedError", data: { message: "Aborted" } } },
    })
    harness.emit(executionStarted("event-3", "timeout"))
    harness.emit({
      id: "event-4",
      created: 0,
      type: "session.error",
      data: { sessionID: "timeout", error: { name: "UnknownError", data: { message: "SSE read timed out" } } },
    })
    harness.emit(executionFailed("event-5", "timeout"))

    expect(harness.notifications).toEqual([
      {
        title: "Abort session",
        message: "Session aborted",
        notification: { when: "blurred" },
        sound: { name: "error", when: "always" },
      },
      {
        title: "Timeout session",
        message: "Model stopped responding",
        notification: { when: "blurred" },
        sound: { name: "error", when: "always" },
      },
    ])
  })
})
