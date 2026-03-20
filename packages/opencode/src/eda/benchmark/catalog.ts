import path from "path"
import z from "zod"

export namespace BenchmarkCatalog {
  export const ROOT = "/workspaces/mi6-eco-agents/tests/cases/jobs"
  export const SMOKE = "smic110-adder.json"

  export const Suite = z.enum(["fullflow", "design", "function_eco", "physical_eco", "signoff"])
  export type Suite = z.infer<typeof Suite>

  export const Start = z.enum(["design", "function_eco", "physical_eco", "signoff"])
  export type Start = z.infer<typeof Start>

  const Job = z.object({
    pdk: z.string(),
    rtl: z.object({
      root: z.string(),
      flist: z.string(),
      tb_flist: z.string().optional(),
      sim_path: z.string().optional(),
    }),
    design: z.string(),
    spec: z.string().optional(),
    spec_type: z.string(),
    start_agent: Start.optional(),
    new_rtl_path: z.string().optional(),
    map_g3_v_output: z.string().optional(),
    signoff_design: z
      .object({
        def_path: z.string(),
        verilog: z.string(),
      })
      .optional(),
  })

  export const Entry = z.object({
    suite: Suite,
    name: z.string(),
    stem: z.string(),
    source: z.enum(["upstream", "derived"]),
    job: z.string().optional(),
    from: z.string().optional(),
    start: Start,
    pdk: z.string(),
    design: z.string(),
    rtl: z.object({
      root: z.string(),
      flist: z.string(),
    }),
    spec_type: z.string(),
  })
  export type Entry = z.infer<typeof Entry>

  export const Counts = z.object({
    fullflow: z.number().int().nonnegative(),
    design: z.number().int().nonnegative(),
    function_eco: z.number().int().nonnegative(),
    physical_eco: z.number().int().nonnegative(),
    signoff: z.number().int().nonnegative(),
  })
  export type Counts = z.infer<typeof Counts>

  export const Info = z.object({
    root: z.string(),
    smoke: z.object({
      suite: z.literal("fullflow"),
      name: z.string(),
      job: z.string(),
    }),
    counts: Counts,
    suites: z.object({
      fullflow: z.array(Entry),
      design: z.array(Entry),
      function_eco: z.array(Entry),
      physical_eco: z.array(Entry),
      signoff: z.array(Entry),
    }),
  })
  export type Info = z.infer<typeof Info>

  export const Check = z.object({
    status: z.enum(["pass", "fail"]),
    notes: z.array(z.string()),
    counts: Counts,
    catalog: Info,
  })
  export type Check = z.infer<typeof Check>

  function suite(job: string) {
    if (job.endsWith(".func.json")) return "function_eco"
    if (job.endsWith(".phy.json")) return "physical_eco"
    if (job.endsWith(".signoff.json")) return "signoff"
    return "fullflow"
  }

  function stem(job: string) {
    if (job.endsWith(".func.json")) return job.slice(0, -".func.json".length)
    if (job.endsWith(".phy.json")) return job.slice(0, -".phy.json".length)
    if (job.endsWith(".signoff.json")) return job.slice(0, -".signoff.json".length)
    return job.slice(0, -".json".length)
  }

  function start(job: string, data: z.infer<typeof Job>) {
    if (data.start_agent) return data.start_agent
    if (job.endsWith(".func.json")) return "function_eco"
    if (job.endsWith(".phy.json")) return "physical_eco"
    if (job.endsWith(".signoff.json")) return "signoff"
    return "design"
  }

  async function rows(root: string) {
    const jobs = (await Array.fromAsync(new Bun.Glob("*.json").scan({ cwd: root, onlyFiles: true }))).sort()
    return Promise.all(
      jobs.map(async (job) => ({
        job,
        data: Job.parse(await Bun.file(path.join(root, job)).json()),
      })),
    )
  }

  function entry(suite: Suite, row: Awaited<ReturnType<typeof rows>>[number]) {
    return Entry.parse({
      suite,
      name: stem(row.job),
      stem: stem(row.job),
      source: "upstream",
      job: row.job,
      start: start(row.job, row.data),
      pdk: row.data.pdk,
      design: row.data.design,
      rtl: {
        root: row.data.rtl.root,
        flist: row.data.rtl.flist,
      },
      spec_type: row.data.spec_type,
    })
  }

  function same(a: string[], b: string[]) {
    return a.length === b.length && a.every((item, i) => item === b[i])
  }

  function root(input?: string) {
    return path.resolve(input ?? process.env.OPENCODE_BENCHMARK_JOBS_ROOT ?? ROOT)
  }

  export async function build(input?: string) {
    const cwd = root(input)
    const list = await rows(cwd)
    const full = list.filter((row) => suite(row.job) === "fullflow").map((row) => entry("fullflow", row))
    const func = list.filter((row) => suite(row.job) === "function_eco").map((row) => entry("function_eco", row))
    const phy = list.filter((row) => suite(row.job) === "physical_eco").map((row) => entry("physical_eco", row))
    const sign = list.filter((row) => suite(row.job) === "signoff").map((row) => entry("signoff", row))
    const design = full.map((row) =>
      Entry.parse({
        suite: "design",
        name: row.name,
        stem: row.stem,
        source: "derived",
        from: row.job,
        start: "design",
        pdk: row.pdk,
        design: row.design,
        rtl: row.rtl,
        spec_type: row.spec_type,
      }),
    )
    return Info.parse({
      root: cwd,
      smoke: {
        suite: "fullflow",
        name: stem(SMOKE),
        job: SMOKE,
      },
      counts: {
        fullflow: full.length,
        design: design.length,
        function_eco: func.length,
        physical_eco: phy.length,
        signoff: sign.length,
      },
      suites: {
        fullflow: full,
        design,
        function_eco: func,
        physical_eco: phy,
        signoff: sign,
      },
    })
  }

  export async function check(input?: string) {
    const cwd = root(input)
    const jobs = (await Array.fromAsync(new Bun.Glob("*.json").scan({ cwd: cwd, onlyFiles: true }))).sort()
    const info = await build(cwd)
    const raw = {
      fullflow: jobs.filter((job) => suite(job) === "fullflow").map(stem),
      design: jobs.filter((job) => suite(job) === "fullflow").map(stem),
      function_eco: jobs.filter((job) => suite(job) === "function_eco").map(stem),
      physical_eco: jobs.filter((job) => suite(job) === "physical_eco").map(stem),
      signoff: jobs.filter((job) => suite(job) === "signoff").map(stem),
    }
    const notes = [
      same(
        info.suites.fullflow.map((row) => row.name),
        raw.fullflow,
      )
        ? undefined
        : "fullflow suite does not match upstream unsuffixed jobs",
      same(
        info.suites.design.map((row) => row.name),
        raw.design,
      )
        ? undefined
        : "design suite does not match derived fullflow jobs",
      same(
        info.suites.function_eco.map((row) => row.name),
        raw.function_eco,
      )
        ? undefined
        : "function_eco suite does not match upstream *.func.json jobs",
      same(
        info.suites.physical_eco.map((row) => row.name),
        raw.physical_eco,
      )
        ? undefined
        : "physical_eco suite does not match upstream *.phy.json jobs",
      same(
        info.suites.signoff.map((row) => row.name),
        raw.signoff,
      )
        ? undefined
        : "signoff suite does not match upstream *.signoff.json jobs",
      info.suites.fullflow.some((row) => row.job === SMOKE) ? undefined : `missing smoke case ${SMOKE}`,
      info.suites.design.every((row) => row.source === "derived" && row.from) ? undefined : "design cases must be derived",
      info.counts.fullflow > 0 ? undefined : "fullflow suite is empty",
      info.counts.design > 0 ? undefined : "design suite is empty",
      info.counts.function_eco > 0 ? undefined : "function_eco suite is empty",
      info.counts.physical_eco > 0 ? undefined : "physical_eco suite is empty",
      info.counts.signoff > 0 ? undefined : "signoff suite is empty",
    ].filter((row): row is string => Boolean(row))
    return Check.parse({
      status: notes.length ? "fail" : "pass",
      notes,
      counts: info.counts,
      catalog: info,
    })
  }
}
