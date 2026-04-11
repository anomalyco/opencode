import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { GlobalBus } from "../../src/bus/global"
import { PushRelay } from "../../src/server/push-relay"

let originalFetch: typeof fetch
let fetchMock: ReturnType<typeof mock>

function emit(type: string, properties: unknown) {
  GlobalBus.emit("event", {
    payload: {
      type,
      properties,
    },
  })
}

function created(sessionID: string, parentID?: string) {
  emit("session.created", {
    sessionID,
    info: {
      id: sessionID,
      parentID,
    },
  })
}

async function waitForCalls(count: number, timeoutMs = 500) {
  const iterations = Math.ceil(timeoutMs / 10)
  for (let i = 0; i < iterations; i++) {
    if (fetchMock.mock.calls.length >= count) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  expect(fetchMock.mock.calls.length).toBe(count)
}

function callBody(index = 0) {
  const init = fetchMock.mock.calls[index]?.[1] as RequestInit | undefined
  if (!init?.body) return
  return JSON.parse(String(init.body)) as {
    eventType: "complete" | "permission" | "error"
    sessionID: string
  }
}

beforeEach(() => {
  originalFetch = globalThis.fetch
  fetchMock = mock(() => Promise.resolve(new Response("ok", { status: 200 })))
  globalThis.fetch = fetchMock as unknown as typeof fetch

  PushRelay.start({
    relayURL: "https://relay.example.com",
    relaySecret: "test-secret",
    hostname: "127.0.0.1",
    port: 4096,
    permissionDelayMs: 200,
  })
})

afterEach(() => {
  PushRelay.stop()
  globalThis.fetch = originalFetch
})

describe("push relay event mapping", () => {
  test("relays completion from session.status idle", async () => {
    emit("session.status", {
      sessionID: "ses_status_idle",
      status: { type: "idle" },
    })

    await waitForCalls(1)
    expect(callBody()?.eventType).toBe("complete")
  })

  test("ignores deprecated session.idle events", async () => {
    emit("session.idle", {
      sessionID: "ses_deprecated_idle",
    })

    await new Promise((resolve) => setTimeout(resolve, 40))
    expect(fetchMock.mock.calls.length).toBe(0)
  })

  test("ignores non-actionable session errors", async () => {
    emit("session.error", {
      sessionID: "ses_aborted",
      error: { name: "MessageAbortedError", data: { message: "Aborted" } },
    })
    emit("session.error", {
      sessionID: "ses_overflow",
      error: { name: "ContextOverflowError", data: { message: "Too long" } },
    })

    await new Promise((resolve) => setTimeout(resolve, 40))
    expect(fetchMock.mock.calls.length).toBe(0)
  })

  test("relays actionable session errors", async () => {
    emit("session.error", {
      sessionID: "ses_unknown_error",
      error: { name: "UnknownError", data: { message: "boom" } },
    })

    await waitForCalls(1)
    expect(callBody()?.eventType).toBe("error")
  })

  test("relays permission prompts after delay when not replied", async () => {
    emit("permission.asked", {
      id: "per_unreplied",
      sessionID: "ses_permission",
    })

    // should NOT fire immediately
    await new Promise((resolve) => setTimeout(resolve, 40))
    expect(fetchMock.mock.calls.length).toBe(0)

    // should fire after the permission delay (200ms in tests)
    await waitForCalls(1, 500)
    expect(callBody()?.eventType).toBe("permission")
  })

  test("cancels permission notification when replied before delay", async () => {
    emit("permission.asked", {
      id: "per_auto_approved",
      sessionID: "ses_auto",
    })

    // reply arrives quickly (simulating web UI auto-approve)
    await new Promise((resolve) => setTimeout(resolve, 5))
    emit("permission.replied", {
      sessionID: "ses_auto",
      requestID: "per_auto_approved",
      reply: "once",
    })

    // wait past the delay window — notification should never fire
    await new Promise((resolve) => setTimeout(resolve, 500))
    expect(fetchMock.mock.calls.length).toBe(0)
  })

  test("cancels repeated permission updates when replied", async () => {
    emit("permission.asked", {
      id: "per_updated",
      sessionID: "ses_updated",
    })

    await new Promise((resolve) => setTimeout(resolve, 100))

    emit("permission.asked", {
      id: "per_updated",
      sessionID: "ses_updated",
      permission: "updated",
    })

    await new Promise((resolve) => setTimeout(resolve, 5))
    emit("permission.replied", {
      sessionID: "ses_updated",
      requestID: "per_updated",
      reply: "once",
    })

    await new Promise((resolve) => setTimeout(resolve, 500))
    expect(fetchMock.mock.calls.length).toBe(0)
  })

  test("does not relay subagent completion events", async () => {
    created("ses_root")
    created("ses_subagent", "ses_root")

    emit("session.status", {
      sessionID: "ses_subagent",
      status: { type: "idle" },
    })

    await new Promise((resolve) => setTimeout(resolve, 40))
    expect(fetchMock.mock.calls.length).toBe(0)
  })

  test("does not relay subagent errors", async () => {
    created("ses_root")
    created("ses_subagent", "ses_root")

    emit("session.error", {
      sessionID: "ses_subagent",
      error: { name: "UnknownError", data: { message: "boom" } },
    })

    await new Promise((resolve) => setTimeout(resolve, 40))
    expect(fetchMock.mock.calls.length).toBe(0)
  })

  test("relays subagent permission prompts to parent session", async () => {
    created("ses_root")
    created("ses_subagent", "ses_root")

    emit("permission.asked", {
      id: "per_subagent_perm",
      sessionID: "ses_subagent",
    })

    await waitForCalls(1, 500)
    expect(callBody()?.eventType).toBe("permission")
    expect(callBody()?.sessionID).toBe("ses_root")
  })
})
