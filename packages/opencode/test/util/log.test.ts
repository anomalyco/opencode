import { describe, test, expect } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { tmpdir } from "../fixture/fixture"
import { Log } from "../../src/util/log"
import { Glob } from "../../src/util/glob"

function logname(ts: string) {
  return `${ts}.log`
}

async function touch(dir: string, name: string) {
  await fs.writeFile(path.join(dir, name), "")
}

describe("log cleanup", () => {
  test("does nothing when at or below threshold", async () => {
    await using tmp = await tmpdir()
    const names = Array.from({ length: 10 }, (_, i) => logname(`2026-01-${String(i + 1).padStart(2, "0")}T000000`))
    for (const n of names) await touch(tmp.path, n)

    await Log.cleanup(tmp.path)

    expect((await Glob.scan("*.log", { cwd: tmp.path })).sort()).toEqual(names.sort())
  })

  test("removes oldest files keeping newest 10 (regression: unsorted glob)", async () => {
    await using tmp = await tmpdir()
    const names = Array.from({ length: 15 }, (_, i) => logname(`2026-01-${String(i + 1).padStart(2, "0")}T000000`))
    for (const n of names) await touch(tmp.path, n)

    await Log.cleanup(tmp.path)

    const remaining = (await Glob.scan("*.log", { cwd: tmp.path })).sort()
    expect(remaining).toEqual(names.sort().slice(5))
  })

  test("does not delete dev.log", async () => {
    await using tmp = await tmpdir()
    for (let i = 1; i <= 12; i++) await touch(tmp.path, logname(`2026-01-${String(i).padStart(2, "0")}T000000`))
    await touch(tmp.path, "dev.log")

    await Log.cleanup(tmp.path)

    expect(await fs.stat(path.join(tmp.path, "dev.log"))).toBeDefined()
  })

  test("handles missing log directory gracefully", async () => {
    await using tmp = await tmpdir()
    await expect(Log.cleanup(path.join(tmp.path, "does-not-exist"))).resolves.toBeUndefined()
  })
})
