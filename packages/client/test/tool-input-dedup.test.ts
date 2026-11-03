import { expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createData, type CreateDataInput } from "../src/solid"
import { OpenCode, type OpenCodeEvent } from "../src/promise"

// #61427: a re-delivered session.tool.input.started (same event id, at-least-
// once delivery per #61401) must not append a second tool part with the same
// tool id — the duplicate would stay "streaming" forever next to the real one.
test("never appends a duplicate tool part on a re-delivered session.tool.input.started", async () => {
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
            durable: { aggregateID: "ses_tool", seq, version: 1 },
            data,
          } as OpenCodeEvent,
        }),
      )
    }
    const base = { sessionID: "ses_tool", assistantMessageID: "msg_assistant" }
    const toolParts = () =>
      (setup.data.session.message.get("ses_tool", "msg_assistant")?.content ?? []).filter(
        (part) => part.type === "tool",
      )

    publish("session.step.started", { ...base, agent: "build", model: { providerID: "provider", id: "model" }, started: 1 })
    publish("session.tool.input.started", { ...base, id: "call_read", name: "read" })
    publish("session.tool.input.delta", { ...base, id: "call_read", delta: "abc" })

    // Re-delivered started (same event id) must not add a second tool part.
    publish("session.tool.input.started", { ...base, id: "call_read", name: "read" }, "evt_2")
    const parts = toolParts()
    expect(parts.length).toBe(1)
    expect(parts[0]).toMatchObject({ type: "tool", id: "call_read" })
  } finally {
    setup.dispose()
  }
})

async function wait(check: () => boolean) {
  const started = Date.now()
  while (!check()) {
    if (Date.now() - started > 2_000) throw new Error("Timed out waiting for condition")
    await Bun.sleep(10)
  }
}
