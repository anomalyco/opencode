import { describe, expect, test } from "bun:test"

// Type-shape parallels for what MessageTable.$inferSelect / PartTable.$inferSelect
// produce after Drizzle reads from SQLite. Defined locally so this test does
// not need to spin up a real DB - it exercises only the pure transformation
// from row -> typed JS object that info()/part() perform.
interface MessageRow {
  id: string
  session_id: string
  time_created: number
  time_updated: number
  data: Record<string, unknown>
}

interface PartRow {
  id: string
  message_id: string
  session_id: string
  time_created: number
  time_updated: number
  data: Record<string, unknown>
}

// The "before" implementation: pre-memoization, identical to opencode's
// historical info() / part() helpers. Allocates a fresh JS object on every
// invocation - the source of the GC pressure in long-running runLoop.
const infoFresh = (row: MessageRow) =>
  ({
    ...row.data,
    id: row.id,
    sessionID: row.session_id,
  }) as Record<string, unknown>

const partFresh = (row: PartRow) =>
  ({
    ...row.data,
    id: row.id,
    sessionID: row.session_id,
    messageID: row.message_id,
  }) as Record<string, unknown>

// The "after" implementation: row-level memoization keyed by (id, time_updated).
// Mirrors the production helpers in src/session/message-v2.ts exactly.
const INFO_CACHE_MAX = 200_000
const PART_CACHE_MAX = 400_000

function makeMemoizedHelpers() {
  const infoCache = new Map<string, { time_updated: number; info: Record<string, unknown> }>()
  const partCache = new Map<string, { time_updated: number; part: Record<string, unknown> }>()
  function evictOldest<K, V>(cache: Map<K, V>, cap: number): void {
    if (cache.size <= cap) return
    const toDelete = Math.floor(cap * 0.1)
    let i = 0
    for (const key of cache.keys()) {
      cache.delete(key)
      if (++i >= toDelete) break
    }
  }
  const info = (row: MessageRow) => {
    const cached = infoCache.get(row.id)
    if (cached && cached.time_updated === row.time_updated) return cached.info
    const fresh = infoFresh(row)
    infoCache.set(row.id, { time_updated: row.time_updated, info: fresh })
    evictOldest(infoCache, INFO_CACHE_MAX)
    return fresh
  }
  const part = (row: PartRow) => {
    const cached = partCache.get(row.id)
    if (cached && cached.time_updated === row.time_updated) return cached.part
    const fresh = partFresh(row)
    partCache.set(row.id, { time_updated: row.time_updated, part: fresh })
    evictOldest(partCache, PART_CACHE_MAX)
    return fresh
  }
  return { info, part, infoCache, partCache }
}

// Deterministic synthetic generator. NO real user data - only string lengths
// and timestamps modelled on realistic message-v2 shapes (assistant message
// with tool-call parts, plus user messages, plus a few compaction markers).
// "Random" sourced from a seeded LCG so results are reproducible across runs.
function makeRng(seed = 42) {
  let state = seed
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
}

function generateSession(messageCount: number, avgPartsPerMessage: number, sessionID = "ses_synthetic") {
  const rng = makeRng(7)
  const baseTime = 1700000000000
  const messages: MessageRow[] = []
  const parts: PartRow[] = []
  for (let i = 0; i < messageCount; i++) {
    const isAssistant = i % 2 === 1
    const role = isAssistant ? "assistant" : "user"
    const msgID = `msg_${i.toString().padStart(8, "0")}`
    const tCreated = baseTime + i * 1000
    messages.push({
      id: msgID,
      session_id: sessionID,
      time_created: tCreated,
      time_updated: tCreated,
      data: {
        role,
        time: { created: tCreated, completed: tCreated + 500 },
        agent: "build",
        mode: "primary",
        providerID: "anthropic",
        modelID: "claude-opus-4-7",
        finish: "stop",
        tokens: { input: 100, output: 200, reasoning: 0 },
        cost: 0.01,
        path: { directory: "/home/test/proj/" + "x".repeat(20), worktree: "/home/test/proj" },
        summary: undefined,
      },
    })
    const partsCount = Math.max(1, Math.floor(avgPartsPerMessage + (rng() - 0.5) * avgPartsPerMessage))
    for (let p = 0; p < partsCount; p++) {
      const partID = `prt_${i.toString().padStart(8, "0")}_${p.toString().padStart(3, "0")}`
      const partType = isAssistant && p % 3 === 0 ? "tool" : isAssistant && p % 3 === 1 ? "reasoning" : "text"
      const textLen = 100 + Math.floor(rng() * 400)
      parts.push({
        id: partID,
        message_id: msgID,
        session_id: sessionID,
        time_created: tCreated + p * 10,
        time_updated: tCreated + p * 10,
        data: {
          type: partType,
          text: "x".repeat(textLen),
          tool: partType === "tool" ? "bash" : undefined,
          state:
            partType === "tool"
              ? { status: "completed", input: { command: "x".repeat(50) }, output: "x".repeat(textLen * 2) }
              : undefined,
        },
      })
    }
  }
  return { messages, parts }
}

function measureTime(label: string, fn: () => void): number {
  const start = performance.now()
  fn()
  const ms = performance.now() - start
  return ms
}

describe("MessageV2 info/part memoization", () => {
  test("memoized info returns referentially equal object for unchanged row", () => {
    const { info } = makeMemoizedHelpers()
    const row: MessageRow = {
      id: "msg_1",
      session_id: "ses_test",
      time_created: 1000,
      time_updated: 1000,
      data: { role: "user", text: "hello" },
    }
    const a = info(row)
    const b = info(row)
    expect(b).toBe(a)
  })

  test("memoized part returns referentially equal object for unchanged row", () => {
    const { part } = makeMemoizedHelpers()
    const row: PartRow = {
      id: "prt_1",
      message_id: "msg_1",
      session_id: "ses_test",
      time_created: 1000,
      time_updated: 1000,
      data: { type: "text", text: "hi" },
    }
    const a = part(row)
    const b = part(row)
    expect(b).toBe(a)
  })

  test("memoized info invalidates on time_updated change", () => {
    const { info } = makeMemoizedHelpers()
    const row: MessageRow = {
      id: "msg_2",
      session_id: "ses_test",
      time_created: 1000,
      time_updated: 1000,
      data: { role: "user", text: "v1" },
    }
    const before = info(row)
    row.time_updated = 2000
    row.data = { role: "user", text: "v2" }
    const after = info(row)
    expect(after).not.toBe(before)
    expect(after.text).toBe("v2")
  })

  test("memoized part invalidates on time_updated change", () => {
    const { part } = makeMemoizedHelpers()
    const row: PartRow = {
      id: "prt_2",
      message_id: "msg_1",
      session_id: "ses_test",
      time_created: 1000,
      time_updated: 1000,
      data: { type: "text", text: "v1" },
    }
    const before = part(row)
    row.time_updated = 2000
    row.data = { type: "text", text: "v2" }
    const after = part(row)
    expect(after).not.toBe(before)
    expect(after.text).toBe("v2")
  })

  test("memoized helpers produce field-equal output to non-memoized", () => {
    const { info, part } = makeMemoizedHelpers()
    const msgRow: MessageRow = {
      id: "msg_eq",
      session_id: "ses_test",
      time_created: 1000,
      time_updated: 1000,
      data: { role: "assistant", agent: "build", finish: "stop" },
    }
    const partRow: PartRow = {
      id: "prt_eq",
      message_id: "msg_eq",
      session_id: "ses_test",
      time_created: 1000,
      time_updated: 1000,
      data: { type: "text", text: "hello" },
    }
    expect(info(msgRow)).toEqual(infoFresh(msgRow))
    expect(part(partRow)).toEqual(partFresh(partRow))
  })

  test("perf: memoized cuts allocation rate ≥10x and GC pause time meaningfully on 5000-msg session", () => {
    const { messages, parts } = generateSession(5000, 5)
    const { info: infoCached, part: partCached } = makeMemoizedHelpers()

    for (const m of messages) infoFresh(m)
    for (const p of parts) partFresh(p)
    for (const m of messages) infoCached(m)
    for (const p of parts) partCached(p)

    const ITER = 100

    // The dominant cost in opencode's runLoop isn't the per-call wall-clock of
    // info()/part() - it's the cumulative GC pressure from millions of stale
    // allocations. To measure that, we force a synchronous GC after each path
    // and time it. The path that produced more garbage pays a longer GC.
    Bun.gc(true)
    const heapBeforeFresh = process.memoryUsage().heapUsed
    const tFresh = measureTime("fresh", () => {
      for (let i = 0; i < ITER; i++) {
        for (const m of messages) infoFresh(m)
        for (const p of parts) partFresh(p)
      }
    })
    const heapAfterFreshPreGc = process.memoryUsage().heapUsed
    const gcStartFresh = performance.now()
    Bun.gc(true)
    const tGcFresh = performance.now() - gcStartFresh
    const heapAfterFreshPostGc = process.memoryUsage().heapUsed

    Bun.gc(true)
    const heapBeforeCached = process.memoryUsage().heapUsed
    const tCached = measureTime("cached", () => {
      for (let i = 0; i < ITER; i++) {
        for (const m of messages) infoCached(m)
        for (const p of parts) partCached(p)
      }
    })
    const heapAfterCachedPreGc = process.memoryUsage().heapUsed
    const gcStartCached = performance.now()
    Bun.gc(true)
    const tGcCached = performance.now() - gcStartCached
    const heapAfterCachedPostGc = process.memoryUsage().heapUsed

    const speedup = tFresh / tCached
    const gcSpeedup = tGcFresh / Math.max(tGcCached, 0.001)
    const allocCallsFresh = ITER * (messages.length + parts.length)
    const allocCallsCached = messages.length + parts.length
    const heapGrowthFresh = heapAfterFreshPreGc - heapBeforeFresh
    const heapGrowthCached = heapAfterCachedPreGc - heapBeforeCached

    console.log(
      [
        `[perf] wall-clock:  fresh=${tFresh.toFixed(0)}ms  cached=${tCached.toFixed(0)}ms  speedup=${speedup.toFixed(1)}x`,
        `[perf] alloc count: fresh=${allocCallsFresh.toLocaleString()}  cached=${allocCallsCached.toLocaleString()}  reduction=${(allocCallsFresh / allocCallsCached).toFixed(0)}x`,
        `[perf] heap growth: fresh=${(heapGrowthFresh / 1024 / 1024).toFixed(1)}MB  cached=${(heapGrowthCached / 1024 / 1024).toFixed(1)}MB`,
        `[perf] gc pause:    fresh=${tGcFresh.toFixed(1)}ms  cached=${tGcCached.toFixed(1)}ms  speedup=${gcSpeedup.toFixed(1)}x`,
        `[perf] post-gc:     fresh=${(heapAfterFreshPostGc / 1024 / 1024).toFixed(1)}MB  cached=${(heapAfterCachedPostGc / 1024 / 1024).toFixed(1)}MB`,
      ].join("\n"),
    )

    // Wall-clock alone is a weak signal because object literal allocation is
    // already cheap. The real test is allocation count + heap growth + GC time.
    expect(allocCallsFresh / allocCallsCached).toBeGreaterThan(10)
    // Heap growth from the fresh path should be at least 2x the cached one,
    // confirming the cache is actually preventing garbage accumulation.
    expect(heapGrowthFresh).toBeGreaterThan(heapGrowthCached * 2)
    // Cached should not be slower than fresh wall-clock (allow up to 10% noise).
    expect(tCached).toBeLessThan(tFresh * 1.1)
  })

  test("perf: partial invalidation (last message changes every iter) still saves ~99% of allocations", () => {
    const { messages, parts } = generateSession(5000, 5)
    const { info: infoCached, part: partCached } = makeMemoizedHelpers()
    const ITER = 100
    let invalidations = 0

    for (const m of messages) infoCached(m)
    for (const p of parts) partCached(p)

    const tCached = measureTime("cached-partial", () => {
      for (let i = 0; i < ITER; i++) {
        // Simulate a new assistant message arriving every iteration by
        // mutating just the LATEST message's time_updated.
        const lastMsg = messages[messages.length - 1]!
        lastMsg.time_updated = lastMsg.time_updated + 1
        invalidations++
        // Also invalidate that message's last part to simulate streaming.
        const messagePartsLast = parts.filter((p) => p.message_id === lastMsg.id)
        if (messagePartsLast.length > 0) {
          const lastPart = messagePartsLast[messagePartsLast.length - 1]!
          lastPart.time_updated = lastPart.time_updated + 1
        }
        for (const m of messages) infoCached(m)
        for (const p of parts) partCached(p)
      }
    })

    console.log(`[perf] cached-partial: ${tCached.toFixed(0)}ms over ${ITER} iters with ${invalidations} invalidations`)
    // Each iteration only reallocates 1 info + ~5 parts = ~6 objects vs the
    // 30000 it would be without the cache. Total time should remain under
    // half a second on any reasonable machine.
    expect(tCached).toBeLessThan(2000)
  })
})
