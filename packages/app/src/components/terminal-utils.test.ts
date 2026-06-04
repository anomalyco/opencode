import { describe, expect, test } from "bun:test"
import { isPtyNotFoundError } from "./terminal-utils"

describe("isPtyNotFoundError", () => {
  test("detects raw PTY not found errors", () => {
    expect(isPtyNotFoundError({ name: "PtyNotFoundError", message: "PTY session not found: pty_123" })).toBe(true)
  })

  test("detects wrapped SDK errors", () => {
    expect(
      isPtyNotFoundError(
        new Error("PTY session not found: pty_123", {
          cause: {
            body: {
              name: "NotFoundError",
              data: { message: "PTY session not found: pty_123" },
            },
            status: 404,
          },
        }),
      ),
    ).toBe(true)
  })

  test("does not match unrelated not found errors", () => {
    expect(isPtyNotFoundError(new Error("Session not found: ses_123"))).toBe(false)
  })
})
