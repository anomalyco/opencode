import { expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createData, type CreateDataInput } from "../src/solid"
import { OpenCode, type OpenCodeEvent } from "../src/promise"

const sessionID = "ses_pending"

function fixture() {
  const listeners = new Set<Parameters<CreateDataInput["event"]["listen"]>[0]>()
  const api = OpenCode.make({
    baseUrl: "http://opencode.local",
    fetch: async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init)
      return request.method === "GET" ? Response.json({ data: [] }) : Response.json({ data: {} })
    },
  })
  let seq = 0
  return createRoot((dispose) => {
    const data = createData({
      api: () => api,
      directory: "/project",
      event: {
        on: () => () => {},
        listen(handler) {
          listeners.add(handler)
          return () => listeners.delete(handler)
        },
      },
    })
    const emit = (type: string, payload: Record<string, unknown> = {}) => {
      seq++
      const event = {
        id: `evt_${seq}`,
        type,
        created: seq,
        durable: { aggregateID: sessionID, seq, version: 1 },
        data: { sessionID, ...payload },
      } as OpenCodeEvent
      listeners.forEach((listener) => listener({ name: event.type, details: event }))
    }
    return {
      data,
      dispose,
      enqueue: (id: string, delivery: "steer" | "queue" = "steer") =>
        emit("session.inbox.enqueued", { inboxID: id, item: { type: "user", delivery, payload: { text: id } } }),
      deliver: (id: string) => emit("session.inbox.delivered", { inboxID: id }),
      started: () => emit("session.execution.started"),
      settled: (outcome: "succeeded" | "failed" | "interrupted") =>
        emit(
          `session.execution.${outcome}`,
          outcome === "failed"
            ? { error: { type: "provider", message: "Provider unavailable" } }
            : outcome === "interrupted"
              ? { reason: "user" }
              : {},
        ),
      move: (id: string, delivery: "steer" | "queue") =>
        emit("session.inbox.delivery.changed", { inboxID: id, delivery }),
      waiting: (id: string) => data.session.pending.waiting(sessionID, id),
    }
  })
}

test("an idle send never looks like a waiting steer from optimistic admission through delivery", async () => {
  const setup = fixture()
  try {
    // The composer marks the Session running in the same task as optimistic admission.
    const sending = setup.data.session.prompt({ sessionID, id: "msg_first", text: "first" })
    expect(setup.waiting("msg_first")).toBe(false)
    setup.data.session.setStatus(sessionID, "running")
    expect(setup.waiting("msg_first")).toBe(false)
    await sending
    setup.enqueue("msg_first")
    expect(setup.waiting("msg_first")).toBe(false)
    setup.started()
    expect(setup.waiting("msg_first")).toBe(false)
    setup.deliver("msg_first")
    expect(setup.waiting("msg_first")).toBe(false)
    expect(setup.data.session.message.get(sessionID, "msg_first")?.type).toBe("user")
  } finally {
    setup.dispose()
  }
})

test("a steer sent after the execution delivered input waits, and follows delivery changes", () => {
  const setup = fixture()
  try {
    setup.enqueue("msg_first")
    setup.started()
    setup.deliver("msg_first")
    setup.enqueue("msg_steer")
    expect(setup.waiting("msg_steer")).toBe(true)
    setup.move("msg_steer", "queue")
    expect(setup.waiting("msg_steer")).toBe(false)
    setup.move("msg_steer", "steer")
    expect(setup.waiting("msg_steer")).toBe(true)
    setup.deliver("msg_steer")
    expect(setup.waiting("msg_steer")).toBe(false)
  } finally {
    setup.dispose()
  }
})

test("rapid follow-ups join the starting execution until it delivers without them", () => {
  const setup = fixture()
  try {
    setup.enqueue("msg_first")
    setup.started()
    setup.enqueue("msg_second")
    // The idle boundary promotes every pending steer, so both are about to run.
    expect(setup.waiting("msg_first")).toBe(false)
    expect(setup.waiting("msg_second")).toBe(false)
    // Promotion happened before the second admission landed; it now steers the running turn.
    setup.deliver("msg_first")
    expect(setup.waiting("msg_second")).toBe(true)
  } finally {
    setup.dispose()
  }
})

test.each(["failed", "interrupted"] as const)("an undelivered steer waits after execution %s", (outcome) => {
  const setup = fixture()
  try {
    setup.enqueue("msg_first")
    setup.started()
    expect(setup.waiting("msg_first")).toBe(false)
    setup.settled(outcome)
    expect(setup.data.session.status(sessionID)).toBe("idle")
    expect(setup.waiting("msg_first")).toBe(true)
    // The next execution promotes it along with any new steers.
    setup.enqueue("msg_retry")
    setup.started()
    expect(setup.waiting("msg_first")).toBe(false)
    expect(setup.waiting("msg_retry")).toBe(false)
  } finally {
    setup.dispose()
  }
})

test("a later execution starts fresh after an earlier turn delivered input", () => {
  const setup = fixture()
  try {
    setup.enqueue("msg_first")
    setup.started()
    setup.deliver("msg_first")
    setup.settled("succeeded")
    setup.enqueue("msg_next")
    setup.started()
    expect(setup.waiting("msg_next")).toBe(false)
  } finally {
    setup.dispose()
  }
})

test("a remote idle prompt is presumed to start execution", () => {
  const setup = fixture()
  try {
    setup.enqueue("msg_remote")
    expect(setup.waiting("msg_remote")).toBe(false)
    setup.started()
    expect(setup.waiting("msg_remote")).toBe(false)
  } finally {
    setup.dispose()
  }
})

test("an idle send after a failed execution starts fresh while the leftover steer still waits", () => {
  const setup = fixture()
  try {
    setup.enqueue("msg_leftover")
    setup.started()
    setup.settled("failed")
    setup.enqueue("msg_next")
    expect(setup.waiting("msg_leftover")).toBe(true)
    expect(setup.waiting("msg_next")).toBe(false)
  } finally {
    setup.dispose()
  }
})
