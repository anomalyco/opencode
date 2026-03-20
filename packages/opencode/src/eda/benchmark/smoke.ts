import { mkdir, stat } from "fs/promises"
import path from "path"
import { BenchmarkCatalog } from "./catalog"
import { BenchmarkManifest } from "./manifest"
import { BenchmarkWorkspace } from "./workspace"

export namespace BenchmarkSmoke {
  export const GATE = "adder smoke"

  const FLOW = ["design", "function_eco", "physical_eco", "signoff"] as const

  function hit(file: string) {
    return stat(file)
      .then(() => true)
      .catch(() => false)
  }

  function flow(start: BenchmarkManifest.Start) {
    return FLOW.slice(FLOW.indexOf(start))
  }

  function file(repo: string, name: string, input: string, kind: "file" | "dir") {
    return {
      name,
      kind,
      input,
      path: path.resolve(repo, input),
    }
  }

  async function files(repo: string, row: BenchmarkManifest.Job) {
    const list = [
      file(repo, "pdk", row.pdk, "dir"),
      file(repo, "design", row.design, "dir"),
      file(repo, "rtl", row.rtl.root, "dir"),
      file(repo, "flist", path.join(row.rtl.root, row.rtl.flist), "file"),
      row.rtl.tb_flist ? file(repo, "tb_flist", path.join(row.rtl.root, row.rtl.tb_flist), "file") : undefined,
      row.rtl.sim_path ? file(repo, "sim_path", row.rtl.sim_path, "dir") : undefined,
      row.new_rtl_path ? file(repo, "new_rtl_path", row.new_rtl_path, "dir") : undefined,
      row.map_g3_v_output ? file(repo, "map_g3_v_output", row.map_g3_v_output, "file") : undefined,
      row.signoff_design?.def_path ? file(repo, "def_path", row.signoff_design.def_path, "file") : undefined,
      row.signoff_design?.verilog ? file(repo, "verilog", row.signoff_design.verilog, "file") : undefined,
    ].filter((row): row is NonNullable<typeof row> => Boolean(row))
    return Promise.all(
      list.map(async (row) => ({
        ...row,
        exists: await hit(row.path),
      })),
    )
  }

  function lines(run: {
    gate: string
    status: string
    root: string
    suite: string
    name: string
    job: string
    start: string
    stages: Array<{
      stage: string
      status: string
      active: boolean
      wait: string[]
      missing: string[]
      notes: string[]
    }>
    missing: string[]
    notes: string[]
  }) {
    return [
      `gate: ${run.gate}`,
      `status: ${run.status}`,
      `artifact_root: ${run.root}`,
      `suite: ${run.suite}`,
      `case: ${run.name}`,
      `job: ${run.job}`,
      `start: ${run.start}`,
      `stages: ${run.stages.map((row) => row.stage).join(",")}`,
      ...run.stages.map(
        (row) =>
          `stage.${row.stage}: ${row.status}; active=${row.active}; wait=${row.wait.length ? row.wait.join(",") : "none"}; missing=${row.missing.length}`,
      ),
      run.missing.length ? `missing: ${run.missing.join(" | ")}` : "missing: none",
      run.notes.length ? `notes: ${run.notes.join(" | ")}` : "notes: none",
    ]
  }

  function stage(step: string, i: number, list: string[], miss: string[]) {
    const wait = list.slice(0, i)
    return {
      stage: step,
      index: i,
      status: "dry_run",
      active: i === 0,
      wait,
      missing: miss,
      notes: i === 0 ? ["dry-run stage recorded"] : [`dry-run stage not executed; waiting for ${wait[wait.length - 1]} handoff`],
    }
  }

  function note(row: ReturnType<typeof stage>) {
    return [
      `stage: ${row.stage}`,
      `status: ${row.status}`,
      `active: ${row.active}`,
      `wait: ${row.wait.length ? row.wait.join(",") : "none"}`,
      row.missing.length ? `missing: ${row.missing.join(" | ")}` : "missing: none",
      row.notes.length ? `notes: ${row.notes.join(" | ")}` : "notes: none",
    ]
  }

  export async function run(input?: {
    jobs?: string
    repo?: string
    root?: string
    now?: Date
    tag?: string
    name?: string
    gate?: string
    manifest?: BenchmarkManifest.SuiteFile
  }) {
    const now = input?.now ?? new Date()
    const gate = input?.gate ?? GATE
    const jobs = path.resolve(input?.jobs ?? process.env.OPENCODE_BENCHMARK_JOBS_ROOT ?? BenchmarkCatalog.ROOT)
    const repo = path.resolve(input?.repo ?? path.join(jobs, "..", "..", ".."))
    const out = (
      await BenchmarkWorkspace.claim({
        root: input?.root,
        now,
        gate,
        tag: input?.tag,
      })
    ).root
    const man = BenchmarkManifest.SuiteFile.parse(input?.manifest ?? (await BenchmarkCatalog.load("fullflow", jobs)))
    const name = input?.name ?? man.smoke?.job ?? man.smoke?.name ?? BenchmarkCatalog.SMOKE
    const item = man.cases.find((row) => row.job === name || row.name === name || row.stem === name)
    const load = item?.job
      ? await Bun.file(path.join(jobs, item.job))
          .json()
          .then(BenchmarkManifest.Job.parse)
          .then((row) => ({ ok: true as const, row }))
          .catch((err) => ({ ok: false as const, err: err instanceof Error ? err.message : String(err) }))
      : { ok: false as const, err: `missing fullflow smoke case ${name}` }
    const list = load.ok ? await files(repo, load.row) : []
    const miss = list.filter((row) => !row.exists).map((row) => row.input)
    const notes = !load.ok
      ? [load.err]
      : miss.length
        ? [`dry-run launch recorded with ${miss.length} missing input path(s)`]
        : ["dry-run launch recorded"]
    const steps = flow(item?.start ?? "design")
    const end = new Date()
    const suite = item?.suite ?? man.suite
    const job = item?.job ?? name
    const scope = (await BenchmarkWorkspace.scope(out, suite, item?.name ?? path.basename(name, ".json"))).root
    const stages = steps.map((step, i, list) => stage(step, i, list, miss))
    const run = {
      gate,
      root: out,
      suite,
      name: item?.name ?? path.basename(name, ".json"),
      job,
      start: item?.start ?? "design",
      stages,
      dry_run: true,
      status: load.ok ? "pass" : "fail",
      started_at: now.toISOString(),
      ended_at: end.toISOString(),
      notes,
      missing: miss,
      case_root: scope,
      eda_root: path.join(scope, "eda"),
    }
    const text = `${lines(run).join("\n")}\n`

    await Promise.all(
      stages.map((row) => mkdir(path.join(run.eda_root, row.stage, "artifacts"), { recursive: true })),
    )

    await Promise.all([
      Bun.write(
        path.join(out, "manifest.json"),
        JSON.stringify(
          {
            kind: "benchmark",
            gate,
            root: out,
            benchmark_root: jobs,
            repo_root: repo,
            suite: run.suite,
            case: run.name,
            job: run.job,
            dry_run: true,
            status: run.status,
            started_at: run.started_at,
            ended_at: run.ended_at,
          },
          null,
          2,
        ),
      ),
      Bun.write(
        path.join(out, "summary.json"),
        JSON.stringify(
          {
            gate,
            artifact_root: out,
            status: run.status,
            suite: run.suite,
            case: run.name,
            job: run.job,
            stages: run.stages,
            notes: run.notes,
            missing: run.missing,
          },
          null,
          2,
        ),
      ),
      Bun.write(path.join(out, "summary.md"), text),
      Bun.write(path.join(out, "logs", "smoke.log"), text),
      Bun.write(path.join(out, "artifacts", "launch.json"), JSON.stringify(run, null, 2)),
      Bun.write(path.join(out, "artifacts", "manifests", `${man.suite}.json`), JSON.stringify(man, null, 2)),
      Bun.write(path.join(out, "artifacts", "resolved.json"), JSON.stringify(list, null, 2)),
      Bun.write(path.join(out, "artifacts", "stages.json"), JSON.stringify(stages, null, 2)),
      Bun.write(path.join(scope, "result.json"), JSON.stringify(run, null, 2)),
      Bun.write(path.join(scope, "stdout.log"), text),
      Bun.write(path.join(scope, "stderr.log"), load.ok ? "" : `${load.err}\n`),
      Bun.write(
        path.join(scope, "job.json"),
        JSON.stringify(
          {
            source: path.join(jobs, job),
            data: load.ok ? load.row : undefined,
          },
          null,
          2,
        ),
      ),
      Bun.write(path.join(scope, "artifacts", "launch.json"), JSON.stringify(run, null, 2)),
      Bun.write(path.join(scope, "artifacts", "resolved.json"), JSON.stringify(list, null, 2)),
      Bun.write(path.join(scope, "artifacts", "stages.json"), JSON.stringify(stages, null, 2)),
      Bun.write(
        path.join(run.eda_root, "dry-run.json"),
        JSON.stringify(
          {
            suite: run.suite,
            case: run.name,
            stages: run.stages,
            notes: run.notes,
            missing: run.missing,
          },
          null,
          2,
        ),
      ),
      ...stages.flatMap((row) => {
        const text = `${note(row).join("\n")}\n`
        const root = path.join(run.eda_root, row.stage)
        return [
          Bun.write(path.join(root, "result.json"), JSON.stringify(row, null, 2)),
          Bun.write(path.join(root, "stdout.log"), text),
          Bun.write(path.join(root, "stderr.log"), row.missing.length ? `${row.missing.join("\n")}\n` : ""),
          Bun.write(path.join(root, "artifacts", "summary.json"), JSON.stringify(row, null, 2)),
          Bun.write(path.join(root, "artifacts", "resolved.json"), JSON.stringify(list, null, 2)),
        ]
      }),
    ])

    return run
  }
}
