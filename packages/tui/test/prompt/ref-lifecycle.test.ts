import { describe, test, expect } from "bun:test"
import { makeGuardedAccessors } from "../../src/prompt/display"

describe("makeGuardedAccessors (retained-ref lifecycle guards)", () => {
  const live = () => {
    const calls: string[] = []
    const input: any = {
      isDestroyed: false,
      plainText: "hello world",
      getTextRange: (a: number, b: number) => `range:${a}-${b}`,
      extmarks: { create: () => 1, clear: () => calls.push("ex.clear") },
      cursorOffset: 0,
      setSelection: () => calls.push("setSelection"),
      insertText: () => calls.push("insertText"),
      clearSelection: () => calls.push("clearSelection"),
      clear: () => calls.push("clear"),
    }
    return { input, calls }
  }

  test("live input: methods delegate", () => {
    const { input, calls } = live()
    const acc = makeGuardedAccessors(() => input)
    expect(acc.text()).toBe("hello world")
    expect(acc.getTextRange(1, 4)).toBe("range:1-4")
    expect(acc.extmarks.create({} as any)).toBe(1) // extmarks is the SafeExtmarks facade (a property)
    acc.reset()
    expect(calls).toContain("clear")     // input.clear()
    expect(calls).toContain("ex.clear")  // input.extmarks.clear()
  })

  test("destroyed input: read methods no-op safely, no throw", () => {
    const { input, calls } = live()
    input.isDestroyed = true
    const acc = makeGuardedAccessors(() => input)
    expect(acc.text()).toBe("")
    expect(acc.getTextRange(1, 4)).toBe("")
    expect(() => acc.replaceRange(0, 1, "x")).not.toThrow()
    expect(() => acc.reset()).not.toThrow()
    expect(acc.extmarks.create({} as any)).toBe(-1) // facade method no-ops to its fallback
    expect(calls).toEqual([]) // nothing touched the destroyed input
  })

  test("undefined input (never mounted): no-op safely", () => {
    const acc = makeGuardedAccessors(() => undefined)
    expect(acc.text()).toBe("")
    expect(() => acc.replaceRange(0, 1, "x")).not.toThrow()
    expect(() => acc.reset()).not.toThrow()
    expect(acc.extmarks.getAll()).toEqual([]) // facade defined even when never mounted
  })
})
