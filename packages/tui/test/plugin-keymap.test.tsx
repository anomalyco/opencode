import { InputRenderable } from "@opentui/core"
import { beforeEach, expect, test } from "bun:test"
import { mkdir, symlink } from "node:fs/promises"
import path from "node:path"
import { takeDraft } from "../src/component/prompt/draft-stash"
import { createAppFixture } from "./fixture/app"
import { tmpdir } from "./fixture/fixture"

type Fixture = Awaited<ReturnType<typeof createAppFixture>>

beforeEach(() => {
  takeDraft(undefined)
})

test("setup layers before and after await reach keyboard, palette, and slash across disable and enable", async () => {
  await using plugin = await copyPlugin()
  await using setup = await createAppFixture({ config: { animations: false, plugins: [plugin.directory] } })
  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("Fixture ready generation 1"))

  await search(setup, "Setup check")
  await setup.waitForFrame((frame) => frame.includes("Setup check 0"))
  setup.mockInput.pressEnter()
  await setup.waitForFrame((frame) => frame.includes("Setup keymap ran 1"))
  await search(setup, "Setup check")
  await setup.waitForFrame((frame) => frame.includes("Setup check 1"))
  setup.mockInput.pressEscape()

  setup.mockInput.pressKey("F9")
  await setup.waitForFrame((frame) => frame.includes("Sync keymap ran 1"))
  setup.mockInput.pressKey("g", { ctrl: true })
  await setup.waitForFrame((frame) => frame.includes("Setup keymap ran 2"))
  await setup.mockInput.typeText("/setup-check")
  await setup.waitForFrame((frame) => frame.includes("/setup-check"))
  setup.mockInput.pressEnter()
  await setup.waitForFrame((frame) => frame.includes("Setup keymap ran 3"))

  await openPlugin(setup)
  await setup.waitForFrame((frame) => frame.includes("disable"))
  setup.mockInput.pressEnter()
  await setup.waitForFrame((frame) => frame.includes("inactive"))
  setup.mockInput.pressEscape()
  setup.mockInput.pressKey("g", { ctrl: true })
  setup.mockInput.pressKey("F9")
  await search(setup, "Setup check")
  await setup.waitForFrame((frame) => frame.includes("No results found"))
  expect(setup.captureCharFrame()).not.toContain("Setup keymap ran 4")
  expect(setup.captureCharFrame()).not.toContain("Sync keymap ran 2")
  setup.mockInput.pressEscape()

  await openPlugin(setup)
  await setup.waitForFrame((frame) => frame.includes("inactive"))
  setup.mockInput.pressEnter()
  await setup.waitForFrame((frame) => frame.includes("Fixture ready generation 1"))
  setup.mockInput.pressEscape()
  setup.mockInput.pressKey("g", { ctrl: true })
  await setup.waitForFrame((frame) => frame.includes("Setup keymap ran 1"))
  setup.mockInput.pressKey("F9")
  await setup.waitForFrame((frame) => frame.includes("Sync keymap ran 1"))
})

test("a component layer ends when its component unmounts while the plugin stays active", async () => {
  await using plugin = await copyPlugin()
  await using setup = await createAppFixture({ config: { animations: false, plugins: [plugin.directory] } })
  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("Fixture ready generation 1"))

  setup.mockInput.pressKey("F8")
  await setup.waitForFrame((frame) => frame.includes("Fixture dialog"))
  setup.mockInput.pressKey("F11")
  await setup.waitForFrame((frame) => frame.includes("Dialog keymap ran 1"))
  setup.mockInput.pressEscape()
  await setup.waitForFrame((frame) => !frame.includes("Fixture dialog"))

  setup.mockInput.pressKey("g", { ctrl: true })
  await setup.waitForFrame((frame) => frame.includes("Setup keymap ran 1"))
  setup.mockInput.pressKey("F11")
  await Bun.sleep(100)
  await setup.renderOnce()
  expect(setup.captureCharFrame()).toContain("Setup keymap ran 1")
  expect(setup.captureCharFrame()).not.toContain("Dialog keymap ran 2")
})

test("a component layer ends with its activation on reload while the component stays mounted", async () => {
  await using plugin = await copyPlugin()
  await using setup = await createAppFixture({ config: { animations: false, plugins: [plugin.directory] } })
  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("Fixture ready generation 1"))

  setup.mockInput.pressKey("F8")
  await setup.waitForFrame((frame) => frame.includes("Fixture dialog"))
  setup.mockInput.pressKey("F11")
  await setup.waitForFrame((frame) => frame.includes("Dialog keymap ran 1"))

  await Bun.write(plugin.entry, (await Bun.file(plugin.entry).text()).replace("generation 1", "generation 2"))
  await setup.waitForFrame((frame) => frame.includes("Fixture ready generation 2"))
  setup.mockInput.pressKey("g", { ctrl: true })
  await setup.waitForFrame((frame) => frame.includes("Setup keymap ran 1"))
  setup.mockInput.pressKey("F11")
  await Bun.sleep(100)
  await setup.renderOnce()
  expect(setup.captureCharFrame()).toContain("Setup keymap ran 1")
  expect(setup.captureCharFrame()).toContain("Fixture dialog")
  expect(setup.captureCharFrame()).not.toContain("Dialog keymap ran 2")
})

test("failed setup reports batched layer errors and disposes earlier and later setup layers", async () => {
  await using plugin = await copyPlugin()
  await using setup = await createAppFixture({
    config: { animations: false, plugins: [{ package: plugin.directory, options: { fail: true } }] },
  })
  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("ctrl+p commands"))

  await openPlugin(setup)
  await setup.waitForFrame((frame) => frame.includes("view error"))
  setup.mockInput.pressKey(" ")
  await setup.waitForFrame((frame) => frame.includes("Palette commands require an ID"))
  setup.mockInput.pressEscape()
  setup.mockInput.pressEscape()

  await Bun.sleep(100)
  setup.mockInput.pressKey("F9")
  setup.mockInput.pressKey("F10")
  await Bun.sleep(100)
  await setup.renderOnce()
  expect(setup.captureCharFrame()).not.toContain("Sync keymap ran")
  expect(setup.captureCharFrame()).not.toContain("Late keymap ran")
})

async function copyPlugin() {
  const root = await tmpdir()
  const directory = path.join(root.path, "setup-keymap")
  const entry = path.join(directory, "tui.tsx")
  await mkdir(directory)
  await symlink(path.join(import.meta.dir, "../node_modules"), path.join(directory, "node_modules"))
  await Bun.write(entry, Bun.file(path.join(import.meta.dir, "fixture/plugin/setup-keymap/tui.tsx")))
  return { directory, entry, [Symbol.asyncDispose]: root[Symbol.asyncDispose] }
}

async function search(setup: Fixture, query: string) {
  setup.mockInput.pressKey("p", { ctrl: true })
  await setup.waitForFrame((frame) => frame.includes("Commands"))
  await setup.waitFor(() => setup.renderer.currentFocusedEditor instanceof InputRenderable)
  await setup.mockInput.typeText(query)
}

async function openPlugin(setup: Fixture) {
  await setup.mockInput.typeText("/plugins")
  await setup.waitForFrame((frame) => frame.includes("/plugins"))
  setup.mockInput.pressEnter()
  await setup.waitForFrame((frame) => frame.includes("fixture.setup-keymap"))
  await setup.waitFor(() => setup.renderer.currentFocusedEditor instanceof InputRenderable)
  await setup.mockInput.typeText("setup-keymap")
}
