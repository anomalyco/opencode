import { describe, expect, test } from "bun:test"
import { mkdir } from "fs/promises"
import path from "path"
import { BenchmarkFullflow } from "../../src/eda/benchmark/fullflow"
import { tmpdir } from "../fixture/fixture"

async function write(root: string, name: string, data: unknown) {
  await Bun.write(path.join(root, name), JSON.stringify(data, null, 2))
}

describe("BenchmarkFullflow", () => {
  test("loads repo fullflow cases and records the suite manifest", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const jobs = path.join(dir, "tests", "cases", "jobs")
        await mkdir(jobs, { recursive: true })
        await mkdir(path.join(dir, "tests", "cases", "designs", "smic110-adder"), { recursive: true })
        await mkdir(path.join(dir, "tests", "cases", "designs", "smic110-asset"), { recursive: true })
        await mkdir(path.join(dir, "tests", "cases", "pdks", "smic110-pdk"), { recursive: true })
        await mkdir(path.join(dir, "tests", "cases", "rtls", "adder_bug-rtl"), { recursive: true })
        await mkdir(path.join(dir, "tests", "cases", "rtls", "asset_bug-rtl"), { recursive: true })
        await Bun.write(path.join(dir, "tests", "cases", "rtls", "adder_bug-rtl", "mi6.flist"), "adder.v\n")
        await Bun.write(path.join(dir, "tests", "cases", "rtls", "asset_bug-rtl", "mi6.flist"), "asset.v\n")
        await write(jobs, "smic110-adder.json", {
          pdk: "tests/cases/pdks/smic110-pdk",
          rtl: {
            root: "tests/cases/rtls/adder_bug-rtl",
            flist: "mi6.flist",
          },
          design: "tests/cases/designs/smic110-adder",
          spec_type: "rtl_bug_fix",
        })
        await write(jobs, "smic110-asset.json", {
          pdk: "tests/cases/pdks/smic110-pdk",
          rtl: {
            root: "tests/cases/rtls/asset_bug-rtl",
            flist: "mi6.flist",
          },
          design: "tests/cases/designs/smic110-asset",
          spec_type: "rtl_bug_fix",
        })
        await write(jobs, "smic110-adder.func.json", {
          pdk: "tests/cases/pdks/smic110-pdk",
          rtl: {
            root: "tests/cases/rtls/adder_bug-rtl",
            flist: "mi6.flist",
          },
          design: "tests/cases/designs/smic110-adder",
          spec_type: "rtl_bug_fix",
          start_agent: "function_eco",
        })
        return jobs
      },
    })

    const man = await BenchmarkFullflow.load(tmp.extra)
    const run = await BenchmarkFullflow.run({
      jobs: tmp.extra,
      repo: tmp.path,
      root: path.join(tmp.path, "benchmark"),
      now: new Date("2026-03-20T12:34:56Z"),
      tag: "bmk-005",
    })

    expect(man.cases.map((row) => row.job)).toEqual(["smic110-adder.json", "smic110-asset.json"])
    expect(run.status).toBe("pass")
    expect(await Bun.file(path.join(run.root, "summary.json")).json()).toMatchObject({
      gate: "fullflow smoke",
      suite: "fullflow",
      case: "smic110-adder",
      job: "smic110-adder.json",
      status: "pass",
    })
    expect(await Bun.file(path.join(run.root, "artifacts", "manifests", "fullflow.json")).json()).toEqual(man)
  })
})
