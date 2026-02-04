import { describe, expect, test } from "bun:test"
import { BrokerClient } from "../../src/auth/broker-client"

describe("BrokerClient PTY error mapping", () => {
  const client = new BrokerClient()
  const mapError = (client as unknown as { mapPtyError: (error?: string) => string }).mapPtyError

  test("maps pty_closed", () => {
    expect(mapError("pty_closed")).toBe("pty_closed")
    expect(mapError("PTY_CLOSED")).toBe("pty_closed")
    expect(mapError("write failed: Input/output error (os error 5)")).toBe("pty_closed")
    expect(mapError("i/o error")).toBe("pty_closed")
    expect(mapError("broken pipe")).toBe("pty_closed")
  })

  test("maps session not found", () => {
    expect(mapError("PTY session not found")).toBe("pty_session_not_found")
    expect(mapError("session not found")).toBe("pty_session_not_found")
  })

  test("maps broker unavailable signals", () => {
    expect(mapError("socket not found")).toBe("broker_unavailable")
    expect(mapError("connection closed")).toBe("broker_unavailable")
    expect(mapError("broker unavailable")).toBe("broker_unavailable")
  })

  test("maps unknown errors", () => {
    expect(mapError(undefined)).toBe("unknown")
    expect(mapError("some other error")).toBe("unknown")
  })
})
