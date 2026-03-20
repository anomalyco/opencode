import { stat } from "fs/promises"
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
    status: string
    root: string
    suite: string
    name: string
    job: string
    start: string
    stages: readonly string[]
    missing: string[]
    notes: string[]
  }) {
    return [
      `gate: ${GATE}`,
      `status: ${run.status}`,
      `artifact_root: ${run.root}`,
      `suite: ${run.suite}`,
      `case: ${run.name}`,
      `job: ${run.job}`,
      `start: ${run.start}`,
      `stages: ${run.stages.join(",")}`,
      run.missing.length ? `missing: ${run.missing.join(" | ")}` : "missing: none",
      run.notes.length ? `notes: ${run.notes.join(" | ")}` : "notes: none",
    ]
  }

  export async function run(input?: {
    jobs?: string
    repo?: string
    root?: string
    now?: Date
    tag?: string
    name?: string
  }) {
    const now = input?.now ?? new Date()
    const jobs = path.resolve(input?.jobs ?? process.env.OPENCODE_BENCHMARK_JOBS_ROOT ?? BenchmarkCatalog.ROOT)
    const repo = path.resolve(input?.repo ?? path.join(jobs, "..", "..", ".."))
    const out = (
      await BenchmarkWorkspace.claim({
        root: input?.root,
        now,
        gate: GATE,
        tag: input?.tag,
      })
    ).root
    const catalog = await BenchmarkCatalog.build(jobs)
    const name = input?.name ?? catalog.smoke.job ?? BenchmarkCatalog.SMOKE
    const item = catalog.suites.fullflow.find((row) => row.job === name || row.name === name || row.stem === name)
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
    const stages = flow(item?.start ?? "design")
    const end = new Date()
    const suite = item?.suite ?? "fullflow"
    const job = item?.job ?? name
    const scope = (await BenchmarkWorkspace.scope(out, suite, item?.name ?? path.basename(name, ".json"))).root
    const run = {
      gate: GATE,
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

    await Promise.all([
      Bun.write(
        path.join(out, "manifest.json"),
        JSON.stringify(
          {
            kind: "benchmark",
            gate: GATE,
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
            gate: GATE,
            artifact_root: out,
            status: run.status,
            suite: run.suite,
            case: run.name,
            job: run.job,
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
      Bun.write(path.join(out, "artifacts", "resolved.json"), JSON.stringify(list, null, 2)),
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
    ])

    return run
  }
}
