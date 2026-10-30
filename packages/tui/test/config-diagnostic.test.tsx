import { expect, test } from "bun:test"
import type { Interface } from "../src/config"
import { createAppFixture } from "./fixture/app"
import { tmpdir } from "./fixture/fixture"
import path from "node:path"

function configService(file: string): Interface {
  let diagnostic: string | undefined
  return {
    path: file,
    async get() {
      const value = await Bun.file(file).json()
      diagnostic = typeof value.leader === "string" ? `Invalid CLI config at ${file}: leader. File ignored.` : undefined
      return diagnostic ? {} : value
    },
    diagnostic: () => diagnostic,
    async update() {
      return {}
    },
  }
}

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

test("shows a live invalid file warning and clears it after a valid edit", async () => {
  await using directory = await tmpdir()
  const file = path.join(directory.path, "cli.json")
  await Bun.write(file, JSON.stringify({ animations: false, mouse: false }))
  await using setup = await createAppFixture({ service: configService(file) })
  await setup.ready
  await setup.renderOnce()
  expect(setup.captureCharFrame()).not.toContain("Invalid CLI config")

  await Bun.write(file, JSON.stringify({ animations: false, mouse: false, leader: "bad" }))
  await setup.waitForFrame((frame) => frame.includes("Invalid CLI config"), { maxPasses: 100 })
  expect(setup.captureCharFrame()).toContain("leader")

  await Bun.write(file, JSON.stringify({ animations: false, mouse: true }))
  await setup.waitForFrame((frame) => !frame.includes("Invalid CLI config"), { maxPasses: 100 })
})

test("keeps an unrelated toast when the config warning clears", async () => {
  await using directory = await tmpdir()
  const file = path.join(directory.path, "cli.json")
  await Bun.write(file, JSON.stringify({ animations: false, leader: "bad" }))
  const service = configService(file)
  await using setup = await createAppFixture({ service })
  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("Invalid CLI config"))

  setup.events.emit({
    id: "evt_other_toast",
    created: 1,
    type: "tui.toast.show",
    location: { directory: "/tmp/opencode/packages/tui" },
    data: { message: "Other notification", variant: "info", duration: 15_000 },
  })
  await setup.waitForFrame((frame) => frame.includes("Other notification"))
  await Bun.write(file, JSON.stringify({ animations: false }))
  await setup.waitForFrame((frame) => service.diagnostic?.() === undefined && frame.includes("Other notification"), {
    maxPasses: 100,
  })
})
