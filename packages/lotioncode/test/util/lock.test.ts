import { describe, expect, test } from "bun:test"
import { Lock } from "../../src/util/lock"

function tick() {
  return new Promise<void>((r) => queueMicrotask(r))
}

async function flush(n = 5) {
  for (let i = 0; i < n; i++) await tick()
}

describe("util.lock", () => {
  test("writer exclusivity: blocks reads and other writes while held", async () => {
    const key = "lock:" + Math.random().toString(36).slice(2)

    const state = {
      writer2: false,
      reader: false,
      writers: 0,
    }

    // Acquire writer1
    using writer1 = await Lock.write(key)
    state.writers++
    expect(state.writers).toBe(1)

    // Start writer2 candidate (should block)
    const writer2Task = (async () => {
      const w = await Lock.write(key)
      state.writers++
      expect(state.writers).toBe(1)
      state.writer2 = true
      // Hold for a tick so reader cannot slip in
      await tick()
      return w
    })()

    // Start reader candidate (should block)
    const readerTask = (async () => {
      const r = await Lock.read(key)
      state.reader = true
      return r
    })()

    // Flush microtasks and assert neither acquired
    await flush()
    expect(state.writer2).toBe(false)
    expect(state.reader).toBe(false)

    // Release writer1
    writer1[Symbol.dispose]()
    state.writers--

    // writer2 should acquire next
    const writer2 = await writer2Task
    expect(state.writer2).toBe(true)

    // Reader still blocked while writer2 held
    await flush()
    expect(state.reader).toBe(false)

    // Release writer2
    writer2[Symbol.dispose]()
    state.writers--

    // Reader should now acquire
    const reader = await readerTask
    expect(state.reader).toBe(true)

    reader[Symbol.dispose]()
  })
})
