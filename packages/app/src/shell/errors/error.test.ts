import { describe, expect, test } from "bun:test"
import { formatError } from "./error"

const t = (key: string) => (key === "error.chain.causedBy" ? "Caused by:" : key)

describe("formatError", () => {
  test("walks a cause chain that crossed IPC as plain objects instead of printing it as JSON", () => {
    const error = new Error("Desktop IPC handler failed", {
      cause: { name: "TypeError", message: "outer", cause: { name: "Error", message: "inner" } },
    })

    error.stack = "Error: Desktop IPC handler failed\n    at handler (main.js:1:1)"

    const text = formatError(error, t)

    expect(text).toContain("Error: Desktop IPC handler failed\n    at handler (main.js:1:1)")
    expect(text).toContain("Caused by:\nTypeError: outer")
    expect(text).toContain("Caused by:\nError: inner")
    expect(text).not.toContain("{")
  })

  test("shows the error Effect.tryPromise wrapped instead of the wrapper", () => {
    const error = new Error("Desktop IPC handler failed", {
      cause: {
        name: "UnknownError",
        message: "An error occurred in Effect.tryPromise",
        cause: { name: "Error", message: "Server process exited with code 1" },
      },
    })

    error.stack = undefined

    const text = formatError(error, t)

    expect(text).toContain("Caused by:\nError: Server process exited with code 1")
    expect(text).not.toContain("UnknownError")
    expect(text).not.toContain("Effect.tryPromise")
  })

  test("keeps an UnknownError with its own message", () => {
    const text = formatError({ name: "UnknownError", message: "disk full", cause: "ENOSPC" }, t)

    expect(text).toContain("UnknownError: disk full")
    expect(text).toContain("Caused by:\nENOSPC")
  })

  test("still prints an object without a message as JSON", () => {
    expect(formatError(new Error("failed", { cause: { code: 3 } }), t)).toContain('"code": 3')
  })
})
