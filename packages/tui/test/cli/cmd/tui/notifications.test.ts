import { describe, expect, test } from "bun:test"
import Notifications from "../../../../src/feature-plugins/system/notifications"
import type { OpenCodeEvent, PermissionAsked } from "@opencode-ai/client"
import type { AttentionNotifyOptions, Context, Route, ToastOptions } from "@opencode-ai/plugin/tui/context"

type Session = { id: string; title: string; parentID?: string }

async function setup(route: Route = { type: "session", sessionID: "session" }) {
  const notifications: AttentionNotifyOptions[] = []
  const toasts: ToastOptions[] = []
  const handlers = new Map<OpenCodeEvent["type"], ((event: OpenCodeEvent) => void)[]>()
  const session = (id: string, title: string, parentID?: string): Session => ({
    id,
    title,
    ...(parentID && { parentID }),
  })
  const sessions: Record<string, Session> = {
    session: session("session", "Demo session"),
    subagent: session("subagent", "Subagent session", "session"),
    abort: session("abort", "Abort session"),
    timeout: session("timeout", "Timeout session"),
  }

  await Notifications.setup({
    ui: {
      router: { current: () => route },
      toast: { show: (toast: ToastOptions) => toasts.push(toast) },
    },
    attention: {
      async notify(input: AttentionNotifyOptions) {
        notifications.push(input)
        return { ok: true, notification: true, sound: true }
      },
    },
    data: {
      on: <Type extends OpenCodeEvent["type"]>(
        type: Type,
        handler: (event: Extract<OpenCodeEvent, { type: Type }>) => void,
      ) => {
        const list = handlers.get(type) ?? []
        const wrapped = handler as (event: OpenCodeEvent) => void
        list.push(wrapped)
        handlers.set(type, list)
        return () => {
          handlers.set(
            type,
            (handlers.get(type) ?? []).filter((item) => item !== wrapped),
          )
        }
      },
      session: {
        get: (sessionID: string) => sessions[sessionID],
        status: () => "running" as const,
      },
    },
  } as unknown as Context)

  return {
    notifications,
    toasts,
    emit(event: OpenCodeEvent) {
      for (const handler of handlers.get(event.type) ?? []) handler(event)
    },
  }
}

function form(id: string, sessionID = "session"): Extract<OpenCodeEvent, { type: "form.created" }>["data"]["form"] {
  return {
    id,
    sessionID,
    title: "Input requested",
    fields: [{ key: "authorization", type: "external", url: "https://example.com" }],
  }
}

function permission(id: string, sessionID = "session"): PermissionAsked["data"] {
  return {
    id,
    sessionID,
    action: "edit",
    resources: [],
    metadata: {},
    save: [],
  }
}

function durable(sessionID: string): { aggregateID: string; seq: number; version: 1 } {
  return { aggregateID: sessionID, seq: 0, version: 1 }
}

function executionStarted(id: string, sessionID = "session"): OpenCodeEvent {
  return {
    id,
    created: 0,
    type: "session.execution.started",
    durable: durable(sessionID),
    data: { sessionID },
  }
}

function executionSucceeded(id: string, sessionID = "session"): OpenCodeEvent {
  return {
    id,
    created: 0,
    type: "session.execution.succeeded",
    durable: durable(sessionID),
    data: { sessionID },
  }
}

function executionFailed(id: string, sessionID = "session"): OpenCodeEvent {
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

const formNotification: AttentionNotifyOptions = {
  title: "Input requested",
  message: "Input needs response",
  notification: { when: "blurred" },
  sound: { name: "question", when: "always" },
}

const titledFormNotification: AttentionNotifyOptions = {
  ...formNotification,
  title: "Confirm deployment",
}

const globalFormNotification: AttentionNotifyOptions = {
  ...formNotification,
  title: "demo-mcp is requesting input",
}

const permissionNotification: AttentionNotifyOptions = {
  title: "Demo session",
  message: "Permission needs input",
  notification: { when: "blurred" },
  sound: { name: "permission", when: "always" },
}

describe("internal notifications TUI plugin", () => {
  test("shows execution failures in the viewed session without needing an assistant message", async () => {
    const harness = await setup()
    harness.emit(executionStarted("started"))
    harness.emit(executionFailed("failed"))
    harness.emit(executionFailed("duplicate"))
    expect(harness.toasts).toEqual([{ title: "Session failed", message: "boom", variant: "error" }])
    harness.emit(executionStarted("retry"))
    harness.emit(executionFailed("failed-again"))
    expect(harness.toasts).toHaveLength(2)
  })

  test.each<Route>([{ type: "home" }, { type: "session", sessionID: "other" }])(
    "keeps other sessions' failures out of the current composer (%j)",
    async (route) => {
      const harness = await setup(route)
      harness.emit(executionFailed("failed"))
      expect(harness.toasts).toEqual([])
      expect(harness.notifications).toHaveLength(1)
    },
  )

  test("notifies for form and permission requests with blurred notifications and always-on sounds", async () => {
    const harness = await setup()

    harness.emit({
      id: "event-1",
      created: 0,
      type: "form.created",
      data: { form: { ...form("form-1"), title: "Confirm deployment" } },
    })
    harness.emit({ id: "event-3", created: 0, type: "permission.asked", data: permission("permission-1") })

    expect(harness.notifications).toEqual([titledFormNotification, permissionNotification])
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

  test("dedupes pending forms and permissions until they are resolved", async () => {
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
})
