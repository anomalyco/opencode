import { expect, test } from "bun:test"
import { mkdtemp, readFile } from "fs/promises"
import { tmpdir } from "os"
import path from "path"
import { parsePinned, persistPinned, setPinned } from "../../src/context/local"
import { recentModels } from "../../src/model-preference"

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

test("pins and unpins without duplicating entries", () => {
  expect(setPinned(["a"], "b", true)).toEqual(["a", "b"])
  expect(setPinned(["a", "b"], "b", true)).toEqual(["a", "b"])
  expect(setPinned(["a", "b"], "a", false)).toEqual(["b"])
  expect(parsePinned({ pinned: ["a", 1, null, "b"] })).toEqual(["a", "b"])
  expect(parsePinned(undefined)).toEqual([])
})

test("concurrent pin writes do not erase each other", async () => {
  const file = path.join(await mkdtemp(path.join(tmpdir(), "opencode-pins-")), "session.json")

  await Promise.all([persistPinned(file, "a", true), persistPinned(file, "b", true), persistPinned(file, "c", true)])
  expect(parsePinned(JSON.parse(await readFile(file, "utf8"))).sort()).toEqual(["a", "b", "c"])

  expect(await persistPinned(file, "a", false)).toEqual(expect.arrayContaining(["b", "c"]))
  expect(parsePinned(JSON.parse(await readFile(file, "utf8"))).sort()).toEqual(["b", "c"])
})
