import z from "zod"

export namespace BenchmarkManifest {
  export const ROOT = "/workspaces/Github/opencode/tests/cases/jobs"
  export const SMOKE = "smic110-adder.json"

  export const Suite = z.enum(["fullflow", "design", "function_eco", "physical_eco", "signoff"])
  export type Suite = z.infer<typeof Suite>

  export const Start = z.enum(["design", "function_eco", "physical_eco", "signoff"])
  export type Start = z.infer<typeof Start>

  export const Job = z
    .object({
      pdk: z.string(),
      rtl: z
        .object({
          root: z.string(),
          flist: z.string(),
          tb_flist: z.string().optional(),
          sim_path: z.string().optional(),
        })
        .strict(),
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
        .strict()
        .optional(),
    })
    .strict()
  export type Job = z.infer<typeof Job>

  export const Case = z
    .object({
      suite: Suite,
      name: z.string(),
      stem: z.string(),
      source: z.enum(["repo", "derived"]),
      job: z.string().optional(),
      from: z.string().optional(),
      start: Start,
      pdk: z.string(),
      design: z.string(),
      rtl: z
        .object({
          root: z.string(),
          flist: z.string(),
        })
        .strict(),
      spec_type: z.string(),
    })
    .strict()
  export type Case = z.infer<typeof Case>

  export const Smoke = z
    .object({
      name: z.string(),
      job: z.string().optional(),
      from: z.string().optional(),
    })
    .strict()
  export type Smoke = z.infer<typeof Smoke>

  export const Counts = z
    .object({
      fullflow: z.number().int().nonnegative(),
      design: z.number().int().nonnegative(),
      function_eco: z.number().int().nonnegative(),
      physical_eco: z.number().int().nonnegative(),
      signoff: z.number().int().nonnegative(),
    })
    .strict()
  export type Counts = z.infer<typeof Counts>

  export const Suites = z
    .object({
      fullflow: z.array(Case),
      design: z.array(Case),
      function_eco: z.array(Case),
      physical_eco: z.array(Case),
      signoff: z.array(Case),
    })
    .strict()
  export type Suites = z.infer<typeof Suites>

  export const SuiteFile = z
    .object({
      kind: z.literal("benchmark_manifest"),
      suite: Suite,
      root: z.string(),
      smoke: Smoke.optional(),
      cases: z.array(Case),
    })
    .strict()
  export type SuiteFile = z.infer<typeof SuiteFile>

  export const Files = z
    .object({
      fullflow: SuiteFile,
      design: SuiteFile,
      function_eco: SuiteFile,
      physical_eco: SuiteFile,
      signoff: SuiteFile,
    })
    .strict()
  export type Files = z.infer<typeof Files>

  function smoke(cases: Case[]) {
    const hit = cases.find((row) => row.stem === SMOKE.slice(0, -".json".length)) ?? cases[0]
    if (!hit) return undefined
    return Smoke.parse({
      name: hit.name,
      job: hit.job,
      from: hit.from,
    })
  }

  function file(root: string, suite: Suite, cases: Case[]) {
    return SuiteFile.parse({
      kind: "benchmark_manifest",
      suite,
      root,
      smoke: smoke(cases),
      cases,
    })
  }

  export function build(root: string, suites: Suites) {
    return Files.parse({
      fullflow: file(root, "fullflow", suites.fullflow),
      design: file(root, "design", suites.design),
      function_eco: file(root, "function_eco", suites.function_eco),
      physical_eco: file(root, "physical_eco", suites.physical_eco),
      signoff: file(root, "signoff", suites.signoff),
    })
  }
}
