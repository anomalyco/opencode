// Divergence catalog: weird states the legacy data layer (createData) can get
// into that the sync engine cannot. Each test drives the REAL legacy layer —
// or, for the retry test, its raw ID-less prompt protocol — and PASSES by
// demonstrating the bug, with a pointer to the engine law or mechanism that
// rules the same state out. If a test here starts failing, the legacy layer
// got fixed — celebrate and delete the test.
//
// Companion clean-behavior proofs: test/sync-engine-laws.test.ts.

import { describe, expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createData } from "../src/solid/data"
import type { CreateDataInput } from "../src/solid/data"
import type { OpenCodeEvent, SessionMessageInfo } from "../src/promise"
import { FakeSessionServer } from "./fixture/sync-engine"

const sessionID = "ses_legacy"
const assistantID = "msg_assistant"

describe("legacy data layer divergence catalog", () => {
  test("a dropped durable event desyncs the transcript silently and forever", async () => {
    // Server truth: the assistant message finished with text "FINAL".
    // The client misses only the `session.text.ended` event (blip mid-stream).
    const legacy = await hydrated()
    legacy.dispatch(textStarted())
    for (let index = 0; index < 5; index++) legacy.dispatch(textDelta("x"))
    // ...the `ended` event with the durable final text never arrives.

    // The transcript is stuck on accumulated deltas, disagreeing with the
    // server, and nothing in the layer can ever notice: there is no sequence
    // cursor, no gap check, no recovery path. Only a manual refetch heals it.
    expect(legacy.text()).toBe("xxxxx")
    legacy.dispose()
    // Engine: durable events carry seqs; a gap surfaces as SeqUnavailable or a
    // marker past the fold, forcing snapshot recovery (laws 7 and 8).
  })

  test("a late delta corrupts a completed message", async () => {
    // Events delivered slightly out of order: the final text lands, then a
    // straggling delta from the finished stream arrives.
    const legacy = await hydrated()
    legacy.dispatch(textStarted())
    legacy.dispatch(textDelta("Hel"))
    legacy.dispatch(textEnded("Hello"))
    legacy.dispatch(textDelta("lo"))

    // The handler appends onto whatever text part it finds — including a
    // completed one. The final message is permanently corrupted.
    expect(legacy.text()).toBe("Hellolo")
    legacy.dispose()
    // Engine: deltas are ephemeral overlay entries cleared by the durable
    // lifecycle events, and the ordered log cannot deliver a delta after its
    // own `ended` — there is no durable state for a straggler to corrupt.
  })

  test("a slow fetch rewinds the store past already-rendered live events", async () => {
    // The initial message fetch is in flight when a live prompt admission
    // arrives. The user's message renders... then the stale fetch resolves.
    let resolveFetch: ((messages: SessionMessageInfo[]) => void) | undefined
    const legacy = makeLegacy({
      list: () => new Promise<SessionMessageInfo[]>((resolve) => (resolveFetch = resolve)),
    })
    const syncing = legacy.data.session.message.sync(sessionID)
    legacy.dispatch(inboxEnqueued("msg_user"))
    expect(legacy.data.session.message.get(sessionID, "msg_user")).toBeDefined()

    resolveFetch!([]) // the fetch was served before the admission — stale
    await syncing

    // The message the user just watched appear is gone. It returns only if
    // some later event or refetch happens to bring it back.
    expect(legacy.data.session.message.get(sessionID, "msg_user")).toBeUndefined()
    legacy.dispose()
    // Engine: hydration is a seq-stamped snapshot, and a stale refresh cannot
    // move the fold behind the live log (law 10, refresh monotonicity).
  })

  test("delivered-before-enqueued leaves a phantom pending row forever", async () => {
    // Reordered delivery: the `delivered` event arrives before its `enqueued`.
    const legacy = await hydrated()
    legacy.dispatch(inboxDelivered("msg_user")) // no-op: nothing to deliver yet
    legacy.dispatch(inboxEnqueued("msg_user")) // adds the pending row

    // The delivered event was already consumed, so the row the server has
    // long since promoted sits in "pending" until a manual refetch.
    expect(legacy.data.session.pending.list(sessionID).map((item) => item.id)).toEqual(["msg_user"])
    legacy.dispose()
    // Engine: the transport is a single ordered log, so this ordering cannot
    // be observed live; a reconnect replays from the seq cursor, and any gap
    // fails the cursor check and recovers via snapshot (laws 7 and 8).
  })

  test("a retry after a lost response admits the prompt twice", async () => {
    // Both protocols drive the same server admission logic (FakeSessionServer
    // dedupes by inbox ID exactly like the real projector). The only
    // difference is who mints the ID.

    // Legacy protocol: the request carries no ID, so the server mints a fresh
    // one per attempt and cannot recognize a retry. The response to the first
    // send is lost, the user presses enter again — the transcript now has the
    // prompt twice.
    const legacyServer = new FakeSessionServer(sessionID)
    legacyServer.faults.loseResponses = 1
    let minted = 0
    const legacySend = (text: string) =>
      legacyServer.submit({ id: `msg_minted_${++minted}`, sessionID, request: { text } })
    await legacySend("hello").catch(() => {})
    await legacySend("hello")
    expect(legacyServer.admitted).toHaveLength(2)

    // Engine protocol: the retry reuses the client-minted ID and the same
    // server admits exactly once. (Law 1 proves this end-to-end through the
    // real engine retry loop; this is the raw protocol contrast.)
    const engineServer = new FakeSessionServer(sessionID)
    engineServer.faults.loseResponses = 1
    const engineSend = () => engineServer.submit({ id: "msg_client", sessionID, request: { text: "hello" } })
    await engineSend().catch(() => {})
    await engineSend()
    expect(engineServer.admitted).toEqual(["msg_client"])
  })

  test("a dropped execution event leaves an interrupted session spinning forever", async () => {
    // The user hits interrupt; the server stops the run; the terminal
    // `session.execution.interrupted` event is lost in a reconnect blip.
    const legacy = await hydrated()
    legacy.dispatch(executionStarted())

    // Status only ever changes on the terminal event (lost) or a full
    // reconnect's active-session refetch — until one of those happens the
    // spinner spins over a session the server already stopped.
    expect(legacy.data.session.status(sessionID)).toBe("running")
    legacy.dispose()
    // Engine: activity is folded durable state behind the seq cursor, so the
    // gap itself is detected and snapshot recovery resyncs activity with the
    // server (laws 7 and 8 pin the mechanism).
  })
})

// Also part of the catalog, straight from the legacy source: the layer
// documents its own event-vs-fetch race — see the session.created "band-aid"
// comment in src/solid/data.ts (skipping racy initial reads so live events
// are not overwritten by stale fetches).

function makeLegacy(overrides: { list?: () => Promise<SessionMessageInfo[]> } = {}) {
  let handler: ((event: { name: OpenCodeEvent["type"]; details: OpenCodeEvent }) => void) | undefined
  const api = {
    session: {
      get: async () => ({
        id: sessionID,
        projectID: "project",
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { created: 1, updated: 2 },
        location: { directory: "/workspace" },
      }),
    },
    message: {
      list: async () => ({
        data: overrides.list ? await overrides.list() : transcript().toReversed(),
        cursor: {},
      }),
    },
  } as unknown as ReturnType<CreateDataInput["api"]>
  return createRoot((dispose) => {
    const data = createData({
      api: () => api,
      directory: "/workspace",
      event: {
        on: () => () => {},
        listen(next) {
          handler = next
          return () => {}
        },
      },
    })
    return {
      data,
      dispose,
      dispatch(event: { type: OpenCodeEvent["type"] } & Record<string, unknown>) {
        handler?.({ name: event.type, details: event as unknown as OpenCodeEvent })
      },
      text() {
        const message = data.session.message.get(sessionID, assistantID)
        const part =
          message?.type === "assistant" ? message.content.findLast((item) => item.type === "text") : undefined
        return part?.type === "text" ? part.text : undefined
      },
    }
  })
}

async function hydrated() {
  const legacy = makeLegacy()
  await legacy.data.session.sync(sessionID)
  await legacy.data.session.message.sync(sessionID)
  return legacy
}

function transcript(): SessionMessageInfo[] {
  return [
    { id: "msg_earlier", type: "user", text: "earlier", time: { created: 1 } },
    {
      id: assistantID,
      type: "assistant",
      time: { created: 2 },
      agent: "build",
      model: { id: "model", providerID: "provider" },
      content: [],
    },
  ]
}

const textStarted = () => ({
  id: "evt_start",
  created: 3,
  type: "session.text.started" as const,
  data: { sessionID, assistantMessageID: assistantID, ordinal: 0 },
})

let deltaCount = 0
const textDelta = (delta: string) => ({
  id: `evt_delta_${++deltaCount}`,
  created: 4,
  type: "session.text.delta" as const,
  data: { sessionID, assistantMessageID: assistantID, ordinal: 0, delta },
})

const textEnded = (text: string) => ({
  id: "evt_end",
  created: 5,
  type: "session.text.ended" as const,
  data: { sessionID, assistantMessageID: assistantID, ordinal: 0, text },
})

const inboxEnqueued = (inboxID: string) => ({
  id: "evt_enqueued",
  created: 6,
  type: "session.inbox.enqueued" as const,
  data: {
    sessionID,
    inboxID,
    item: { type: "user", delivery: "steer", payload: { text: "hello" } },
  },
})

const inboxDelivered = (inboxID: string) => ({
  id: "evt_delivered",
  created: 7,
  type: "session.inbox.delivered" as const,
  data: { sessionID, inboxID },
})

const executionStarted = () => ({
  id: "evt_execution",
  created: 8,
  type: "session.execution.started" as const,
  data: { sessionID },
})
