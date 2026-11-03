import { expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createData, type CreateDataInput } from "../src/solid"
import { OpenCode, type OpenCodeEvent } from "../src/promise"

// #61426: the conversion path completes the running compaction row in place
// (keeping the row id from the started event) and never registers the
// settlement event's own id, so a re-delivered session.compaction.ended falls
// to the append path and adds a duplicate row the server-side projector would
// never produce (apply-once).
test("never appends a duplicate compaction row on a re-delivered session.compaction.ended", async () => {
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
            durable: { aggregateID: "ses_compact", seq, version: 1 },
            data,
          } as OpenCodeEvent,
        }),
      )
    }
    const settled = () =>
      setup.data.session.message
        .list("ses_compact")
        .filter((part) => part.type === "compaction")

    publish("session.compaction.started", { sessionID: "ses_compact", inputID: "msg_x" })
    publish("session.compaction.ended", { sessionID: "ses_compact", text: "Summary", cost: 1, tokens: { input: 1, output: 2, reasoning: 0, cache: { read: 0, write: 0 } } })

    // A re-delivered ended (same event id) must hit the append guard, not add
    // a phantom row.
    publish(
      "session.compaction.ended",
      { sessionID: "ses_compact", text: "Summary", cost: 1, tokens: { input: 1, output: 2, reasoning: 0, cache: { read: 0, write: 0 } } },
      "evt_2",
    )
    expect(settled()?.length).toBe(1)
    // ...and must not mark a newer running row with its own stale summary.
    publish("session.compaction.started", { sessionID: "ses_compact", inputID: "msg_y" })
    publish(
      "session.compaction.ended",
      { sessionID: "ses_compact", text: "Stale summary", cost: 2, tokens: { input: 3, output: 4, reasoning: 0, cache: { read: 0, write: 0 } } },
      "evt_2",
    )
    const newest = settled()?.at(-1)
    expect(newest).toMatchObject({ id: "msg_y", status: "running", summary: "" })

    // The failed path (no inputID) gets the same re-delivery guard.
    publish("session.compaction.started", { sessionID: "ses_compact" })
    publish("session.compaction.failed", { sessionID: "ses_compact", reason: "oops", error: { message: "boom" } })
    publish("session.compaction.failed", { sessionID: "ses_compact", reason: "oops", error: { message: "boom" } }, "evt_5")
    expect(settled()?.filter((row) => row.status === "failed").length).toBe(1)
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
