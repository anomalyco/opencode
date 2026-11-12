import { expect, test } from "bun:test"
import { existsSync } from "node:fs"
import path from "node:path"
import { Flock } from "@opencode/util/flock"
import { createAppFixture } from "./fixture/app"
import { tmpdir } from "./fixture/fixture"

test("stashing keeps the composer intact until the write completes", async () => {
  await using state = await tmpdir()
  await using setup = await createAppFixture({
    state: state.path,
    config: { animations: false, keybinds: { "prompt.stash": "f6" } },
  })
  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("commands"))
  setup.renderer.currentFocusedEditor?.clear()
  await setup.mockInput.typeText("alpha")
  await setup.waitForFrame((frame) => frame.includes("alpha"))

  const editor = setup.renderer.currentFocusedEditor
  expect(editor?.plainText).toBe("alpha")
  const file = path.join(state.path, "tui", "prompt-stash.json")
  await until(() => existsSync(file))
  const lock = await Flock.acquire(file, { dir: path.join(state.path, "locks") })
  try {
    setup.mockInput.pressKey("F6")
    await setup.waitForFrame((frame) => frame.includes("commands"))
    expect(editor?.plainText).toBe("alpha")
  } finally {
    await lock.release()
  }

  await setup.waitFor(() => editor?.plainText === "")
  const saved = await Bun.file(file).json()
  expect(saved.entries.map((entry: { prompt: { text: string } }) => entry.prompt.text)).toEqual(["alpha"])
})

async function until(predicate: () => boolean) {
  const deadline = Date.now() + 2_000
  while (Date.now() < deadline) {
    if (predicate()) return
    await Bun.sleep(10)
  }
  expect(predicate()).toBe(true)
}
