import { describe, it, expect } from "bun:test"
import { FeatherlessGate, type EventSink, type FeedFactory } from "../../../src/provider/sdk/featherless/gate"

interface FakeFeed {
  factory: FeedFactory
  push: (used_cost: number, limit: number | null) => void
  isStopped: () => boolean
  isAttached: () => boolean
}

function makeFakeFeed(): FakeFeed {
  let sink: EventSink | null = null
  let stopped = false
  const factory: FeedFactory = (s) => {
    sink = s
    return {
      stop() {
        stopped = true
      },
    }
  }
  return {
    factory,
    push: (used_cost, limit) => sink?.({ used_cost, limit }),
    isStopped: () => stopped,
    isAttached: () => sink !== null,
  }
}

const startGate = async (feed: FakeFeed) => {
  const gate = new FeatherlessGate({ feed: feed.factory })
  await gate.start()
  return gate
}

const tickMicro = () => new Promise((r) => setTimeout(r, 0))

describe("FeatherlessGate — admission", () => {
  it("admits immediately when within budget", async () => {
    const feed = makeFakeFeed()
    const gate = await startGate(feed)
    feed.push(0, 4)

    const release = await gate.acquire(2)
    expect(typeof release).toBe("function")
    expect(gate.pendingCost()).toBe(2)
    release()
    expect(gate.pendingCost()).toBe(0)
    await gate.stop()
  })

  it("treats null limit as unlimited (always admits)", async () => {
    const feed = makeFakeFeed()
    const gate = await startGate(feed)
    feed.push(0, null)

    // Admit a huge cost — would exceed any real plan.
    const release = await gate.acquire(99)
    expect(release).toBeDefined()
    release()
    await gate.stop()
  })

  it("blocks when remote.used_cost + new_cost would exceed limit", async () => {
    const feed = makeFakeFeed()
    const gate = await startGate(feed)
    feed.push(3, 4)

    let resolved = false
    const p = gate.acquire(2).then((r) => {
      resolved = true
      return r
    })

    await tickMicro()
    expect(resolved).toBe(false)
    expect(gate.queuedCount()).toBe(1)

    // Free up budget on the remote side.
    feed.push(0, 4)
    const release = await p
    expect(resolved).toBe(true)
    expect(gate.pendingCost()).toBe(2)
    release()
    await gate.stop()
  })

  it("local pending counts against admission predicate (no double-admit before SSE catches up)", async () => {
    const feed = makeFakeFeed()
    const gate = await startGate(feed)
    feed.push(0, 4)

    const r1 = await gate.acquire(2)
    const r2 = await gate.acquire(2)
    expect(gate.pendingCost()).toBe(4)

    // Limit reached locally even though remote.used_cost is still 0.
    let admitted = false
    void gate.acquire(1).then(() => {
      admitted = true
    })
    await tickMicro()
    expect(admitted).toBe(false)
    expect(gate.queuedCount()).toBe(1)

    r1()
    await tickMicro()
    expect(admitted).toBe(true)
    r2()
    await gate.stop()
  })
})

describe("FeatherlessGate — FIFO ordering", () => {
  it("a cheap admittable request still queues behind an over-budget waiter", async () => {
    const feed = makeFakeFeed()
    const gate = await startGate(feed)
    feed.push(0, 4)

    const occupy = await gate.acquire(2) // pending=2, room=2

    const events: string[] = []
    // A wants cost 3 — can't fit (2 + 3 > 4). Queues.
    const pA = gate.acquire(3).then((r) => {
      events.push("A")
      return r
    })
    // B wants cost 1 — could fit (2 + 1 = 3 ≤ 4) ALONE, but FIFO must keep
    // it behind A so a cheap firehose can't starve a costly request.
    const pB = gate.acquire(1).then((r) => {
      events.push("B")
      return r
    })

    await tickMicro()
    expect(events).toEqual([]) // B did NOT jump ahead
    expect(gate.queuedCount()).toBe(2)

    // Free up 2 slots — A fits (cost 3 vs 4 free), then B fits behind it.
    occupy()
    const rA = await pA
    const rB = await pB
    expect(events).toEqual(["A", "B"])
    rA()
    rB()
    await gate.stop()
  })

  it("head-of-line blocks: A can't fit even after a partial release", async () => {
    const feed = makeFakeFeed()
    const gate = await startGate(feed)
    feed.push(0, 4)

    const occupyA = await gate.acquire(2) // pending=2
    const occupyB = await gate.acquire(2) // pending=4

    const events: string[] = []
    // Costly waiter — needs 3 free.
    const pBig = gate.acquire(3).then((r) => {
      events.push("BIG")
      return r
    })
    // Cheap waiter behind it — could fit after one release but must wait.
    const pSmall = gate.acquire(1).then((r) => {
      events.push("small")
      return r
    })

    await tickMicro()
    expect(events).toEqual([])

    // Release one slot of size 2 — frees 2 of 4. BIG needs 3, still blocked.
    // small (cost 1) could now fit but FIFO holds it.
    occupyA()
    await tickMicro()
    expect(events).toEqual([])
    expect(gate.queuedCount()).toBe(2)

    // Release the other — frees all. BIG fits, then small.
    occupyB()
    const rBig = await pBig
    const rSmall = await pSmall
    expect(events).toEqual(["BIG", "small"])
    rBig()
    rSmall()
    await gate.stop()
  })
})

describe("FeatherlessGate — release semantics", () => {
  it("release() is idempotent", async () => {
    const feed = makeFakeFeed()
    const gate = await startGate(feed)
    feed.push(0, 2)

    const release = await gate.acquire(1)
    expect(gate.pendingCost()).toBe(1)
    release()
    release()
    release()
    expect(gate.pendingCost()).toBe(0)
    await gate.stop()
  })

  it("releasing one slot drains the next admittable waiter", async () => {
    const feed = makeFakeFeed()
    const gate = await startGate(feed)
    feed.push(0, 2)

    const a = await gate.acquire(1)
    const b = await gate.acquire(1)
    expect(gate.pendingCost()).toBe(2)

    const cPromise = gate.acquire(1)
    await tickMicro()
    expect(gate.queuedCount()).toBe(1)

    a() // free 1 slot
    const c = await cPromise
    expect(gate.queuedCount()).toBe(0)
    expect(gate.pendingCost()).toBe(2)
    b()
    c()
    await gate.stop()
  })

  it("rejects acquire(0) and acquire(negative)", async () => {
    const feed = makeFakeFeed()
    const gate = await startGate(feed)
    feed.push(0, 4)

    await expect(gate.acquire(0)).rejects.toThrow(/positive/)
    await expect(gate.acquire(-1)).rejects.toThrow(/positive/)
    await gate.stop()
  })
})

describe("FeatherlessGate — SSE-driven dynamics", () => {
  it("plan upgrade (limit raised) drains queued waiters in order", async () => {
    const feed = makeFakeFeed()
    const gate = await startGate(feed)
    feed.push(0, 2)

    const occupy = await gate.acquire(2)
    const order: number[] = []
    const p1 = gate.acquire(2).then((r) => {
      order.push(1)
      return r
    })
    const p2 = gate.acquire(2).then((r) => {
      order.push(2)
      return r
    })

    await tickMicro()
    expect(order).toEqual([])

    // Plan upgrade — limit goes from 2 → 8 with no other change. Waiters drain.
    feed.push(2, 8) // remote shows our occupy, plus extra capacity
    const r1 = await p1
    const r2 = await p2
    expect(order).toEqual([1, 2])
    occupy()
    r1()
    r2()
    await gate.stop()
  })

  it("external request consumes budget (used_cost rises with no local cause)", async () => {
    const feed = makeFakeFeed()
    const gate = await startGate(feed)
    feed.push(0, 4)

    // Someone else's session burns 4 slots. We have nothing pending locally.
    feed.push(4, 4)

    let admitted = false
    void gate.acquire(1).then(() => {
      admitted = true
    })
    await tickMicro()
    expect(admitted).toBe(false)
    expect(gate.queuedCount()).toBe(1)

    // External request finishes.
    feed.push(0, 4)
    await tickMicro()
    expect(admitted).toBe(true)
    await gate.stop()
  })

  it("SSE event with used_cost 0 / limit infinity reflected in snapshot", async () => {
    const feed = makeFakeFeed()
    const gate = await startGate(feed)
    feed.push(3, 8)
    expect(gate.snapshot()).toEqual({
      remote_used_cost: 3,
      remote_limit: 8,
      pending_cost: 0,
      queued: 0,
    })

    feed.push(0, null)
    expect(gate.snapshot()).toEqual({
      remote_used_cost: 0,
      remote_limit: null,
      pending_cost: 0,
      queued: 0,
    })
    await gate.stop()
  })
})

describe("FeatherlessGate — lifecycle", () => {
  it("start() is idempotent and stop() rejects waiters", async () => {
    const feed = makeFakeFeed()
    const gate = new FeatherlessGate({ feed: feed.factory })
    await gate.start()
    await gate.start() // second start is a no-op
    expect(feed.isAttached()).toBe(true)

    feed.push(4, 4) // exhausted
    const p = gate.acquire(1)
    await tickMicro()
    expect(gate.queuedCount()).toBe(1)

    await gate.stop()
    expect(feed.isStopped()).toBe(true)
    await expect(p).rejects.toThrow(/stopped/)
  })

  it("acquire() after stop() rejects synchronously", async () => {
    const feed = makeFakeFeed()
    const gate = await startGate(feed)
    feed.push(0, 4)
    await gate.stop()

    await expect(gate.acquire(1)).rejects.toThrow(/stopped/)
  })

  it("stop() is idempotent", async () => {
    const feed = makeFakeFeed()
    const gate = await startGate(feed)
    await gate.stop()
    await gate.stop() // does not throw
  })

  it("constructor without `feed` and without `apiKey` throws on start()", async () => {
    const gate = new FeatherlessGate({})
    await expect(gate.start()).rejects.toThrow(/feed.*apiKey|apiKey.*feed|provide/)
  })
})

describe("FeatherlessGate — concurrent acquire stress", () => {
  it("never admits beyond the limit with batched concurrent acquires", async () => {
    const feed = makeFakeFeed()
    const gate = await startGate(feed)
    feed.push(0, 4)

    let inFlight = 0
    let max = 0
    const work = async () => {
      const r = await gate.acquire(1)
      inFlight++
      if (inFlight > max) max = inFlight
      // simulate request duration
      await new Promise((res) => setTimeout(res, 5))
      inFlight--
      r()
    }
    await Promise.all(Array.from({ length: 16 }, () => work()))
    expect(max).toBeLessThanOrEqual(4)
    expect(gate.pendingCost()).toBe(0)
    expect(gate.queuedCount()).toBe(0)
    await gate.stop()
  })
})
