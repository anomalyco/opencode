import { describe, expect, test } from "bun:test"
import { ErrorSummary } from "../../src/util/error-summary"

describe("ErrorSummary", () => {
  test("keeps the message and classification of each error in the cause chain", () => {
    const root = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:443"), { code: "ECONNREFUSED", errno: -61 })
    const error = new Error("Incompatible auth server: does not support dynamic client registration", { cause: root })
    expect(ErrorSummary.from(error)).toEqual([
      { type: "Error", message: "Incompatible auth server: does not support dynamic client registration" },
      { type: "Error", message: "connect ECONNREFUSED 127.0.0.1:443", code: "ECONNREFUSED", errno: -61 },
    ])
  })

  test("omits the stack and empty messages", () => {
    const summary = ErrorSummary.from(new Error(""))
    expect(summary).toEqual([{ type: "Error" }])
    expect(JSON.stringify(summary)).not.toContain("stack")
  })
})
