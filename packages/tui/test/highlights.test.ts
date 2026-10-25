import { expect, test } from "bun:test"
import { readFileSync } from "fs"
import path from "path"
import { createStorage } from "../src/context/storage"
import { claim, decide } from "../src/util/highlights"
import { tmpdir } from "./fixture/fixture"

const input = { version: "2.0.27", count: 5, history: true }

test("first run shows highlights to existing users and records new installs silently", () => {
  expect(decide(input)).toBe("show")
  expect(decide({ ...input, history: false })).toBe("record")
  expect(decide({ ...input, count: 0 })).toBe("record")
})

test("newer versions show highlights or record silently when there are none", () => {
  expect(decide({ ...input, seen: "2.0.26" })).toBe("show")
  expect(decide({ ...input, seen: "1.99.99", history: false })).toBe("show")
  expect(decide({ ...input, seen: "2.0.26", count: 0 })).toBe("record")
})

test("the same version, downgrades, and unstable versions do nothing", () => {
  expect(decide({ ...input, seen: "2.0.27" })).toBe("none")
  expect(decide({ ...input, seen: "2.0.28" })).toBe("none")
  expect(decide({ ...input, seen: "2.1.0", version: "2.0.30" })).toBe("none")
  expect(decide({ ...input, version: "0.0.0-dev-123" })).toBe("none")
  expect(decide({ ...input, version: "local" })).toBe("none")
})

test("only one of several concurrent TUIs claims the highlights", async () => {
  await using temporary = await tmpdir()
  const storages = Array.from({ length: 4 }, () => createStorage(temporary.path, "latest"))
  try {
    const results = await Promise.all(storages.map((item) => claim(item.storage, input)))
    expect(results.filter(Boolean)).toHaveLength(1)
    expect(JSON.parse(readFileSync(path.join(temporary.path, "latest", "tui", "highlights.json"), "utf8"))).toEqual({
      seen: "2.0.27",
    })
    expect(await claim(storages[0].storage, input)).toBe(false)
  } finally {
    storages.forEach((item) => item.close())
  }
})
