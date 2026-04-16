import { describe, expect, test } from "bun:test"
import { done, fit, pipe, pull, push } from "./browser-stream"

describe("pipe", () => {
  test("keeps only the latest queued item while busy", () => {
    const slot = pipe<number>()

    push(slot, 1)
    expect(pull(slot)).toBe(1)

    push(slot, 2)
    push(slot, 3)
    expect(done(slot)).toBe(3)
    expect(done(slot)).toBeUndefined()
  })
})

describe("fit", () => {
  test("rejects mismatched sizes while hold is active", () => {
    const hold = { width: 800, height: 600, until: 100 }
    const hit = fit(hold, 1024, 768, 10)

    expect(hit.ok).toBe(false)
    expect(hit.hold).toEqual(hold)
  })

  test("clears hold on matching frame sizes", () => {
    const hold = { width: 800, height: 600, until: 100 }
    const hit = fit(hold, 802, 603, 10)

    expect(hit.ok).toBe(true)
    expect(hit.hold).toBeUndefined()
  })

  test("keeps hold on matching status sizes when clear is disabled", () => {
    const hold = { width: 800, height: 600, until: 100 }
    const hit = fit(hold, 800, 600, 10, false)

    expect(hit.ok).toBe(true)
    expect(hit.hold).toEqual(hold)
  })

  test("expires stale holds", () => {
    const hold = { width: 800, height: 600, until: 100 }
    const hit = fit(hold, undefined, undefined, 101)

    expect(hit.ok).toBe(true)
    expect(hit.hold).toBeUndefined()
  })
})
