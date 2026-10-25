import { expect, test } from "bun:test"
import { alive } from "../src/service-probe"

test("reports a live process and rejects a missing or unusable pid", async () => {
  expect(alive(process.pid)).toBe(true)

  const exited = Bun.spawn([process.execPath, "-e", ""])
  await exited.exited
  expect(alive(exited.pid)).toBe(false)

  // `process.kill(0, ...)` would target this process group instead of a service.
  expect(alive(0)).toBe(false)
  expect(alive(-1)).toBe(false)
})
