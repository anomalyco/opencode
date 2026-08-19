import { describe, expect, test } from "bun:test"
import type { Message } from "@opencode-ai/sdk/v2"
import {
  edgeHints,
  evictFromEnd,
  evictFromStart,
  hasBeforeBoundary,
  hasUserBeforeBoundary,
  lastValidUser,
  messageBefore,
  messageInsert,
  olderScrollTarget,
  olderSearchCanContinue,
  paginationError,
  queueBoundaryLoad,
  revertMessageState,
  visibleBeforeBoundary,
  visiblePartsBeforeBoundary,
  windowNewest,
  windowOldest,
} from "../../src/util/pagination"

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

  test("detects whether any loaded message is visible before the revert boundary", () => {
    const boundary = { ...make(["m6"])[0], time: { created: 6 } }
    expect(hasBeforeBoundary([{ ...make(["m6"])[0], time: { created: 6 } }], boundary)).toBe(false)
    expect(hasBeforeBoundary([{ ...make(["m5"])[0], time: { created: 5 } }, boundary], boundary)).toBe(true)
  })

  test("requires a user message before the revert boundary", () => {
    const boundary = { ...make(["m6"])[0], time: { created: 6 }, role: "user" as const }
    const assistant = { ...make(["m5"])[0], time: { created: 5 }, role: "assistant" as const }
    const user = { ...make(["m4"])[0], time: { created: 4 }, role: "user" as const }
    expect(hasUserBeforeBoundary([assistant, boundary], boundary)).toBe(false)
    expect(hasUserBeforeBoundary([assistant, user, boundary], boundary)).toBe(true)
  })

  test("lastValidUser returns the newest real user message", () => {
    const messages = [
      { id: "m1", role: "user" },
      { id: "m2", role: "assistant" },
      { id: "m3", role: "user" },
    ]
    const parts: Record<string, { type: string; synthetic?: boolean; ignored?: boolean }[]> = {
      m1: [{ type: "text" }],
      m2: [{ type: "text" }],
      m3: [{ type: "text" }],
    }
    expect(lastValidUser(messages, (id) => parts[id])?.id).toBe("m3")
  })

  test("lastValidUser skips synthetic-only, ignored-only, and partless users", () => {
    const messages = [
      { id: "m1", role: "user" },
      { id: "m2", role: "user" },
      { id: "m3", role: "user" },
      { id: "m4", role: "user" },
    ]
    const parts: Record<string, { type: string; synthetic?: boolean; ignored?: boolean }[] | undefined> = {
      m1: [{ type: "text" }],
      m2: [{ type: "text", synthetic: true }],
      m3: [{ type: "text", ignored: true }],
      m4: undefined,
    }
    expect(lastValidUser(messages, (id) => parts[id])?.id).toBe("m1")
  })

  test("lastValidUser ignores assistant messages and returns undefined when none qualify", () => {
    const messages = [
      { id: "m1", role: "assistant" },
      { id: "m2", role: "user" },
    ]
    const parts: Record<string, { type: string; synthetic?: boolean; ignored?: boolean }[]> = {
      m1: [{ type: "text" }],
      m2: [{ type: "file" }],
    }
    expect(lastValidUser(messages, (id) => parts[id])).toBeUndefined()
  })

  test("older history search continues only when its cursor advances", () => {
    expect(
      olderSearchCanContinue("cursor-1", {
        hasOlder: true,
        loading: false,
        olderCursor: "cursor-2",
      }),
    ).toBe(true)
    expect(
      olderSearchCanContinue("cursor-1", {
        hasOlder: true,
        loading: false,
        olderCursor: "cursor-1",
      }),
    ).toBe(false)
    expect(
      olderSearchCanContinue("cursor-1", {
        hasOlder: false,
        loading: false,
        olderCursor: undefined,
      }),
    ).toBe(false)
  })

  test("messageBefore sorts by time then id", () => {
    const a = { ...make(["m1"])[0], time: { created: 1 } }
    const b = { ...make(["m2"])[0], time: { created: 2 } }
    expect(messageBefore(a, b)).toBe(true)
  })

  test("messageBefore handles fractional timestamps numerically", () => {
    const a = { ...make(["m1"])[0], time: { created: 1710000000000.5 } }
    const b = { ...make(["m2"])[0], time: { created: 1710000000001 } }
    expect(messageBefore(a, b)).toBe(true)
  })

  test("visibleBeforeBoundary filters by message ordering, not ID ordering", () => {
    const items = [
      { info: { ...make(["msg_9"])[0], time: { created: 1 } }, parts: [] },
      { info: { ...make(["msg_2"])[0], time: { created: 2 } }, parts: [] },
      { info: { ...make(["msg_1"])[0], time: { created: 3 } }, parts: [] },
    ]

    expect(visibleBeforeBoundary(items, "msg_2").map((item) => item.info.id)).toEqual(["msg_9"])
  })

  test("visibleBeforeBoundary uses an already loaded boundary", () => {
    const boundary = { ...make(["msg_boundary"])[0], time: { created: 2 } }
    const items = [
      { info: { ...make(["msg_before"])[0], time: { created: 1 } }, parts: [] },
      { info: { ...make(["msg_after"])[0], time: { created: 3 } }, parts: [] },
    ]

    expect(visibleBeforeBoundary(items, "msg_boundary", boundary).map((item) => item.info.id)).toEqual(["msg_before"])
  })

  test("visibleBeforeBoundary fails closed when the boundary is not loaded", () => {
    const items = [
      { info: { ...make(["msg_z"])[0], time: { created: 1 } }, parts: [] },
      { info: { ...make(["msg_a"])[0], time: { created: 3 } }, parts: [] },
    ]

    expect(visibleBeforeBoundary(items, "msg_boundary")).toEqual([])
    expect(visibleBeforeBoundary(items, "msg_boundary", undefined, { includeBoundary: true })).toEqual([])
  })

  test("visibleBeforeBoundary can include a part-level boundary message", () => {
    const items = [
      { info: { ...make(["msg_before"])[0], time: { created: 1 } }, parts: [] },
      { info: { ...make(["msg_boundary"])[0], time: { created: 2 } }, parts: [] },
      { info: { ...make(["msg_after"])[0], time: { created: 3 } }, parts: [] },
    ]

    expect(
      visibleBeforeBoundary(items, "msg_boundary", undefined, { includeBoundary: true }).map((item) => item.info.id),
    ).toEqual(["msg_before", "msg_boundary"])
  })

  test("visiblePartsBeforeBoundary trims parts from the boundary part onward", () => {
    const parts = [{ id: "part_1" }, { id: "part_2" }, { id: "part_3" }]

    expect(visiblePartsBeforeBoundary(parts, "part_2").map((part) => part.id)).toEqual(["part_1"])
    expect(visiblePartsBeforeBoundary(parts).map((part) => part.id)).toEqual(["part_1", "part_2", "part_3"])
  })

  test("part-level revert boundary shows its banner and retained message parts", () => {
    const boundary = { ...make(["msg_boundary"])[0], time: { created: 2 } }

    expect(revertMessageState(boundary, boundary.id, boundary, "part_2")).toEqual({
      showBanner: true,
      showMessage: true,
    })
  })

  test("whole-message revert boundary replaces the message with its banner", () => {
    const boundary = { ...make(["msg_boundary"])[0], time: { created: 2 } }

    expect(revertMessageState(boundary, boundary.id, boundary)).toEqual({ showBanner: true, showMessage: false })
    expect(revertMessageState(boundary, boundary.id)).toEqual({ showBanner: false, showMessage: false })
  })

  test("messageInsert uses chronological ordering", () => {
    const messages = [
      { ...make(["m2"])[0], time: { created: 20 } },
      { ...make(["m3"])[0], time: { created: 30 } },
    ]
    const result = messageInsert(messages, { ...make(["m1"])[0], time: { created: 10 } })
    expect(result).toEqual({ found: false, index: 0 })
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
    expect(olderScrollTarget([], 400, 400, 10)).toBeUndefined()
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
