import { expect, test } from "bun:test"
import { lockHeld } from "./instance-lock"

test("a packaged launch hands over to the running instance", () => {
  expect(lockHeld({ packaged: true }, "/data/ai.opencode.desktop.dev")).toEqual({ type: "handover" })
})

test("a source build refuses on one line that names the data folder and the way out", () => {
  const held = lockHeld({ packaged: false }, "/data/ai.opencode.desktop.dev")

  if (held.type !== "refused") throw new Error("expected a refusal")
  expect(held.message).toContain("/data/ai.opencode.desktop.dev")
  expect(held.message).toContain("OPENCODE_DESKTOP_TEST_ROOT")
  expect(held.message).not.toContain("\n")
})
