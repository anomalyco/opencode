import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Memory } from "@/diagnostic/memory"
import { tmpdir } from "../fixture/fixture"

describe("memory retention", () => {
  test("keeps only newest snapshot directories", async () => {
    await using tmp = await tmpdir()
    const one = path.join(tmp.path, "one")
    const two = path.join(tmp.path, "two")
    const three = path.join(tmp.path, "three")

    await fs.mkdir(one, { recursive: true })
    await fs.mkdir(two, { recursive: true })
    await fs.mkdir(three, { recursive: true })
    await fs.writeFile(path.join(one, "meta.json"), "{}")
    await fs.writeFile(path.join(two, "meta.json"), "{}")
    await fs.writeFile(path.join(three, "meta.json"), "{}")
    await fs.utimes(one, new Date("2026-03-01T00:00:00Z"), new Date("2026-03-01T00:00:00Z"))
    await fs.utimes(two, new Date("2026-03-02T00:00:00Z"), new Date("2026-03-02T00:00:00Z"))
    await fs.utimes(three, new Date("2026-03-03T00:00:00Z"), new Date("2026-03-03T00:00:00Z"))

    await Memory.trim({
      dir: tmp.path,
      keep: 2,
    })

    expect(await fs.stat(one).catch(() => undefined)).toBeUndefined()
    expect((await fs.readdir(tmp.path)).sort()).toEqual(["three", "two"])
  })

  test("defaults to keeping two snapshot directories", async () => {
    await using tmp = await tmpdir()
    const one = path.join(tmp.path, "one")
    const two = path.join(tmp.path, "two")
    const three = path.join(tmp.path, "three")

    await fs.mkdir(one, { recursive: true })
    await fs.mkdir(two, { recursive: true })
    await fs.mkdir(three, { recursive: true })
    await fs.writeFile(path.join(one, "meta.json"), "{}")
    await fs.writeFile(path.join(two, "meta.json"), "{}")
    await fs.writeFile(path.join(three, "meta.json"), "{}")
    await fs.utimes(one, new Date("2026-03-01T00:00:00Z"), new Date("2026-03-01T00:00:00Z"))
    await fs.utimes(two, new Date("2026-03-02T00:00:00Z"), new Date("2026-03-02T00:00:00Z"))
    await fs.utimes(three, new Date("2026-03-03T00:00:00Z"), new Date("2026-03-03T00:00:00Z"))

    await Memory.trim({
      dir: tmp.path,
    })

    expect(await fs.stat(one).catch(() => undefined)).toBeUndefined()
    expect((await fs.readdir(tmp.path)).sort()).toEqual(["three", "two"])
  })
})

