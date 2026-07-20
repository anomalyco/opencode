import { describe, expect, test } from "bun:test"
import { RequestError } from "@agentclientprotocol/sdk"
import { ACPError } from "../../src/acp/error"

describe("acp errors", () => {
  test("maps validation failures to invalid params", () => {
    const errors: ACPError.Error[] = [
      new ACPError.SessionNotFoundError({ sessionId: "ses_missing" }),
      new ACPError.InvalidConfigOptionError({ configId: "temperature" }),
      new ACPError.InvalidModelError({ modelId: "missing" }),
      new ACPError.InvalidEffortError({ effort: "extreme" }),
      new ACPError.InvalidModeError({ mode: "turbo" }),
    ]
    expect(errors.map((error) => ACPError.toRequestError(error).code)).toEqual([-32602, -32602, -32602, -32602, -32602])
  })

  test("maps auth and service failures safely", () => {
    const auth = ACPError.toRequestError(new ACPError.AuthRequiredError())
    expect(auth).toBeInstanceOf(RequestError)
    expect(auth.code).toBe(-32000)

    const internal = ACPError.toRequestError(ACPError.fromUnknown(new Error("secret token"), "session"))
    expect(internal.code).toBe(-32603)
    expect(JSON.stringify(internal.toErrorResponse())).not.toContain("secret token")
  })
})
