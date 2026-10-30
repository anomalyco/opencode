import { expect, test } from "bun:test"
import { abort } from "./abort.js"

test("aborts with an AbortError that does not record the caller's stack", () => {
  const controller = new AbortController()
  function disposeComponent() {
    abort(controller)
  }

  disposeComponent()

  expect(controller.signal.aborted).toBe(true)
  expect(controller.signal.reason).toBeInstanceOf(DOMException)
  expect(controller.signal.reason.name).toBe("AbortError")
  expect(String(controller.signal.reason.stack)).not.toContain("disposeComponent")
})
