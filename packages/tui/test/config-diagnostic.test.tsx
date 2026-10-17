import { expect, test } from "bun:test"
import { createAppFixture } from "./fixture/app"
import { tmpdir } from "./fixture/fixture"
import path from "node:path"

test("renders the rejected CLI config warning in the TUI", async () => {
  await using setup = await createAppFixture({
    diagnostic: "Invalid CLI config at /tmp/cli.json: leader",
  })
  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("Invalid CLI config"))
  expect(setup.captureCharFrame()).toContain("leader")
})

test("does not render a config warning for valid settings", async () => {
  await using setup = await createAppFixture({ config: { animations: false, session: { sidebar: "hide" } } })
  await setup.ready
  await setup.renderOnce()
  expect(setup.captureCharFrame()).not.toContain("Invalid CLI config")
})

test("shows a live invalid file warning once and recovers on a valid reload", async () => {
  await using directory = await tmpdir()
  const file = path.join(directory.path, "cli.json")
  await Bun.write(file, JSON.stringify({ animations: false, mouse: false }))
  let diagnostic: string | undefined
  let reads = 0
  let checks = 0
  const service = {
    path: file,
    async get() {
      reads++
      const value = await Bun.file(file).json()
      diagnostic = typeof value.leader === "string" ? `Invalid CLI config at ${file}: leader. File ignored.` : undefined
      return diagnostic ? {} : value
    },
    diagnostic: () => {
      checks++
      return diagnostic
    },
    async update() {
      return {}
    },
  }
  await using setup = await createAppFixture({ service })
  await setup.ready
  await setup.renderOnce()
  expect(setup.captureCharFrame()).not.toContain("Invalid CLI config")

  await Bun.write(file, JSON.stringify({ animations: false, mouse: false, leader: "bad" }))
  await setup.waitForFrame((frame) => frame.includes("Invalid CLI config"), { maxPasses: 100 })
  expect(setup.captureCharFrame()).toContain("leader")
  const afterInvalid = reads

  await Bun.write(file, JSON.stringify({ animations: false, mouse: false, leader: "bad" }))
  await setup.waitForFrame(() => reads > afterInvalid, { maxPasses: 100 })
  expect(setup.captureCharFrame()).not.toContain("more")

  await Bun.write(file, JSON.stringify({ animations: false, mouse: true }))
  await setup.waitForFrame(() => diagnostic === undefined && reads > afterInvalid + 1, { maxPasses: 100 })
  await setup.waitForFrame((frame) => !frame.includes("Invalid CLI config"))

  await Bun.write(file, JSON.stringify({ animations: false, mouse: true, leader: "bad" }))
  await setup.waitForFrame((frame) => frame.includes("Invalid CLI config"), { maxPasses: 100 })
  setup.events.emit({
    id: "evt_other_toast",
    created: 1,
    type: "tui.toast.show",
    location: { directory: "/tmp/opencode/packages/tui" },
    data: { message: "Other notification", variant: "info", duration: 15_000 },
  })
  await setup.waitForFrame((frame) => frame.includes("Other notification"))
  const beforeRecovery = checks
  await Bun.write(file, JSON.stringify({ animations: false, mouse: true }))
  await setup.waitForFrame(() => checks > beforeRecovery && diagnostic === undefined, { maxPasses: 100 })
  await setup.renderOnce()
  expect(setup.captureCharFrame()).toContain("Other notification")
})
