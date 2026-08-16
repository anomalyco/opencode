import { describe, expect, test } from "bun:test"
import { SessionV1 as Wire } from "@opencode-ai/schema/session-v1"
import { SessionV1 } from "../src/v1/session"

describe("legacy event schema compatibility", () => {
  test("Core references canonical SessionV1 definitions", () => {
    expect(SessionV1.Event.Created).toBe(Wire.Event.Created)
    expect(SessionV1.Event.PartUpdated).toBe(Wire.Event.PartUpdated)
  })

  test("Core retains NamedError constructor identity", () => {
    const error = new SessionV1.APIError({ message: "failed", isRetryable: false })
    expect(error).toBeInstanceOf(SessionV1.APIError)
    expect(error.toObject()).toEqual({ name: "APIError", data: { message: "failed", isRetryable: false } })
  })
})
