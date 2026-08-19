// In-memory model of the server's session log, used by the engine laws
// (sync-engine-laws.test.ts), the chaos simulation (sync-engine-sim.test.ts),
// and the legacy bug catalog (legacy-divergence.test.ts). It folds with the
// REAL SessionFold, so `truth()` is the same interpretation of events a
// converged client must reach, and its admission dedupes by inbox ID exactly
// like the server's inbox projector. Faults are injected per call through the
// `faults` record; `cutConnections` and `prune` model disconnects and lost
// retention.
import type { SessionInfo, SessionMessageInfo } from "../../src/promise"
import { Engine } from "../../src/solid/engine/engine"
import type { DurableSessionEvent, SessionFoldState, SessionSnapshot } from "../../src/solid/engine/fold"
import { SessionFold } from "../../src/solid/engine/fold"

export class FakeSessionServer implements Engine.SessionTransport {
  readonly events: Array<DurableSessionEvent> = []
  readonly admitted: Array<string> = []
  readonly faults = {
    loseRequests: 0,
    loseResponses: 0,
    loseSnapshots: 0,
    reject: 0,
    latency: 0,
  }

  private folded: SessionFoldState
  private readonly tails = new Set<AsyncQueue<Engine.SessionStreamItem>>()
  private eventCounter = 0

  constructor(
    readonly sessionID: string,
    readonly time = 1_717_171_717_000,
  ) {
    this.folded = SessionFold.fromSnapshot(emptySnapshot(sessionID, time))
  }

  async snapshot(sessionID: string) {
    await this.pause()
    this.assertSession(sessionID)
    if (this.faults.loseSnapshots > 0) {
      this.faults.loseSnapshots--
      throw new Error("snapshot lost")
    }
    return this.snapshotValue()
  }

  async *stream(sessionID: string, after: number, signal?: AbortSignal): AsyncIterable<Engine.SessionStreamItem> {
    await this.pause()
    this.assertSession(sessionID)
    if (after > this.folded.seq) throw new Engine.SeqUnavailable()
    const replay = this.events.filter((event) => event.durable.seq > after)
    // Honest replay contract: a cursor is only admitted when retained events fully cover (after, seq].
    if (replay.length < this.folded.seq - after) throw new Engine.SeqUnavailable()
    const queue = new AsyncQueue<Engine.SessionStreamItem>()
    const abort = () => queue.fail(new Error("stream aborted"))
    signal?.addEventListener("abort", abort, { once: true })
    this.tails.add(queue)
    try {
      for (const event of replay) yield event
      yield { type: "log.synced", aggregateID: sessionID, seq: this.folded.seq }
      while (true) yield await queue.take()
    } finally {
      signal?.removeEventListener("abort", abort)
      this.tails.delete(queue)
    }
  }

  async submit(input: Engine.SubmitInput) {
    await this.pause()
    this.assertSession(input.sessionID)
    const existing = this.events.find(
      (event) => event.type === "session.inbox.enqueued" && event.data.inboxID === input.id,
    )
    if (existing) return
    if (this.faults.loseRequests > 0) {
      this.faults.loseRequests--
      throw new Error("request lost")
    }
    if (this.faults.reject > 0) {
      this.faults.reject--
      throw new Engine.SubmitRejected("rejected")
    }
    this.admitted.push(input.id)
    this.publish({
      id: `evt_${String(++this.eventCounter).padStart(8, "0")}`,
      created: this.time,
      type: "session.inbox.enqueued",
      durable: { aggregateID: this.sessionID, seq: this.folded.seq + 1, version: 1 },
      data: {
        sessionID: this.sessionID,
        inboxID: input.id,
        item: {
          type: "user",
          delivery: input.request.delivery ?? "steer",
          payload: {
            text: input.request.text,
            agents: input.request.agents?.map((agent) => ({ ...agent })),
            metadata: input.request.metadata,
          },
        },
      },
    })
    if (this.faults.loseResponses > 0) {
      this.faults.loseResponses--
      throw new Error("response lost")
    }
  }

  cutConnections() {
    this.tails.forEach((tail) => tail.fail(new Error("connection cut")))
  }

  /** Drop retained event history, simulating `events.persist` off or pruned retention. */
  prune() {
    this.events.length = 0
  }

  /** Clear every injected fault. */
  heal() {
    for (const fault of Object.keys(this.faults) as Array<keyof FakeSessionServer["faults"]>) this.faults[fault] = 0
  }

  seq() {
    return this.folded.seq
  }

  truth() {
    return Engine.render({ folded: this.folded, outbox: [], overlay: new Map() })
  }

  snapshotValue(): SessionSnapshot {
    return {
      session: this.folded.session,
      children: this.folded.children,
      inbox: this.folded.inbox,
      messages: this.folded.messages,
      seq: this.folded.seq,
      active: this.folded.active,
    }
  }

  private publish(event: DurableSessionEvent) {
    this.events.push(event)
    this.folded = SessionFold.apply(this.folded, event)
    this.tails.forEach((tail) => tail.offer(event))
  }

  private assertSession(sessionID: string) {
    if (sessionID !== this.sessionID) throw new Error(`unknown session: ${sessionID}`)
  }

  private async pause() {
    for (let step = 0; step < this.faults.latency; step++) await Promise.resolve()
  }
}

/**
 * Reconnect option that holds the engine's first reconnect until released,
 * so a test can advance the server "while disconnected". Later reconnects
 * pass through instantly.
 */
export function reconnectGate() {
  let open = false
  let release: (() => void) | undefined
  return {
    reconnect: () =>
      new Promise<void>((resolve) => {
        if (open) return resolve()
        release = () => {
          open = true
          resolve()
        }
      }),
    holding: () => release !== undefined,
    release: () => release!(),
  }
}

export async function until(check: () => boolean, message = "condition did not become true") {
  for (let attempt = 0; attempt < 500; attempt++) {
    if (check()) return
    await Bun.sleep(1)
  }
  throw new Error(message)
}

export function userMessages(messages: ReadonlyArray<SessionMessageInfo>) {
  return messages.filter(
    (message): message is Extract<SessionMessageInfo, { readonly type: "user" }> => message.type === "user",
  )
}

function emptySnapshot(sessionID: string, time: number): SessionSnapshot {
  const session: SessionInfo = {
    id: sessionID,
    projectID: "project",
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: time, updated: time },
    location: { directory: "/workspace" },
  }
  return { session, children: [], inbox: [], messages: [], seq: 0 }
}

class AsyncQueue<Value> {
  private readonly values: Array<Value> = []
  private readonly waiting: Array<{
    readonly resolve: (value: Value) => void
    readonly reject: (error: Error) => void
  }> = []
  private error?: Error

  offer(value: Value) {
    const waiter = this.waiting.shift()
    if (waiter) {
      waiter.resolve(value)
      return
    }
    this.values.push(value)
  }

  fail(error: Error) {
    this.error = error
    this.waiting.splice(0).forEach((waiter) => waiter.reject(error))
  }

  take() {
    if (this.values.length) return Promise.resolve(this.values.shift()!)
    if (this.error) return Promise.reject(this.error)
    return new Promise<Value>((resolve, reject) => this.waiting.push({ resolve, reject }))
  }
}
