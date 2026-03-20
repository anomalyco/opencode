import { describe, expect, test } from "bun:test"
import { mkdir } from "fs/promises"
import path from "path"
import { BenchmarkCatalog } from "../../src/eda/benchmark/catalog"
import { BenchmarkManifest } from "../../src/eda/benchmark/manifest"
import { tmpdir } from "../fixture/fixture"

async function write(root: string, name: string, data: unknown) {
  await Bun.write(path.join(root, name), JSON.stringify(data, null, 2))
}

describe("BenchmarkCatalog", () => {
  test("groups repo jobs into stable suites and derives design cases", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const root = path.join(dir, "jobs")
        await mkdir(root, { recursive: true })
        await write(root, "beta.json", {
          pdk: "pdk",
          rtl: { root: "rtl/beta", flist: "beta.flist" },
          design: "design/beta",
          spec_type: "rtl_bug_fix",
        })
        await write(root, "alpha.json", {
          pdk: "pdk",
          rtl: { root: "rtl/alpha", flist: "alpha.flist" },
          design: "design/alpha",
          spec_type: "rtl_bug_fix",
        })
        await write(root, "alpha.func.json", {
          pdk: "pdk",
          rtl: { root: "rtl/alpha-r1", flist: "alpha.flist" },
          design: "design/alpha",
          spec_type: "rtl_bug_fix",
          start_agent: "function_eco",
        })
        await write(root, "alpha.phy.json", {
          pdk: "pdk",
          rtl: { root: "rtl/alpha-r1", flist: "alpha.flist" },
          design: "design/alpha",
          spec_type: "rtl_bug_fix",
          start_agent: "physical_eco",
        })
        await write(root, "alpha.signoff.json", {
          pdk: "pdk",
          rtl: { root: "rtl/alpha-r1", flist: "alpha.flist" },
          design: "design/alpha",
          spec_type: "rtl_bug_fix",
          start_agent: "signoff",
        })
        return root
      },
    })

    const info = await BenchmarkCatalog.build(tmp.extra)

    expect(info.suites.fullflow.map((row) => row.name)).toEqual(["alpha", "beta"])
    expect(info.suites.design.map((row) => row.name)).toEqual(["alpha", "beta"])
    expect(info.suites.function_eco.map((row) => row.name)).toEqual(["alpha"])
    expect(info.suites.physical_eco.map((row) => row.name)).toEqual(["alpha"])
    expect(info.suites.signoff.map((row) => row.name)).toEqual(["alpha"])
    expect(info.suites.design[0]).toMatchObject({
      suite: "design",
      source: "derived",
      from: "alpha.json",
      start: "design",
    })
    expect(info.suites.function_eco[0]).toMatchObject({
      suite: "function_eco",
      job: "alpha.func.json",
      start: "function_eco",
    })
    expect(info.manifests.fullflow).toMatchObject({
      kind: "benchmark_manifest",
      suite: "fullflow",
      root: tmp.extra,
    })
    expect(await BenchmarkCatalog.load("fullflow", tmp.extra)).toEqual(info.manifests.fullflow)
    expect(info.manifests.fullflow.cases.map((row) => row.name)).toEqual(["alpha", "beta"])
    expect(info.counts).toEqual({
      fullflow: 2,
      design: 2,
      function_eco: 1,
      physical_eco: 1,
      signoff: 1,
    })
  })

  test("passes self-check for a complete fixture corpus", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const root = path.join(dir, "jobs")
        await mkdir(root, { recursive: true })
        await write(root, "smic110-adder.json", {
          pdk: "pdk",
          rtl: { root: "rtl/adder", flist: "mi6.flist" },
          design: "design/adder",
          spec_type: "rtl_bug_fix",
        })
        await write(root, "smic110-adder.func.json", {
          pdk: "pdk",
          rtl: { root: "rtl/adder-r1", flist: "mi6.flist" },
          design: "design/adder",
          spec_type: "rtl_bug_fix",
          start_agent: "function_eco",
        })
        await write(root, "smic110-adder.phy.json", {
          pdk: "pdk",
          rtl: { root: "rtl/adder-r1", flist: "mi6.flist" },
          design: "design/adder",
          spec_type: "rtl_bug_fix",
          start_agent: "physical_eco",
        })
        await write(root, "smic110-adder.signoff.json", {
          pdk: "pdk",
          rtl: { root: "rtl/adder-r1", flist: "mi6.flist" },
          design: "design/adder",
          spec_type: "rtl_bug_fix",
          start_agent: "signoff",
        })
        return root
      },
    })

    const catalog = await BenchmarkCatalog.build(tmp.extra)
    const suites = BenchmarkManifest.Suite.options.map((suite) =>
      BenchmarkManifest.SuiteFile.parse(catalog.manifests[suite]),
    )
    const info = await BenchmarkCatalog.check(tmp.extra)

    expect(suites.map((row) => row.suite)).toEqual(BenchmarkManifest.Suite.options)
    expect(catalog.manifests.fullflow.smoke).toEqual({
      name: "smic110-adder",
      job: "smic110-adder.json",
    })
    expect(catalog.manifests.design.smoke).toEqual({
      name: "smic110-adder",
      from: "smic110-adder.json",
    })
    expect(catalog.manifests.function_eco.smoke).toEqual({
      name: "smic110-adder",
      job: "smic110-adder.func.json",
    })
    expect(info.status).toBe("pass")
    expect(info.notes).toEqual([])
  })
})
