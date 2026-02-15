import { describe, expect, test } from "bun:test"
import { Pending } from "../../src/pending"

describe("Pending.RejectedError", () => {
  test("default message contains 'rejected'", () => {
    const err = new Pending.RejectedError()
    expect(err.message).toContain("rejected")
  })

  test("custom message is preserved", () => {
    const msg = "Custom rejection reason"
    const err = new Pending.RejectedError(msg)
    expect(err.message).toBe(msg)
  })

  test("is instanceof Error", () => {
    const err = new Pending.RejectedError()
    expect(err instanceof Error).toBe(true)
  })
})

describe("Pending.Entry type", () => {
  test("Entry<Info, void> compiles and has correct shape", () => {
    const entry: Pending.Entry<{ id: string }, void> = {
      info: { id: "test-123" },
      resolve: () => {},
      reject: (e: any) => {},
    }
    expect(entry.info.id).toBe("test-123")
    expect(typeof entry.resolve).toBe("function")
    expect(typeof entry.reject).toBe("function")
  })

  test("Entry<Info, ResolveValue> compiles with custom resolve type", () => {
    const entry: Pending.Entry<{ id: string }, string[]> = {
      info: { id: "test-456" },
      resolve: (answers: string[]) => {},
      reject: (e: any) => {},
    }
    expect(entry.info.id).toBe("test-456")
    expect(typeof entry.resolve).toBe("function")
    expect(typeof entry.reject).toBe("function")
  })
})
