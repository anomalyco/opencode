import { describe, expect, test } from "bun:test"
import { clearFrameCache, frame, join } from "../../src/server/routes/instance/httpapi/handlers/sse-frame"

const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes)

describe("SSE frame encoding", () => {
  test("renders an id line and caches identical frames per key", () => {
    const first = frame("evt_cache_a", "evt_cache_a", {
      id: "evt_cache_a",
      type: "server.connected",
      properties: {},
    })
    expect(decode(first)).toBe(
      'id: evt_cache_a\ndata: {"id":"evt_cache_a","type":"server.connected","properties":{}}\n\n',
    )
    expect(frame("evt_cache_a", "evt_cache_a", { id: "evt_cache_a", type: "server.connected", properties: {} })).toBe(
      first,
    )
  })

  test("omits the id line when the event has no id", () => {
    expect(decode(frame("evt_no_id", undefined, { type: "server.heartbeat", properties: {} }))).toBe(
      'data: {"type":"server.heartbeat","properties":{}}\n\n',
    )
  })

  test("does not cache transient frames minted with a unique id", () => {
    const payload = { id: "evt_connected_1", type: "server.connected", properties: {} }
    const first = frame("evt_connected_1", "evt_connected_1", payload, false)
    const second = frame("evt_connected_1", "evt_connected_1", payload, false)
    expect(second).not.toBe(first)
    expect(Array.from(second)).toEqual(Array.from(first))
  })

  test("keeps caching durable frames that repeat across clients", () => {
    const payload = { id: "evt_durable_1", type: "message.part.updated", properties: {} }
    const first = frame("evt_durable_1", "evt_durable_1", payload)
    expect(frame("evt_durable_1", "evt_durable_1", payload)).toBe(first)
  })

  test("joins a batch into one buffer without changing the wire bytes", () => {
    const one = frame("evt_batch_1", "evt_batch_1", { id: "evt_batch_1", type: "a", properties: {} })
    const two = frame("evt_batch_2", "evt_batch_2", { id: "evt_batch_2", type: "b", properties: {} })
    const merged = join([one, two])
    expect(merged.byteLength).toBe(one.byteLength + two.byteLength)
    expect(Array.from(merged)).toEqual([...one, ...two])
    expect(join([one])).toBe(one)
  })

  test("does not cache frames over the per-frame byte cap", () => {
    const payload = { id: "evt_huge", type: "message.part.updated", properties: { text: "x".repeat(300 * 1024) } }
    const first = frame("evt_huge", "evt_huge", payload)
    expect(first.byteLength).toBeGreaterThan(256 * 1024)
    const second = frame("evt_huge", "evt_huge", payload)
    expect(second).not.toBe(first)
  })

  test("evicts by total byte budget, not just entry count", () => {
    const payload = () => ({ type: "message.part.updated", properties: { text: "y".repeat(200 * 1024) } })
    const original = frame("evt_bulk_first", "evt_bulk_first", payload())
    for (let index = 0; index < 50; index++) {
      frame(`evt_bulk_${index}`, `evt_bulk_${index}`, payload())
    }
    expect(frame("evt_bulk_first", "evt_bulk_first", payload())).not.toBe(original)
  })

  test("clears retained frames on demand", () => {
    const payload = { id: "evt_clear_1", type: "message.part.updated", properties: {} }
    const first = frame("evt_clear_1", "evt_clear_1", payload)
    clearFrameCache()
    expect(frame("evt_clear_1", "evt_clear_1", payload)).not.toBe(first)
  })

  test("clears only the scoped instance's frames", () => {
    const first = { id: "evt_scope_a", type: "message.part.updated", properties: {} }
    const second = { id: "evt_scope_b", type: "message.part.updated", properties: {} }
    const cachedA = frame("evt_scope_a", "evt_scope_a", first, true, "/dir/a")
    const cachedB = frame("evt_scope_b", "evt_scope_b", second, true, "/dir/b")

    clearFrameCache("/dir/a")

    expect(frame("evt_scope_a", "evt_scope_a", first, true, "/dir/a")).not.toBe(cachedA)
    expect(frame("evt_scope_b", "evt_scope_b", second, true, "/dir/b")).toBe(cachedB)
  })
})
