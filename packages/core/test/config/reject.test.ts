import { describe, expect, test } from "bun:test"
import { Result } from "effect"
import { ConfigReject } from "../../src/config/reject.js"

describe("ConfigReject", () => {
  test("accepts a valid normalized document", () => {
    const decoded = ConfigReject.decodeInfoOrReason({ shell: "bash" })
    expect(Result.isSuccess(decoded)).toBe(true)
    if (Result.isSuccess(decoded)) expect(decoded.success.shell).toBe("bash")
  })

  test("names the failing field when the final decode rejects a document", () => {
    const decoded = ConfigReject.decodeInfoOrReason({ model: 42 })
    expect(Result.isFailure(decoded)).toBe(true)
    if (Result.isFailure(decoded)) expect(decoded.failure).toBe("configuration is not valid: model")
  })

  test("falls back to a generic reason when no field can be named", () => {
    const decoded = ConfigReject.decodeInfoOrReason(null)
    expect(Result.isFailure(decoded)).toBe(true)
    if (Result.isFailure(decoded)) expect(decoded.failure).toBe("configuration is not valid")
  })
})
