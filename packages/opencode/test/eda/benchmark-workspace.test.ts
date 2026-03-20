import { describe, expect, test } from "bun:test"
import { mkdir, stat } from "fs/promises"
import path from "path"
import { BenchmarkWorkspace } from "../../src/eda/benchmark/workspace"
import { tmpdir } from "../fixture/fixture"

function has(dir: string) {
  return stat(dir)
    .then(() => true)
    .catch(() => false)
}

describe("BenchmarkWorkspace", () => {
  test("claims a timestamp root with placeholder files and suite dirs", async () => {
    await using tmp = await tmpdir()
    const now = new Date("2026-03-20T12:34:56")
    const run = await BenchmarkWorkspace.claim({
      root: tmp.path,
      now,
      gate: "catalog self-check",
    })

    expect(run.root).toBe(path.join(tmp.path, "26-03-20", "12-34-56"))
    expect(run.day).toBe("26-03-20")
    expect(run.slot).toBe("12-34-56")
    expect(run.tag).toBeUndefined()
    expect(await Bun.file(path.join(run.root, "manifest.json")).json()).toMatchObject({
      kind: "benchmark",
      gate: "catalog self-check",
      root: run.root,
      status: "pending",
      created_at: now.toISOString(),
    })
    expect(await Bun.file(path.join(run.root, "summary.json")).json()).toEqual({
      gate: "catalog self-check",
      artifact_root: run.root,
      status: "pending",
      notes: [],
    })
    expect(await Bun.file(path.join(run.root, "summary.md")).text()).toBe(
      `gate: catalog self-check\nstatus: pending\nartifact_root: ${run.root}\nnotes: none\n`,
    )
    expect(await has(path.join(run.root, "logs"))).toBe(true)
    expect(await has(path.join(run.root, "artifacts"))).toBe(true)
    expect(await has(path.join(run.root, "benchmarks", "fullflow"))).toBe(true)
    expect(await has(path.join(run.root, "benchmarks", "design"))).toBe(true)
    expect(await has(path.join(run.root, "benchmarks", "function_eco"))).toBe(true)
    expect(await has(path.join(run.root, "benchmarks", "physical_eco"))).toBe(true)
    expect(await has(path.join(run.root, "benchmarks", "signoff"))).toBe(true)
  })

  test("uses a stable suffix when the slot is already taken", async () => {
    await using tmp = await tmpdir()
    const now = new Date("2026-03-20T12:34:56")
    await mkdir(path.join(tmp.path, "26-03-20", "12-34-56"), { recursive: true })

    const run = await BenchmarkWorkspace.claim({
      root: tmp.path,
      now,
      gate: "catalog self-check",
      tag: "bmk-003",
    })

    expect(run.root).toBe(path.join(tmp.path, "26-03-20", "12-34-56-bmk-003"))
    expect(run.tag).toBe("bmk-003")
  })

  test("increments the suffix when the tagged slot already exists", async () => {
    await using tmp = await tmpdir()
    const now = new Date("2026-03-20T12:34:56")
    await mkdir(path.join(tmp.path, "26-03-20", "12-34-56"), { recursive: true })
    await mkdir(path.join(tmp.path, "26-03-20", "12-34-56-bmk-003"), { recursive: true })

    const run = await BenchmarkWorkspace.claim({
      root: tmp.path,
      now,
      gate: "catalog self-check",
      tag: "bmk-003",
    })

    expect(run.root).toBe(path.join(tmp.path, "26-03-20", "12-34-56-bmk-003-01"))
    expect(run.tag).toBe("bmk-003-01")
  })

  test("keeps concurrent claims on distinct roots", async () => {
    await using tmp = await tmpdir()
    const now = new Date("2026-03-20T12:34:56")
    const runs = await Promise.all([
      BenchmarkWorkspace.claim({
        root: tmp.path,
        now,
        gate: "catalog self-check",
        tag: "bmk-003",
      }),
      BenchmarkWorkspace.claim({
        root: tmp.path,
        now,
        gate: "catalog self-check",
        tag: "bmk-003",
      }),
    ])

    expect(new Set(runs.map((row) => row.root)).size).toBe(2)
    expect(runs.some((row) => path.basename(row.root) === "12-34-56")).toBe(true)
    expect(runs.some((row) => path.basename(row.root) === "12-34-56-bmk-003")).toBe(true)
  })
})
