import { describe, expect, test } from "bun:test"
import { Context } from "../../src/util/context"

describe("util.context", () => {
  test("use returns provided value within scope", () => {
    const userContext = Context.create<{ id: number }>("user")

    let seenId: number | undefined

    userContext.provide({ id: 123 }, () => {
      seenId = userContext.use().id
    })

    expect(seenId).toBe(123)
  })

  test("use throws NotFound outside of provided scope", () => {
    const ctx = Context.create<string>("test-context")

    expect(() => ctx.use()).toThrowError(Context.NotFound)
  })
})


