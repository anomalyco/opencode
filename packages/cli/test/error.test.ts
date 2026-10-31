import { expect, test } from "bun:test"
import { Cause, Effect, Exit } from "effect"
import { errorReported } from "effect/Runtime"
import { formatCause } from "../src/util/error"

test("startup failures show the reason and recovery instruction without internal frames", async () => {
  const message =
    "Managed service port 49374 on 127.0.0.1 is already in use by another process. " +
    "Configure another port with `opencode service set port <port>` and start the service again."
  const ensure = Effect.fn("service.ensure")(function* () {
    return yield* Effect.fail(new Error(message))
  })
  const result = await Effect.runPromiseExit(ensure())
  expect(Exit.isFailure(result)).toBe(true)
  if (Exit.isFailure(result)) expect(formatCause(result.cause)).toBe(message)
})

test("startup failures preserve child process diagnostics", () => {
  const message = "Server process exited with code 1\nManaged service port 49374 is already in use"
  expect(formatCause(Cause.fail(new Error(message)))).toBe(message)
})

test("string failures remain readable", () => {
  expect(formatCause(Cause.fail("Failed to start server"))).toBe("Failed to start server")
})

test("unexpected defects keep their diagnostic stack", () => {
  const cause = Cause.die(new Error("unexpected failure"))
  expect(formatCause(cause)).toBe(Cause.pretty(cause))
})

test("interruptions and already handled errors stay silent", () => {
  expect(formatCause(Cause.interrupt())).toBeUndefined()
  const error = Object.assign(new Error("already displayed"), { [errorReported]: false })
  expect(formatCause(Cause.fail(error))).toBeUndefined()
})

test("nested startup failures retain the underlying reason", () => {
  const cause = Cause.fail(new Error("Failed to start server", { cause: new Error("spawn opencode ENOENT") }))
  expect(formatCause(cause)).toBe("Failed to start server\nspawn opencode ENOENT")
})

test("multiple failures are retained", () => {
  const cause = Cause.combine(Cause.fail(new Error("first failure")), Cause.fail(new Error("second failure")))
  expect(formatCause(cause)).toBe("first failure\nsecond failure")
})

test("errors without messages do not disappear", () => {
  expect(formatCause(Cause.fail(new Error()))).toBe("Error")
})
