import { expect, test } from "bun:test"
import { createAppFixture } from "./fixture/app"
import { tmpdir } from "./fixture/fixture"

test("a storage failure shows an error toast with its reason", async () => {
  await using state = await tmpdir()
  await using setup = await createAppFixture({ state: state.path })
  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("commands"))

  setup.events.emit({
    id: "evt_storage_failed",
    created: 1,
    type: "storage.failed",
    data: { message: "Storage error: database or disk is full" },
  })
  await setup.waitForFrame((frame) => frame.replace(/\s+/g, " ").includes("database or disk is full"))
  expect(setup.captureCharFrame()).toContain("Can't save to disk")
})
