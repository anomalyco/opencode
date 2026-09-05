import { describe, expect, test } from "bun:test"
import Notifications from "../../../../src/feature-plugins/system/notifications"
import type { Event, PermissionRequest, QuestionRequest, Session } from "@opencode-ai/sdk/v2"
import type { TuiAttentionNotifyInput } from "@opencode-ai/plugin/tui"
import { createTuiPluginApi } from "../../../fixture/tui-plugin"

async function setup(input: { auto?: boolean } = {}) {
  const notifications: TuiAttentionNotifyInput[] = []
  const handlers = new Map<
    Event["type"],
    ((event: Event, metadata: { directory: string; workspace: string | undefined }) => void)[]
  >()
  const permissions: Record<string, PermissionRequest[]> = {}
  const questions: Record<string, QuestionRequest[]> = {}
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
        on: <Type extends Event["type"]>(
          type: Type,
          handler: (
            event: Extract<Event, { type: Type }>,
            metadata: { directory: string; workspace: string | undefined },
          ) => void,
        ) => {
          const list = handlers.get(type) ?? []
          const wrapped = handler as (
            event: Event,
            metadata: { directory: string; workspace: string | undefined },
          ) => void
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
          permission: (sessionID: string) => permissions[sessionID] ?? [],
          question: (sessionID: string) => questions[sessionID] ?? [],
        },
      },
    }),
    undefined,
    {} as never,
  )

  return {
    notifications,
    emit(event: Event, metadata = { directory: "/workspace", workspace: undefined as string | undefined }) {
      if (event.type === "permission.asked" && !input.auto) {
        permissions[event.properties.sessionID] = [
          ...(permissions[event.properties.sessionID] ?? []).filter((item) => item.id !== event.properties.id),
          event.properties,
        ]
      }
      if (event.type === "permission.replied") {
        permissions[event.properties.sessionID] = (permissions[event.properties.sessionID] ?? []).filter(
          (item) => item.id !== event.properties.requestID,
        )
      }
      if (event.type === "question.asked") {
        questions[event.properties.sessionID] = [
          ...(questions[event.properties.sessionID] ?? []).filter((item) => item.id !== event.properties.id),
          event.properties,
        ]
      }
      if (event.type === "question.replied" || event.type === "question.rejected") {
        questions[event.properties.sessionID] = (questions[event.properties.sessionID] ?? []).filter(
          (item) => item.id !== event.properties.requestID,
        )
      }
      for (const handler of handlers.get(event.type) ?? []) handler(event, metadata)
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

const questionNotification: TuiAttentionNotifyInput = {
  title: "Demo session",
  message: "Question needs input",
  notification: { when: "blurred" },
  sound: { name: "question", when: "always" },
}

const permissionNotification: TuiAttentionNotifyInput = {
  title: "Demo session",
  message: "Permission needs input",
  notification: { when: "blurred" },
  sound: { name: "permission", when: "always" },
}

describe("internal notifications TUI plugin", () => {
  test("notifies for question and permission requests with blurred notifications and always-on sounds", async () => {
    const harness = await setup()

    harness.emit({ id: "event-1", type: "question.asked", properties: question("question-1") })
    harness.emit({ id: "event-2", type: "permission.asked", properties: permission("permission-1") })

    expect(harness.notifications).toEqual([questionNotification, permissionNotification])
  })

  test("dedupes pending questions and permissions until they are resolved", async () => {
    const harness = await setup()

    harness.emit({ id: "event-1", type: "question.asked", properties: question("question-1") })
    harness.emit({ id: "event-2", type: "question.asked", properties: question("question-1") })
    harness.emit({
      id: "event-3",
      type: "question.replied",
      properties: { sessionID: "session", requestID: "question-1", answers: [] },
    })
    harness.emit({ id: "event-4", type: "question.asked", properties: question("question-1") })

    harness.emit({ id: "event-5", type: "permission.asked", properties: permission("permission-1") })
    harness.emit({ id: "event-6", type: "permission.asked", properties: permission("permission-1") })
    harness.emit({
      id: "event-7",
      type: "permission.replied",
      properties: { sessionID: "session", requestID: "permission-1", reply: "once" },
    })
    harness.emit({ id: "event-8", type: "permission.asked", properties: permission("permission-1") })

    expect(harness.notifications).toEqual([
      questionNotification,
      questionNotification,
      permissionNotification,
      permissionNotification,
    ])
  })

  test("suppresses auto-approved permission requests", async () => {
    const harness = await setup({ auto: true })

    harness.emit({ id: "event-1", type: "permission.asked", properties: permission("permission-1") })

    expect(harness.notifications).toEqual([])
  })

  test("ignores events outside the session location", async () => {
    const harness = await setup()
    const foreign = { directory: "/other", workspace: undefined }

    harness.emit({ id: "event-1", type: "question.asked", properties: question("question-1") }, foreign)
    harness.emit({ id: "event-2", type: "permission.asked", properties: permission("permission-1") }, foreign)
    harness.emit(
      { id: "event-2b", type: "permission.asked", properties: permission("permission-2") },
      { directory: "/workspace", workspace: "other-workspace" },
    )
    harness.emit(
      {
        id: "event-3",
        type: "session.status",
        properties: { sessionID: "session", status: { type: "busy" } },
      },
      foreign,
    )
    harness.emit(
      {
        id: "event-4",
        type: "session.error",
        properties: { sessionID: "session", error: { name: "UnknownError", data: { message: "boom" } } },
      },
      foreign,
    )
    harness.emit(
      {
        id: "event-5",
        type: "session.status",
        properties: { sessionID: "session", status: { type: "idle" } },
      },
      foreign,
    )

    expect(harness.notifications).toEqual([])
  })

  test("notifies when an active session becomes idle and suppresses no-op idle", async () => {
    const harness = await setup()

    harness.emit({
      id: "event-1",
      type: "session.status",
      properties: { sessionID: "session", status: { type: "idle" } },
    })
    harness.emit({
      id: "event-2",
      type: "session.status",
      properties: { sessionID: "session", status: { type: "busy" } },
    })
    harness.emit({
      id: "event-3",
      type: "session.status",
      properties: { sessionID: "session", status: { type: "idle" } },
    })

    expect(harness.notifications).toEqual([
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

    harness.emit({ id: "event-1", type: "question.asked", properties: question("question-1", "subagent") })
    harness.emit({
      id: "event-2",
      type: "session.status",
      properties: { sessionID: "subagent", status: { type: "busy" } },
    })
    harness.emit({
      id: "event-3",
      type: "session.status",
      properties: { sessionID: "subagent", status: { type: "idle" } },
    })

    expect(harness.notifications).toEqual([
      {
        title: "Subagent session",
        message: "Question needs input",
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

    harness.emit({
      id: "event-1",
      type: "session.status",
      properties: { sessionID: "session", status: { type: "busy" } },
    })
    harness.emit({
      id: "event-2",
      type: "session.error",
      properties: { sessionID: "session", error: { name: "UnknownError", data: { message: "boom" } } },
    })
    harness.emit({
      id: "event-3",
      type: "session.status",
      properties: { sessionID: "session", status: { type: "idle" } },
    })

    expect(harness.notifications).toEqual([
      {
        title: "Demo session",
        message: "Session error",
        notification: { when: "blurred" },
        sound: { name: "error", when: "always" },
      },
    ])
  })

  test("special-cases aborts and model response timeouts", async () => {
    const harness = await setup()

    harness.emit({
      id: "event-1",
      type: "session.status",
      properties: { sessionID: "abort", status: { type: "busy" } },
    })
    harness.emit({
      id: "event-2",
      type: "session.error",
      properties: { sessionID: "abort", error: { name: "MessageAbortedError", data: { message: "Aborted" } } },
    })
    harness.emit({
      id: "event-3",
      type: "session.status",
      properties: { sessionID: "timeout", status: { type: "busy" } },
    })
    harness.emit({
      id: "event-4",
      type: "session.error",
      properties: { sessionID: "timeout", error: { name: "UnknownError", data: { message: "SSE read timed out" } } },
    })

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
