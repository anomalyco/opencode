// Proves the generated-client wiring the engine laws take for granted: the
// adapter in src/solid/engine-data.ts must speak the real snapshot/log/prompt
// API shapes and translate the generated typed errors into the engine's own
// (the SeqUnavailable path is what laws 7-9 in test/sync-engine-laws.test.ts
// rely on in production).
import { describe, expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { Engine } from "../src/solid/engine/engine"
import { SNAPSHOT_RECENT, createEngineData, createEngineTransport } from "../src/solid/engine-data"
import { FakeSessionServer } from "./fixture/sync-engine"

describe("engine data transport", () => {
  test("uses snapshot and ephemeral follow log contracts", async () => {
    const server = new FakeSessionServer("ses_transport")
    const calls: Array<unknown> = []
    const transport = createEngineTransport(() => ({
      async snapshot(input) {
        calls.push(input)
        // The generated client returns mutable arrays; the fixture's snapshot
        // is readonly, so mirror the wire shape here.
        const value = server.snapshotValue()
        return { ...value, children: [...value.children], inbox: [...value.inbox], messages: [...value.messages] }
      },
      async *log(input) {
        calls.push(input)
        yield { type: "log.synced" as const, aggregateID: input.sessionID, seq: 0 }
      },
      async prompt() {
        throw new Error("unused")
      },
    }))

    expect(await transport.snapshot(server.sessionID)).toEqual(server.snapshotValue())
    const items: Array<Engine.SessionStreamItem> = []
    for await (const item of transport.stream(server.sessionID, 0)) items.push(item)

    expect(items).toEqual([{ type: "log.synced", aggregateID: server.sessionID, seq: 0 }])
    expect(calls).toEqual([
      { sessionID: server.sessionID, recent: SNAPSHOT_RECENT },
      { sessionID: server.sessionID, after: 0, follow: true, ephemeral: true },
    ])
  })

  test("preserves the prompt request and client-minted ID", async () => {
    const requests: Array<unknown> = []
    const transport = createEngineTransport(() => ({
      async snapshot() {
        throw new Error("unused")
      },
      async *log() {
        throw new Error("unused")
      },
      async prompt(input) {
        requests.push(input)
        return {
          id: input.id!,
          sessionID: input.sessionID,
          timeCreated: 1,
          type: "user",
          payload: { text: input.text },
          delivery: input.delivery ?? "steer",
        }
      },
    }))

    await transport.submit({
      id: "msg_client",
      sessionID: "ses_submit",
      request: {
        text: "hello",
        files: [{ uri: "file:///tmp/example.txt", name: "example.txt" }],
        delivery: "queue",
      },
    })

    expect(requests).toEqual([
      {
        id: "msg_client",
        sessionID: "ses_submit",
        text: "hello",
        files: [{ uri: "file:///tmp/example.txt", name: "example.txt" }],
        delivery: "queue",
      },
    ])
  })

  test("a failed initial attach does not poison the session cache", async () => {
    const server = new FakeSessionServer("ses_attach_retry")
    server.faults.loseSnapshots = 1
    const api = {
      session: {
        snapshot: (input: { sessionID: string }) => server.snapshot(input.sessionID),
        log: (input: { sessionID: string; after: number }) => server.stream(input.sessionID, input.after),
        prompt: () => Promise.reject(new Error("unused")),
      },
    }
    await createRoot(async (dispose) => {
      const data = createEngineData({
        api: () => api as never,
        directory: "/workspace",
        event: { on: () => () => {}, listen: () => () => {} },
      })

      // The server is down when the session first opens…
      await expect(data.session.sync(server.sessionID)).rejects.toThrow("snapshot lost")
      // …and the next sync attaches with a fresh engine instead of a cached rejection.
      await data.session.sync(server.sessionID)

      expect(data.session.get(server.sessionID)?.id).toBe(server.sessionID)
      dispose()
    })
  })

  test("translates generated typed failures", async () => {
    // These literals mirror the generated client's error DTO shapes
    // (SeqUnavailableError / InvalidRequestError in src/promise/generated);
    // they must change if the generated error schema does.
    const transport = createEngineTransport(() => ({
      async snapshot() {
        throw new Error("unused")
      },
      async *log() {
        throw { _tag: "SeqUnavailableError", sessionID: "ses_errors", after: 2, head: 1, message: "gone" }
      },
      async prompt() {
        throw { _tag: "InvalidRequestError", message: "invalid" }
      },
    }))

    const streamError = await collectError(transport.stream("ses_errors", 2))
    expect(streamError).toBeInstanceOf(Engine.SeqUnavailable)
    await expect(
      transport.submit({ id: "msg_client", sessionID: "ses_errors", request: { text: "invalid" } }),
    ).rejects.toEqual(new Engine.SubmitRejected("invalid"))
  })
})

async function collectError(iterable: AsyncIterable<unknown>) {
  try {
    for await (const item of iterable) void item
  } catch (error) {
    return error
  }
  throw new Error("stream did not fail")
}
