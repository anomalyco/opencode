// Laws of the session sync engine: each test pins one property the engine
// must hold under transport faults. Cited by number from
// test/legacy-divergence.test.ts (the legacy bug catalog these laws rule out)
// and stress-tested together by test/sync-engine-sim.test.ts. The server
// model lives in test/fixture/sync-engine.ts and folds with the real
// SessionFold, so `server.truth()` is the state a converged client must show.
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { Engine } from "../src/solid/engine/engine"
import { FakeSessionServer, reconnectGate, until, userMessages } from "./fixture/sync-engine"

describe("session sync engine laws", () => {
  test("1. idempotency: lost responses converge to one admitted message", async () => {
    const server = new FakeSessionServer("ses_idempotency")
    server.faults.loseResponses = 1
    const engine = await Engine.createSessionEngine(server.sessionID, server, {
      now: () => server.time,
      reconnect: async () => {},
    })

    engine.submit({ id: "msg_1", text: "hello" })
    await until(() => engine.view().seq === 1)
    // The admit landed but the response was lost; the reconnect makes the
    // engine resend the same client-minted ID — that resend is what
    // idempotency must absorb.
    server.cutConnections()
    await engine.settled()

    expect(server.admitted).toEqual(["msg_1"])
    expect(userMessages(engine.view().messages)).toHaveLength(1)
    engine.stop()
  })

  test("2. echo determinism: folding the echo does not change rendered messages", async () => {
    const server = new FakeSessionServer("ses_echo")
    const engine = await Engine.createSessionEngine(server.sessionID, server, { now: () => server.time })
    await engine.ready()

    // The "echo" is the server's inbox.enqueued event for our own submit:
    // folding it over the optimistic render must be invisible — no flicker.
    engine.submit({ id: "msg_1", text: "instant" })
    const before = engine.view().messages
    await engine.settled()

    expect(engine.view().messages).toEqual(before)
    engine.stop()
  })

  test("3. sync opacity: the fold cannot see intents or the engine", () => {
    const source = readFileSync(new URL("../src/solid/engine/fold.ts", import.meta.url), "utf8")
    const code = source.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "")

    expect(code).not.toMatch(/\boutbox\b/)
    expect(code).not.toContain("./engine")
    expect(code).not.toMatch(/\bintents?\b/i)
  })

  test("4. ordering: a burst admits in submission order", async () => {
    const server = new FakeSessionServer("ses_ordering")
    const engine = await Engine.createSessionEngine(server.sessionID, server)

    for (const value of [1, 2, 3, 4, 5]) engine.submit({ id: `msg_${value}`, text: `m${value}` })
    await engine.settled()

    expect(server.admitted).toEqual(["msg_1", "msg_2", "msg_3", "msg_4", "msg_5"])
    engine.stop()
  })

  test("5. convergence: drained clients equal the server fold", async () => {
    const server = new FakeSessionServer("ses_convergence")
    const a = await Engine.createSessionEngine(server.sessionID, server, { makeID: () => "msg_a" })
    const b = await Engine.createSessionEngine(server.sessionID, server, { makeID: () => "msg_b" })

    a.submit({ text: "from a" })
    b.submit({ text: "from b" })
    await Promise.all([a.settled(), b.settled()])
    await until(() => a.view().seq === server.seq() && b.view().seq === server.seq())

    expect(a.view()).toEqual(server.truth())
    expect(b.view()).toEqual(server.truth())
    a.stop()
    b.stop()
  })

  test("6. failure atomicity: typed rejection removes and surfaces the intent", async () => {
    const server = new FakeSessionServer("ses_failure")
    server.faults.reject = 1
    const engine = await Engine.createSessionEngine(server.sessionID, server)
    const failures: Array<Engine.IntentFailure> = []
    engine.subscribeFailures((failure) => failures.push(failure))
    const before = engine.view()

    const intent = engine.submit({ id: "msg_1", text: "doomed" })
    expect(userMessages(engine.view().messages)).toHaveLength(1)
    await until(() => failures.length === 1)

    expect(engine.view()).toEqual(before)
    expect(failures).toEqual([{ intent, reason: "rejected" }])
    engine.stop()
  })

  test("7. lossy history: reconnect without retained events recovers via snapshot", async () => {
    const server = new FakeSessionServer("ses_lossy")
    const gate = reconnectGate()
    const engine = await Engine.createSessionEngine(server.sessionID, server, {
      now: () => server.time,
      reconnect: gate.reconnect,
    })
    engine.submit({ id: "msg_1", text: "first" })
    await engine.settled()

    server.cutConnections()
    await until(gate.holding)
    // While disconnected the session advances, then history is dropped: the
    // reconnect cursor cannot be replayed and must recover via snapshot.
    await server.submit({ id: "msg_2", sessionID: server.sessionID, request: { text: "second" } })
    server.prune()
    gate.release()

    await until(() => engine.view().seq === 2)
    expect(engine.view()).toEqual(server.truth())
    engine.stop()
  })

  test("8. attach gaps: a synced marker past the fold forces snapshot recovery", async () => {
    const server = new FakeSessionServer("ses_marker_gap")
    await server.submit({ id: "msg_1", sessionID: server.sessionID, request: { text: "hello" } })
    const stale = { ...server.snapshotValue(), messages: [], inbox: [], seq: 0 }
    let attempts = 0
    const engine = await Engine.createSessionEngine(
      server.sessionID,
      {
        snapshot: (sessionID) => (attempts === 0 ? Promise.resolve(stale) : server.snapshot(sessionID)),
        async *stream(sessionID, after, signal) {
          attempts++
          if (attempts === 1) {
            // Dishonest attach: the marker admits the cursor but skips the replay range.
            yield { type: "log.synced" as const, aggregateID: sessionID, seq: server.snapshotValue().seq }
            return
          }
          yield* server.stream(sessionID, after, signal)
        },
        submit: (input) => server.submit(input),
      },
      { reconnect: async () => {} },
    )
    await engine.ready()

    expect(attempts).toBe(2)
    expect(engine.view()).toEqual(server.truth())
    engine.stop()
  })

  test("9. outage recovery: failed recovery snapshots retry until the server returns", async () => {
    const server = new FakeSessionServer("ses_outage")
    const gate = reconnectGate()
    const engine = await Engine.createSessionEngine(server.sessionID, server, {
      now: () => server.time,
      reconnect: gate.reconnect,
    })
    engine.submit({ id: "msg_1", text: "first" })
    await engine.settled()

    server.cutConnections()
    await until(gate.holding)
    // A server restart while disconnected: history is gone, and the server
    // stays unreachable for the first snapshot attempts of the recovery.
    await server.submit({ id: "msg_2", sessionID: server.sessionID, request: { text: "second" } })
    server.prune()
    server.faults.loseSnapshots = 3
    gate.release()

    await until(() => engine.view().seq === 2)
    expect(server.faults.loseSnapshots).toBe(0)
    expect(engine.view()).toEqual(server.truth())
    engine.stop()
  })

  test("10. refresh monotonicity: a stale snapshot refresh cannot move the fold behind the live log", async () => {
    const server = new FakeSessionServer("ses_refresh_race")
    const stale = server.snapshotValue()
    let refresh = false
    const transport: Engine.SessionTransport = {
      snapshot: (sessionID) => (refresh ? Promise.resolve(stale) : server.snapshot(sessionID)),
      stream: (sessionID, after) => server.stream(sessionID, after),
      submit: (input) => server.submit(input),
    }
    const engine = await Engine.createSessionEngine(server.sessionID, transport)
    await engine.ready()

    engine.submit({ id: "msg_1", text: "newer than snapshot" })
    await until(() => engine.view().seq === 1)
    refresh = true
    await engine.refresh()

    expect(engine.view().seq).toBe(1)
    // ...and the un-echoed intent survives the rejected refresh.
    expect(engine.view().pending.map((item) => item.id)).toEqual(["msg_1"])
    engine.stop()
  })
})
