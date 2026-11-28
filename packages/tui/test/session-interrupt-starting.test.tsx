import { expect, test } from "bun:test"
import { createAppFixture } from "./fixture/app"
import { directory, json } from "./fixture/tui-client"

const session = {
  id: "ses_interrupt_starting",
  title: "Interrupt starting",
  projectID: "proj_test",
  location: { directory },
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 0, updated: 0 },
}
const pending = {
  id: "msg_starting",
  sessionID: session.id,
  type: "user",
  delivery: "steer",
  payload: { text: "Reword this prompt" },
  time: { created: 1 },
}
const shown = (frame: string) => frame.split(pending.payload.text).length - 1

async function setup(input: { cancelled: boolean }) {
  const calls: string[] = []
  const firstInterrupt = Promise.withResolvers<void>()
  const cancelled = Promise.withResolvers<void>()
  const committed = Promise.withResolvers<void>()
  const secondInterrupt = Promise.withResolvers<void>()
  let started = false
  let promoted = false
  let app: Awaited<ReturnType<typeof createAppFixture>>

  app = await createAppFixture({
    width: 100,
    height: 30,
    config: { animations: false, tabs: { enabled: false } },
    args: { sessionID: session.id },
    fetch: async (url, request) => {
      if (url.pathname === "/api/session") return json({ data: [session], cursor: {} })
      if (url.pathname === "/api/session/active")
        return json({ data: started ? { [session.id]: { type: "running" } } : {} })
      if (url.pathname === `/api/session/${session.id}`) return json({ data: session })
      if (url.pathname === `/api/session/${session.id}/inbox`) return json({ data: promoted ? [] : [pending] })
      if (url.pathname === `/api/session/${session.id}/permission`) return json({ data: [] })
      if (url.pathname === `/api/session/${session.id}/message`)
        return json({
          data: promoted
            ? [{ id: pending.id, type: "user", text: pending.payload.text, time: { created: pending.time.created } }]
            : [],
          cursor: {},
        })
      if (url.pathname === `/api/experimental/session/${session.id}/wait`) {
        calls.push("wait")
        return new Response(null, { status: 204 })
      }
      if (url.pathname === `/api/session/${session.id}/revert/stage`) {
        calls.push("revert.stage")
        return json({ data: session })
      }
      if (url.pathname === `/api/session/${session.id}/revert/commit`) {
        calls.push("revert.commit")
        committed.resolve()
        queueMicrotask(() =>
          app.events.emit({
            id: "evt_reverted",
            created: 5,
            type: "session.revert.committed",
            durable: { aggregateID: session.id, seq: 4, version: 1 },
            data: { sessionID: session.id, to: pending.id },
          }),
        )
        return new Response(null, { status: 204 })
      }
      if (url.pathname === `/api/session/${session.id}/interrupt` && request.method === "POST") {
        calls.push(`interrupt resume=${url.searchParams.get("resume")}`)
        if (started) secondInterrupt.resolve()
        else firstInterrupt.resolve()
        return json({ interrupted: started })
      }
      if (url.pathname === `/api/session/${session.id}/inbox/${pending.id}` && request.method === "DELETE") {
        calls.push("cancel")
        cancelled.resolve()
        if (input.cancelled)
          queueMicrotask(() =>
            app.events.emit({
              id: "evt_cancelled",
              created: 2,
              type: "session.inbox.cancelled",
              durable: { aggregateID: session.id, seq: 1, version: 1 },
              data: { sessionID: session.id, inboxID: pending.id },
            }),
          )
        return new Response(null, { status: 204 })
      }
      return undefined
    },
  })

  return {
    app,
    calls,
    firstInterrupt: firstInterrupt.promise,
    cancelled: cancelled.promise,
    committed: committed.promise,
    secondInterrupt: secondInterrupt.promise,
    start() {
      started = true
      promoted = true
      app.events.emit({
        id: "evt_delivered",
        created: 3,
        type: "session.inbox.delivered",
        durable: { aggregateID: session.id, seq: 2, version: 1 },
        data: { sessionID: session.id, inboxID: pending.id },
      })
      app.events.emit({
        id: "evt_started",
        created: 4,
        type: "session.execution.started",
        durable: { aggregateID: session.id, seq: 3, version: 1 },
        data: { sessionID: session.id },
      })
    },
  }
}

test("one Esc cancels a starting prompt and puts its text back", async () => {
  const h = await setup({ cancelled: true })
  try {
    await h.app.ready
    await h.app.waitForFrame((frame) => frame.includes("esc cancel"))
    h.app.mockInput.pressEscape()
    await h.firstInterrupt
    await h.cancelled
    expect(h.calls).toEqual(["interrupt resume=false", "cancel"])
    await h.app.waitForFrame((frame) => !frame.includes("esc cancel") && shown(frame) === 1)
  } finally {
    await h.app[Symbol.asyncDispose]()
  }
}, 20000)

test("a promoted prompt is taken back when the inbox cancel does not land", async () => {
  const h = await setup({ cancelled: false })
  try {
    await h.app.ready
    await h.app.waitForFrame((frame) => frame.includes("esc cancel"))
    h.app.mockInput.pressEscape()
    await h.firstInterrupt
    await h.cancelled
    h.start()
    await h.secondInterrupt
    await h.committed
    expect(h.calls).toEqual([
      "interrupt resume=false",
      "cancel",
      "interrupt resume=false",
      "wait",
      "revert.stage",
      "revert.commit",
    ])
  } finally {
    await h.app[Symbol.asyncDispose]()
  }
}, 20000)
