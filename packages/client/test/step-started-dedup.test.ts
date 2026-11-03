import { expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createData, type CreateDataInput } from "../src/solid"
import { OpenCode, type OpenCodeEvent } from "../src/promise"

test("never regresses a settled assistant message on a re-delivered session.step.started", () => {
  const listeners = new Set<Parameters<CreateDataInput["event"]["listen"]>[0]>()
  const api = OpenCode.make({
    baseUrl: "http://opencode.local",
    fetch: async () => Response.json({ data: [], cursor: {} }),
  })
  const setup = createRoot((dispose) => ({
    data: createData({
      api: () => api,
      directory: "/project",
      event: {
        on: () => () => {},
        listen(handler) {
          listeners.add(handler)
          return () => listeners.delete(handler)
        },
      },
    }),
    dispose,
  }))
  try {
    let seq = 0
    const publish = (type: string, data: object, id?: string) => {
      const eventID = id ?? `evt_${seq + 1}`
      if (!id) seq += 1
      listeners.forEach((listener) =>
        listener({
          name: type,
          details: {
            id: eventID,
            created: seq,
            type,
            durable: { aggregateID: "ses_step", seq, version: 1 },
            data,
          } as OpenCodeEvent,
        }),
      )
    }
    const base = { sessionID: "ses_step", assistantMessageID: "msg_assistant" }
    const model = { providerID: "provider", id: "model" }
    const settled = () => setup.data.session.message.get("ses_step", "msg_assistant")

    publish("session.step.started", { ...base, agent: "build", model, started: 1 })
    publish(
      "session.step.ended",
      { ...base, finish: "stop", cost: 1, tokens: { input: 1, output: 2, reasoning: 0, cache: { read: 0, write: 0 } } },
    )
    expect(settled()?.time.completed).toBe(2)

    // A re-delivered step.started (same event id) must not regress the
    // settled message.
    publish("session.step.started", { ...base, agent: "build", model, started: 3 }, "evt_1")
    expect(settled()?.finish).toBe("stop")
    expect(settled()?.time.completed).not.toBeUndefined()
  } finally {
    setup.dispose()
  }
})
