import { describe, expect, test } from "bun:test"
import { payload } from "../../src/push"

describe("push payload", () => {
  test("builds deep link for completed root session", () => {
    const result = payload({
      kind: "turn-complete",
      session: {
        id: "ses_123",
        directory: "/tmp/demo",
        title: "Demo session",
      },
    })

    expect(result.title).toBe("Response ready")
    expect(result.body).toBe("Demo session")
    expect(result.data.sessionID).toBe("ses_123")
    expect(result.data.href).toContain("/session/ses_123")
  })

  test("prefers explicit error message for failed sessions", () => {
    const result = payload({
      kind: "error",
      error: { message: "provider timeout" },
      session: {
        id: "ses_456",
        directory: "/tmp/demo",
        title: "Broken session",
      },
    })

    expect(result.title).toBe("Session error")
    expect(result.body).toBe("provider timeout")
    expect(result.tag).toBe("session:ses_456:error")
  })
})
