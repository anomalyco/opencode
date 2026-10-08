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
      status: (id: string) => data.session.pending.status(sessionID, id),
    }
  })
}

test("an idle send is starting from optimistic admission until delivery", async () => {
  const setup = fixture()
  try {
    // The composer marks the Session running in the same task as optimistic admission.
    const sending = setup.data.session.prompt({ sessionID, id: "msg_first", text: "first" })
    expect(setup.status("msg_first")).toBe("starting")
    setup.data.session.setStatus(sessionID, "running")
    expect(setup.status("msg_first")).toBe("starting")
    await sending
    setup.enqueue("msg_first")
    expect(setup.status("msg_first")).toBe("starting")
    setup.started()
    expect(setup.status("msg_first")).toBe("starting")
    setup.deliver("msg_first")
    expect(setup.status("msg_first")).toBeUndefined()
    expect(setup.data.session.message.get(sessionID, "msg_first")?.type).toBe("user")
  } finally {
    setup.dispose()
  }
})

test("a steer sent after the execution delivered input is steering, and follows delivery changes", () => {
  const setup = fixture()
  try {
    setup.enqueue("msg_first")
    setup.started()
    setup.deliver("msg_first")
    setup.enqueue("msg_steer")
    expect(setup.status("msg_steer")).toBe("steering")
    setup.move("msg_steer", "queue")
    expect(setup.status("msg_steer")).toBe("queued")
    setup.move("msg_steer", "steer")
    expect(setup.status("msg_steer")).toBe("steering")
    setup.deliver("msg_steer")
    expect(setup.status("msg_steer")).toBeUndefined()
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
    // The idle boundary promotes every pending steer, so both are starting.
    expect(setup.status("msg_first")).toBe("starting")
    expect(setup.status("msg_second")).toBe("starting")
    // Promotion happened before the second admission landed; it now steers the running execution.
    setup.deliver("msg_first")
    expect(setup.status("msg_second")).toBe("steering")
  } finally {
    setup.dispose()
  }
})

test.each(["failed", "interrupted"] as const)("an undelivered steer is stranded after execution %s", (outcome) => {
  const setup = fixture()
  try {
    setup.enqueue("msg_first")
    setup.started()
    expect(setup.status("msg_first")).toBe("starting")
    setup.settled(outcome)
    expect(setup.data.session.status(sessionID)).toBe("idle")
    expect(setup.status("msg_first")).toBe("stranded")
    // A new idle send starts fresh, and its execution promotes the stranded steer with it.
    setup.enqueue("msg_retry")
    expect(setup.status("msg_retry")).toBe("starting")
    expect(setup.status("msg_first")).toBe("stranded")
    setup.started()
    expect(setup.status("msg_first")).toBe("starting")
    expect(setup.status("msg_retry")).toBe("starting")
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
    expect(setup.status("msg_next")).toBe("starting")
    setup.started()
    expect(setup.status("msg_next")).toBe("starting")
  } finally {
    setup.dispose()
  }
})

test("a remote idle prompt is starting", () => {
  const setup = fixture()
  try {
    setup.enqueue("msg_remote")
    expect(setup.status("msg_remote")).toBe("starting")
    setup.started()
    expect(setup.status("msg_remote")).toBe("starting")
  } finally {
    setup.dispose()
  }
})

test("a queued prompt is queued regardless of execution state", () => {
  const setup = fixture()
  try {
    setup.enqueue("msg_queued", "queue")
    expect(setup.status("msg_queued")).toBe("queued")
    setup.started()
    expect(setup.status("msg_queued")).toBe("queued")
  } finally {
    setup.dispose()
  }
})
