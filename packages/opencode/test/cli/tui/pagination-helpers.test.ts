import { describe, expect, test } from "bun:test"
import {
  edgeHints,
  evictFromEnd,
  evictFromStart,
  olderScrollTarget,
  paginationError,
  queueBoundaryLoad,
  windowNewest,
  windowOldest,
} from "../../../src/cli/cmd/tui/util/pagination"
import type { Message } from "@opencode-ai/sdk/v2"

const make = (ids: string[]) =>
  ids.map(
    (id) =>
      ({
        id,
        sessionID: "ses_test",
        role: "user",
        agent: "default",
        model: { providerID: "test", modelID: "test" },
        time: { created: Date.now() },
      }) as Message,
  )

describe("tui pagination helpers", () => {
  test("window bounds skip pinned message", () => {
    const messages = make(["m1", "m2", "m3", "m4"])
    expect(windowOldest(messages, "m1")).toBe("m2")
    expect(windowNewest(messages, "m4")).toBe("m3")
  })

  test("evictFromStart skips pinned messages", () => {
    const messages = make(["m1", "m2", "m3", "m4", "m5"])
    const evicted = evictFromStart(messages, 2, "m2")
    expect(evicted.map((m) => m.id)).toEqual(["m1", "m3"])
    expect(messages.map((m) => m.id)).toEqual(["m2", "m4", "m5"])
  })

  test("evictFromEnd skips pinned messages", () => {
    const messages = make(["m1", "m2", "m3", "m4", "m5"])
    const evicted = evictFromEnd(messages, 2, "m4")
    expect(evicted.map((m) => m.id)).toEqual(["m5", "m3"])
    expect(messages.map((m) => m.id)).toEqual(["m1", "m2", "m4"])
  })

  test("paginationError reads object message fields", () => {
    expect(paginationError({ message: "timeout" })).toBe("timeout")
    expect(paginationError({ error: { message: "denied" } })).toBe("denied")
  })

  test("paginationError avoids [object Object] fallback", () => {
    expect(paginationError({ foo: "bar" })).not.toBe("[object Object]")
  })

  test("queueBoundaryLoad routes direction by delta", () => {
    let older = 0
    let newer = 0
    const queue = (run: () => void) => run()
    queueBoundaryLoad(
      -1,
      () => older++,
      () => newer++,
      queue,
    )
    queueBoundaryLoad(
      1,
      () => older++,
      () => newer++,
      queue,
    )
    queueBoundaryLoad(
      0,
      () => older++,
      () => newer++,
      queue,
    )
    expect(older).toBe(1)
    expect(newer).toBe(1)
  })

  test("edgeHints computes nearTop and nearBottom", () => {
    expect(edgeHints(0, 300, 100, 20)).toEqual({ nearTop: true, nearBottom: false })
    expect(edgeHints(200, 300, 100, 20)).toEqual({ nearTop: false, nearBottom: true })
  })

  test("olderScrollTarget prefers anchor child", () => {
    const top = olderScrollTarget(
      [
        { id: "m1", y: 80, height: 20 },
        { id: "m2", y: 120, height: 20 },
      ],
      500,
      400,
      0,
      { id: "m1", offset: 3 },
    )
    expect(top).toBe(83)
  })

  test("olderScrollTarget falls back to delta", () => {
    const top = olderScrollTarget([{ id: "m1", y: 80, height: 20 }], 500, 400, 25, {
      id: "missing",
      offset: 0,
    })
    expect(top).toBe(125)
  })

  test("olderScrollTarget can keep viewport unchanged", () => {
    const top = olderScrollTarget([], 400, 400, 10)
    expect(top).toBeUndefined()
  })

  test("anchor restore moves edge state away from top", () => {
    const top = olderScrollTarget([{ id: "m1", y: 60, height: 20 }], 500, 400, 0, {
      id: "m1",
      offset: 0,
    })
    expect(top).toBe(60)
    expect(edgeHints(top!, 500, 100, 20).nearTop).toBe(false)
  })

  test("command scroll flow updates top hint after older load restore", () => {
    let older = 0
    let newer = 0
    const queue = (run: () => void) => run()

    expect(edgeHints(0, 320, 100, 20)).toEqual({ nearTop: true, nearBottom: false })

    queueBoundaryLoad(
      -40,
      () => older++,
      () => newer++,
      queue,
    )

    const top = olderScrollTarget([{ id: "a", y: 55, height: 10 }], 460, 320, 0, {
      id: "a",
      offset: 0,
    })

    expect(older).toBe(1)
    expect(newer).toBe(0)
    expect(top).toBe(55)
    expect(edgeHints(top!, 460, 100, 20)).toEqual({ nearTop: false, nearBottom: false })
  })
})
