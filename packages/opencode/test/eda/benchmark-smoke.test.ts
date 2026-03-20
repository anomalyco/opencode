import { describe, expect, test } from "bun:test"
import { mkdir } from "fs/promises"
import path from "path"
import { BenchmarkSmoke } from "../../src/eda/benchmark/smoke"
import { tmpdir } from "../fixture/fixture"

async function write(root: string, name: string, data: unknown) {
  await Bun.write(path.join(root, name), JSON.stringify(data, null, 2))
}

describe("BenchmarkSmoke", () => {
  test("records a dry-run smoke artifact bundle", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const jobs = path.join(dir, "tests", "cases", "jobs")
        await mkdir(jobs, { recursive: true })
        await mkdir(path.join(dir, "tests", "cases", "designs", "smic110-adder"), { recursive: true })
        await mkdir(path.join(dir, "tests", "cases", "pdks", "smic110-pdk"), { recursive: true })
        await mkdir(path.join(dir, "tests", "cases", "rtls", "adder_bug-rtl"), { recursive: true })
        await Bun.write(path.join(dir, "tests", "cases", "rtls", "adder_bug-rtl", "mi6.flist"), "adder.v\n")
        await write(jobs, "smic110-adder.json", {
          pdk: "tests/cases/pdks/smic110-pdk",
          rtl: {
            root: "tests/cases/rtls/adder_bug-rtl",
            flist: "mi6.flist",
          },
          design: "tests/cases/designs/smic110-adder",
          spec_type: "rtl_bug_fix",
        })
        return jobs
      },
    })

    const run = await BenchmarkSmoke.run({
      jobs: tmp.extra,
      repo: tmp.path,
      root: path.join(tmp.path, "benchmark"),
      now: new Date("2026-03-20T12:34:56Z"),
      tag: "bmk-004",
    })

    expect(run.status).toBe("pass")
    expect(run.root).toBe(path.join(tmp.path, "benchmark", "26-03-20", "12-34-56"))
    expect(run.missing).toEqual([])
    expect(run.stages.map((row) => row.stage)).toEqual(["design", "function_eco", "physical_eco", "signoff"])
    expect(run.stages[0]).toMatchObject({
      stage: "design",
      status: "dry_run",
      active: true,
      wait: [],
      missing: [],
    })
    expect(run.stages[1]).toMatchObject({
      stage: "function_eco",
      status: "dry_run",
      active: false,
      wait: ["design"],
    })
    expect(await Bun.file(path.join(run.root, "summary.json")).json()).toEqual({
      gate: "adder smoke",
      artifact_root: run.root,
      status: "pass",
      suite: "fullflow",
      case: "smic110-adder",
      job: "smic110-adder.json",
      stages: run.stages,
      notes: ["dry-run launch recorded"],
      missing: [],
    })
    expect(await Bun.file(path.join(run.case_root, "result.json")).json()).toMatchObject({
      gate: "adder smoke",
      status: "pass",
      suite: "fullflow",
      name: "smic110-adder",
    })
    expect(await Bun.file(path.join(run.case_root, "artifacts", "stages.json")).json()).toEqual(run.stages)
    expect(await Bun.file(path.join(run.case_root, "job.json")).json()).toMatchObject({
      source: path.join(tmp.extra, "smic110-adder.json"),
      data: {
        pdk: "tests/cases/pdks/smic110-pdk",
      },
    })
    expect(await Bun.file(path.join(run.case_root, "artifacts", "resolved.json")).json()).toHaveLength(4)
    expect(await Bun.file(path.join(run.eda_root, "design", "result.json")).json()).toMatchObject({
      stage: "design",
      status: "dry_run",
      active: true,
    })
    expect(await Bun.file(path.join(run.eda_root, "function_eco", "result.json")).json()).toMatchObject({
      stage: "function_eco",
      status: "dry_run",
      wait: ["design"],
    })
    expect(await Bun.file(path.join(run.eda_root, "physical_eco", "result.json")).json()).toMatchObject({
      stage: "physical_eco",
      status: "dry_run",
      wait: ["design", "function_eco"],
    })
    expect(await Bun.file(path.join(run.eda_root, "signoff", "result.json")).json()).toMatchObject({
      stage: "signoff",
      status: "dry_run",
      wait: ["design", "function_eco", "physical_eco"],
    })
    expect(await Bun.file(path.join(run.eda_root, "dry-run.json")).json()).toMatchObject({
      suite: "fullflow",
      case: "smic110-adder",
    })
  })

  test("keeps dry-run launch passing while recording missing inputs", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const jobs = path.join(dir, "tests", "cases", "jobs")
        await mkdir(jobs, { recursive: true })
        await write(jobs, "smic110-adder.json", {
          pdk: "tests/cases/pdks/smic110-pdk",
          rtl: {
            root: "tests/cases/rtls/adder_bug-rtl",
            flist: "mi6.flist",
          },
          design: "tests/cases/designs/smic110-adder",
          spec_type: "rtl_bug_fix",
        })
        return jobs
      },
    })

    const run = await BenchmarkSmoke.run({
      jobs: tmp.extra,
      repo: tmp.path,
      root: path.join(tmp.path, "benchmark"),
      now: new Date("2026-03-20T12:34:56Z"),
      tag: "bmk-004",
    })

    expect(run.status).toBe("pass")
    expect(run.missing).toEqual([
      "tests/cases/pdks/smic110-pdk",
      "tests/cases/designs/smic110-adder",
      "tests/cases/rtls/adder_bug-rtl",
      "tests/cases/rtls/adder_bug-rtl/mi6.flist",
    ])
    expect(run.notes).toEqual(["dry-run launch recorded with 4 missing input path(s)"])
    expect(run.stages[0]).toMatchObject({
      stage: "design",
      missing: [
        "tests/cases/pdks/smic110-pdk",
        "tests/cases/designs/smic110-adder",
        "tests/cases/rtls/adder_bug-rtl",
        "tests/cases/rtls/adder_bug-rtl/mi6.flist",
      ],
    })
    expect(run.stages[3]).toMatchObject({
      stage: "signoff",
      status: "dry_run",
      wait: ["design", "function_eco", "physical_eco"],
    })
    expect(await Bun.file(path.join(run.root, "summary.md")).text()).toContain("missing: tests/cases/pdks/smic110-pdk")
    expect(await Bun.file(path.join(run.eda_root, "signoff", "result.json")).json()).toMatchObject({
      stage: "signoff",
      status: "dry_run",
    })
  })
})
