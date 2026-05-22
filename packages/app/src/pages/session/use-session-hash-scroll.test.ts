import { describe, expect, test, vi } from "bun:test"
import { applyNoHashScroll, createSessionScrollDefaultGuard } from "./use-session-hash-scroll-default"
import { messageIdFromHash } from "./message-id-from-hash"

describe("messageIdFromHash", () => {
  test("parses hash with leading #", () => {
    expect(messageIdFromHash("#message-abc123")).toBe("abc123")
  })

  test("parses raw hash fragment", () => {
    expect(messageIdFromHash("message-42")).toBe("42")
  })

  test("ignores non-message anchors", () => {
    expect(messageIdFromHash("#review-panel")).toBeUndefined()
  })
})

describe("applyNoHashScroll", () => {
  test("uses a pending message before restoring or forcing bottom", () => {
    const setPendingMessage = vi.fn()
    const restoreScroll = vi.fn(() => true)
    const forceScrollToBottom = vi.fn()

    const next = applyNoHashScroll({
      sessionKey: "session",
      pendingKey: "",
      pendingMessage: undefined,
      consumePendingMessage: () => "message-1",
      setPendingMessage,
      restoreScroll,
      forceScrollToBottom,
      scroller: () => undefined,
      scheduleScrollState: () => {},
    })

    expect(next).toEqual({ pendingKey: "session", result: "pending" })
    expect(setPendingMessage).toHaveBeenCalledWith("message-1")
    expect(restoreScroll).not.toHaveBeenCalled()
    expect(forceScrollToBottom).not.toHaveBeenCalled()
  })

  test("uses generic restore before forcing bottom", () => {
    const restoreScroll = vi.fn(() => true)
    const forceScrollToBottom = vi.fn()

    const next = applyNoHashScroll({
      sessionKey: "session",
      pendingKey: "",
      pendingMessage: undefined,
      consumePendingMessage: () => undefined,
      setPendingMessage: () => {},
      restoreScroll,
      forceScrollToBottom,
      scroller: () => undefined,
      scheduleScrollState: () => {},
    })

    expect(next).toEqual({ pendingKey: "session", result: "restored" })
    expect(restoreScroll).toHaveBeenCalledTimes(1)
    expect(forceScrollToBottom).not.toHaveBeenCalled()
  })

  test("forces bottom when generic restore cannot restore", () => {
    const restoreScroll = vi.fn(() => false)
    const markProgrammaticScroll = vi.fn()
    const forceScrollToBottom = vi.fn()

    const next = applyNoHashScroll({
      sessionKey: "session",
      pendingKey: "",
      pendingMessage: undefined,
      consumePendingMessage: () => undefined,
      setPendingMessage: () => {},
      restoreScroll,
      markProgrammaticScroll,
      forceScrollToBottom,
      scroller: () => undefined,
      scheduleScrollState: () => {},
    })

    expect(next).toEqual({ pendingKey: "session", result: "bottom" })
    expect(restoreScroll).toHaveBeenCalledTimes(1)
    expect(markProgrammaticScroll).toHaveBeenCalledTimes(1)
    expect(forceScrollToBottom).toHaveBeenCalledTimes(1)
  })

  test("does not rerun generic restore after the session already consumed default scroll", () => {
    const restoreScroll = vi.fn(() => true)
    const forceScrollToBottom = vi.fn()

    const next = applyNoHashScroll({
      sessionKey: "session",
      pendingKey: "session",
      pendingMessage: undefined,
      consumePendingMessage: () => undefined,
      setPendingMessage: () => {},
      canRestoreScroll: () => false,
      restoreScroll,
      forceScrollToBottom,
      scroller: () => undefined,
      scheduleScrollState: () => {},
    })

    expect(next).toEqual({ pendingKey: "session", result: "skipped" })
    expect(restoreScroll).not.toHaveBeenCalled()
    expect(forceScrollToBottom).not.toHaveBeenCalled()
  })

  test("defers fallback when generic restore is not ready", () => {
    const restoreScroll = vi.fn(() => undefined)
    const forceScrollToBottom = vi.fn()

    const next = applyNoHashScroll({
      sessionKey: "session",
      pendingKey: "",
      pendingMessage: undefined,
      consumePendingMessage: () => undefined,
      setPendingMessage: () => {},
      restoreScroll,
      forceScrollToBottom,
      scroller: () => undefined,
      scheduleScrollState: () => {},
    })

    expect(next).toEqual({ pendingKey: "session", result: "deferred" })
    expect(restoreScroll).toHaveBeenCalledTimes(1)
    expect(forceScrollToBottom).not.toHaveBeenCalled()
  })
})

describe("createSessionScrollDefaultGuard", () => {
  test("allows restore again after leaving to the no-id route and returning", () => {
    const guard = createSessionScrollDefaultGuard()

    guard.consumeDefault({ sessionKey: "workspace/session-a", sessionID: "session-a" })
    guard.enter({ sessionKey: "workspace", sessionID: undefined })

    expect(guard.canRestore({ sessionKey: "workspace/session-a", sessionID: "session-a" })).toBe(true)
  })

  test("allows restore again after visiting another unconsumed session entry", () => {
    const guard = createSessionScrollDefaultGuard()

    guard.consumeDefault({ sessionKey: "workspace/session-a", sessionID: "session-a" })
    guard.enter({ sessionKey: "workspace/session-b", sessionID: "session-b" })

    expect(guard.canRestore({ sessionKey: "workspace/session-a", sessionID: "session-a" })).toBe(true)
    expect(guard.shouldRetry({ sessionKey: "workspace/session-a", sessionID: "session-a" })).toBe(false)
  })

  test("skips stale restore after hash clearing within the same session entry", () => {
    const guard = createSessionScrollDefaultGuard()

    guard.consumeDefault({ sessionKey: "workspace/session-a", sessionID: "session-a" })

    expect(guard.canRestore({ sessionKey: "workspace/session-a", sessionID: "session-a" })).toBe(false)
  })

  test("resets retry and save gates on route entry changes", () => {
    const guard = createSessionScrollDefaultGuard()

    guard.deferRestore({ sessionKey: "workspace/session-a", sessionID: "session-a" })
    expect(guard.shouldRetry({ sessionKey: "workspace/session-a", sessionID: "session-a" })).toBe(true)
    expect(guard.canSave({ sessionKey: "workspace/session-a", sessionID: "session-a" })).toBe(true)

    guard.enter({ sessionKey: "workspace", sessionID: undefined })

    expect(guard.shouldRetry({ sessionKey: "workspace/session-a", sessionID: "session-a" })).toBe(false)
    expect(guard.canSave({ sessionKey: "workspace/session-a", sessionID: "session-a" })).toBe(false)
  })
})
