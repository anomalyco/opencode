import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import type { ServerConnectionStatus } from "@/runtime/server/client"
import { createSessionMessageHandoffs } from "@/session/handoff"
import { HANDOFF_ECHO_TIMEOUT_MS, HANDOFF_SEND_TIMEOUT_MS, type SessionMessageHandoff } from "@/session/handoff-machine"

// The sync's loaders settle over a few microtasks.
const settle = () =>
  Array.from({ length: 10 }).reduce<Promise<void>>((previous) => previous.then(() => undefined), Promise.resolve())

const handoff = (id: string): SessionMessageHandoff => ({
  message: { id, type: "user", text: id, time: { created: 1 } },
  selection: { agent: "build", model: { id: "model", providerID: "provider" } },
})

function setup() {
  const calls: string[] = []
  const listeners = new Map<string, (event: { data: { sessionID: string; inboxID: string } }) => void>()
  const [status, setStatus] = createSignal<ServerConnectionStatus>("connected")
  const record = (name: string) => (id: string) => void calls.push(`${name}:${id}`)
  const load = (name: string) => async (id: string) => void calls.push(`${name}:${id}`)

  const sdk = {
    connection: { status, attempt: () => 0, error: () => undefined },
    event: {
      // SAFETY: the driver subscribes by type and reads only the fields its events carry.
      on: ((type: string, handler: (event: { data: { sessionID: string; inboxID: string } }) => void) => {
        listeners.set(type, handler)

        return () => listeners.delete(type)
      }) as never,
      listen: () => () => undefined,
      location: () => {
        throw new Error("unused")
      },
    },
  }

  const data = {
    session: {
      invalidate: record("invalidate"),
      sync: load("sync"),
      pending: { invalidate: record("pending.invalidate"), sync: load("pending.sync") },
      message: { invalidate: record("message.invalidate"), sync: load("message.sync") },
    },
  }

  // SAFETY: the driver reads only these members of the data layer.
  const owned = createRoot((dispose) => ({
    handoffs: createSessionMessageHandoffs({ sdk, data: data as never }),
    dispose,
  }))

  return { ...owned, calls, listeners, setStatus }
}

describe("createSessionMessageHandoffs", () => {
  beforeEach(() => jest.useFakeTimers())

  afterEach(() => {
    jest.clearAllTimers()
    jest.useRealTimers()
  })

  test("a missed echo reloads the session, then the timeline stops showing the prompt", async () => {
    const owner = setup()
    const session = owner.handoffs.forSession("ses_1")

    session.set(handoff("msg_1"))
    session.settle("msg_1")
    expect(owner.handoffs.get("ses_1")?.message.id).toBe("msg_1")

    jest.advanceTimersByTime(HANDOFF_ECHO_TIMEOUT_MS)
    expect(owner.calls).toEqual([
      "invalidate:ses_1",
      "pending.invalidate:ses_1",
      "message.invalidate:ses_1",
      "sync:ses_1",
      "pending.sync:ses_1",
      "message.sync:ses_1",
    ])
    await settle()
    expect(owner.handoffs.get("ses_1")).toBeUndefined()
    owner.dispose()
  })

  test("a reconnect syncs a prompt whose echo the dropped stream may have lost", async () => {
    const owner = setup()
    const session = owner.handoffs.forSession("ses_1")

    session.set(handoff("msg_1"))
    owner.setStatus("reconnecting")
    session.settle("msg_1")
    expect(owner.calls).toEqual([])

    owner.setStatus("connected")
    expect(owner.calls).toContain("message.sync:ses_1")
    await settle()
    expect(owner.handoffs.get("ses_1")).toBeUndefined()
    owner.dispose()
  })

  test("the echo ends the handoff, and disposal stops listening and syncs nothing later", () => {
    const owner = setup()

    owner.handoffs.forSession("ses_1").set(handoff("msg_1"))
    owner.listeners.get("session.inbox.enqueued")?.({ data: { sessionID: "ses_1", inboxID: "msg_1" } })
    expect(owner.handoffs.get("ses_1")).toBeUndefined()

    owner.handoffs.forSession("ses_2").set(handoff("msg_2"))
    owner.dispose()
    jest.advanceTimersByTime(HANDOFF_SEND_TIMEOUT_MS)

    expect(owner.listeners.size).toBe(0)
    expect(owner.calls).toEqual([])
    expect(owner.handoffs.get("ses_2")).toBeUndefined()
  })
})
