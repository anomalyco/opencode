import { describe, expect, test } from "bun:test"
import { createPromptRefContextValue } from "../../src/context/prompt"

describe("prompt ref context", () => {
  test("set/current round-trips", () => {
    const ctx = createPromptRefContextValue()
    expect(ctx.current).toBeUndefined()
    const fake = { marker: "fake-ref" } as never
    ctx.set(fake)
    expect(ctx.current).toBe(fake)
    ctx.set(undefined)
    expect(ctx.current).toBeUndefined()
  })

  test("onChange subscribers fire on emitChange and dispose cleanly", () => {
    const ctx = createPromptRefContextValue()
    let calls = 0
    const dispose = ctx.onChange(() => {
      calls += 1
    })
    ctx.emitChange()
    ctx.emitChange()
    expect(calls).toBe(2)
    dispose()
    ctx.emitChange()
    expect(calls).toBe(2)
  })

  test("onCursorChange subscribers fire on emitCursorChange and dispose cleanly", () => {
    const ctx = createPromptRefContextValue()
    let calls = 0
    const dispose = ctx.onCursorChange(() => {
      calls += 1
    })
    ctx.emitCursorChange()
    ctx.emitCursorChange()
    expect(calls).toBe(2)
    dispose()
    ctx.emitCursorChange()
    expect(calls).toBe(2)
  })

  test("change and cursor subscriptions are independent", () => {
    const ctx = createPromptRefContextValue()
    let contentCalls = 0
    let cursorCalls = 0
    ctx.onChange(() => {
      contentCalls += 1
    })
    ctx.onCursorChange(() => {
      cursorCalls += 1
    })
    ctx.emitChange()
    expect(contentCalls).toBe(1)
    expect(cursorCalls).toBe(0)
    ctx.emitCursorChange()
    expect(contentCalls).toBe(1)
    expect(cursorCalls).toBe(1)
  })

  test("a throwing subscriber does not break the others", () => {
    const ctx = createPromptRefContextValue()
    let contentCalled = false
    let cursorCalled = false
    ctx.onChange(() => {
      throw new Error("bad content subscriber")
    })
    ctx.onChange(() => {
      contentCalled = true
    })
    ctx.onCursorChange(() => {
      throw new Error("bad cursor subscriber")
    })
    ctx.onCursorChange(() => {
      cursorCalled = true
    })
    expect(() => ctx.emitChange()).not.toThrow()
    expect(contentCalled).toBe(true)
    expect(() => ctx.emitCursorChange()).not.toThrow()
    expect(cursorCalled).toBe(true)
  })

  test("nested emit calls from within a subscriber are dropped (reentrancy guard)", () => {
    const ctx = createPromptRefContextValue()
    let innerCalls = 0
    const dispose = ctx.onChange(() => {
      innerCalls += 1
      ctx.emitChange()
      ctx.emitCursorChange()
    })
    ctx.emitChange()
    expect(innerCalls).toBe(1)
    dispose()
  })
})
