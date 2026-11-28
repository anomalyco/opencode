import { expect, test } from "bun:test"
import { createAppFixture } from "./fixture/app"

test("shows the CLI config warning when the TUI starts", async () => {
  const warning = "Invalid setting in cli.json (leader)"
  await using app = await createAppFixture({ configWarning: warning })
  await app.ready
  await app.waitForFrame((frame) => frame.includes("commands"))
  expect(app.captureCharFrame()).toContain(warning)
})

test("shows both config and model warnings at startup", async () => {
  const warning = "Invalid setting in cli.json (leader)"
  await using app = await createAppFixture({ configWarning: warning, args: { model: "invalid-model" } })
  await app.ready
  const frame = await app.waitForFrame((frame) => frame.includes("Invalid model format: invalid-model"))
  expect(frame).toContain(warning)
})
