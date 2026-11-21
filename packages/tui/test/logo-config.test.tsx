import { expect, test } from "bun:test"
import { createAppFixture } from "./fixture/app"

// The first row of the built-in home logo.
const BUILT_IN_LOGO = "█▀▀█ █▀▀█ █▀▀█ █▀▀▄"

test("logo lines from the config replace the built-in home logo", async () => {
  await using setup = await createAppFixture({
    config: { animations: false, logo: ["ACME CODE", "internal build"] },
  })
  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("ACME CODE") && frame.includes("internal build"))
  expect(setup.captureCharFrame()).not.toContain(BUILT_IN_LOGO)
})

test("logo false hides the home logo and keeps the home screen", async () => {
  await using setup = await createAppFixture({ config: { animations: false, logo: false } })
  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("ctrl+p commands"))
  expect(setup.captureCharFrame()).not.toContain(BUILT_IN_LOGO)
})

test("without a logo setting the built-in home logo is shown", async () => {
  await using setup = await createAppFixture({ config: { animations: false } })
  await setup.ready
  await setup.waitForFrame((frame) => frame.includes(BUILT_IN_LOGO))
})

test("custom logo lines render as plain text", async () => {
  await using setup = await createAppFixture({ config: { animations: false, logo: ["acme_code, v1 ^~"] } })
  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("acme_code, v1 ^~"))
})

test("a custom logo wider than the terminal is hidden", async () => {
  const wide = "ACME".repeat(20)
  await using setup = await createAppFixture({ width: 60, config: { animations: false, logo: [wide] } })
  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("ctrl+p"))
  const frame = setup.captureCharFrame()
  expect(frame).not.toContain("ACMEACME")
  expect(frame).not.toContain(BUILT_IN_LOGO)
})
