import { expect, test } from "bun:test"
import { mkdtemp } from "fs/promises"
import { tmpdir } from "os"
import path from "path"
import { parseModel, parsePinned, persistPinned, recentModels, setPinned } from "../../src/context/local"
import { readJson } from "../../src/util/persistence"

test("parses model IDs containing slashes", () => {
  expect(parseModel("provider/family/model")).toEqual({
    providerID: "provider",
    modelID: "family/model",
  })
})

test("moves a model to the front, deduplicates, and limits recents", () => {
  const recent = Array.from({ length: 12 }, (_, index) => ({
    providerID: "provider",
    modelID: `model-${index}`,
  }))

  expect(recentModels({ providerID: "provider", modelID: "model-5" }, recent)).toEqual([
    { providerID: "provider", modelID: "model-5" },
    ...recent.slice(0, 5),
    ...recent.slice(6, 10),
  ])
})

test("parses only string entries out of a stored pin list", () => {
  expect(parsePinned({ pinned: ["a", 1, null, "b"] })).toEqual(["a", "b"])
  expect(parsePinned({ pinned: "a" })).toEqual([])
  expect(parsePinned(undefined)).toEqual([])
})

test("pins and unpins without duplicating entries", () => {
  expect(setPinned(["a"], "b", true)).toEqual(["a", "b"])
  expect(setPinned(["a", "b"], "b", true)).toEqual(["a", "b"])
  expect(setPinned(["a", "b"], "a", false)).toEqual(["b"])
  expect(setPinned(["a"], "b", false)).toEqual(["a"])
})

async function pinDir() {
  const dir = await mkdtemp(path.join(tmpdir(), "opencode-pins-"))
  return { file: path.join(dir, "session.json"), options: { dir: path.join(dir, "locks") } }
}

test("a pin written by another instance survives a later write", async () => {
  const { file, options } = await pinDir()

  await persistPinned(file, "a", true, options)
  // Another TUI pins "b" while this instance still believes the list is just ["a"].
  await persistPinned(file, "b", true, options)

  expect(await persistPinned(file, "c", true, options)).toEqual(["a", "b", "c"])
  expect(parsePinned(await readJson(file))).toEqual(["a", "b", "c"])
})

test("concurrent pin writes do not erase each other", async () => {
  const { file, options } = await pinDir()

  await Promise.all([
    persistPinned(file, "a", true, options),
    persistPinned(file, "b", true, options),
    persistPinned(file, "c", true, options),
  ])

  expect(parsePinned(await readJson(file)).sort()).toEqual(["a", "b", "c"])
})

test("unpinning removes only the target session", async () => {
  const { file, options } = await pinDir()

  await persistPinned(file, "a", true, options)
  await persistPinned(file, "b", true, options)

  expect(await persistPinned(file, "a", false, options)).toEqual(["b"])
  expect(parsePinned(await readJson(file))).toEqual(["b"])
})
