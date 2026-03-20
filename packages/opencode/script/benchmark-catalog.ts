#!/usr/bin/env bun

import { mkdir } from "fs/promises"
import { existsSync } from "fs"
import path from "path"
import { fileURLToPath } from "url"
import { BenchmarkCatalog } from "../src/eda/benchmark/catalog"

const pkg = fileURLToPath(new URL("..", import.meta.url))
const repo = path.resolve(pkg, "..", "..")
const now = new Date()
const jobs = process.argv[2] || process.env.OPENCODE_BENCHMARK_JOBS_ROOT

function part(input: number, size = 2) {
  return input.toString().padStart(size, "0")
}

function stamp(now: Date) {
  const day = `${part(now.getFullYear() % 100)}-${part(now.getMonth() + 1)}-${part(now.getDate())}`
  const time = `${part(now.getHours())}-${part(now.getMinutes())}-${part(now.getSeconds())}`
  return { day, time }
}

function slot(now: Date) {
  let next = now
  while (true) {
    const name = stamp(next)
    const out = path.join(repo, "benchmark", name.day, name.time)
    if (!existsSync(out)) return out
    next = new Date(next.getTime() + 1000)
  }
}

const out = slot(now)
const caseRoot = path.join(out, "benchmarks", "catalog", "selfcheck")
const run = await BenchmarkCatalog.check(jobs)
const result = {
  gate: "catalog self-check",
  status: run.status,
  counts: run.counts,
  notes: run.notes,
  smoke: run.catalog.smoke,
}
const lines = [
  `gate: catalog self-check`,
  `status: ${run.status}`,
  `artifact_root: ${out}`,
  `fullflow: ${run.counts.fullflow}`,
  `design: ${run.counts.design}`,
  `function_eco: ${run.counts.function_eco}`,
  `physical_eco: ${run.counts.physical_eco}`,
  `signoff: ${run.counts.signoff}`,
  run.notes.length ? `notes: ${run.notes.join(" | ")}` : "notes: none",
]

await mkdir(path.join(out, "logs"), { recursive: true })
await mkdir(path.join(out, "artifacts"), { recursive: true })
await mkdir(path.join(out, "artifacts", "manifests"), { recursive: true })
await mkdir(path.join(caseRoot, "artifacts"), { recursive: true })
await mkdir(path.join(caseRoot, "eda"), { recursive: true })

await Bun.write(
  path.join(out, "manifest.json"),
  JSON.stringify(
    {
      kind: "benchmark",
      gate: "catalog self-check",
      root: out,
      benchmark_root: run.catalog.root,
      started_at: now.toISOString(),
      smoke: run.catalog.smoke,
    },
    null,
    2,
  ),
)
await Bun.write(path.join(out, "summary.json"), JSON.stringify({ ...result, artifact_root: out }, null, 2))
await Bun.write(path.join(out, "summary.md"), `${lines.join("\n")}\n`)
await Bun.write(path.join(out, "logs", "selfcheck.log"), `${lines.join("\n")}\n`)
await Bun.write(path.join(out, "artifacts", "catalog.json"), JSON.stringify(run.catalog, null, 2))
await Promise.all(
  BenchmarkCatalog.Suite.options.map((suite) =>
    Bun.write(
      path.join(out, "artifacts", "manifests", `${suite}.json`),
      JSON.stringify(run.catalog.manifests[suite], null, 2),
    ),
  ),
)
await Bun.write(path.join(caseRoot, "result.json"), JSON.stringify({ ...result, job_root: run.catalog.root }, null, 2))
await Bun.write(path.join(caseRoot, "stdout.log"), `${lines.join("\n")}\n`)
await Bun.write(path.join(caseRoot, "stderr.log"), "")
await Bun.write(
  path.join(caseRoot, "job.json"),
  JSON.stringify(
    {
      gate: "catalog self-check",
      root: run.catalog.root,
      smoke: run.catalog.smoke,
    },
    null,
    2,
  ),
)
await Bun.write(path.join(caseRoot, "artifacts", "catalog.json"), JSON.stringify(run.catalog, null, 2))

console.log(JSON.stringify({ artifact_root: out, status: run.status, counts: run.counts }, null, 2))

if (run.status === "fail") process.exit(1)
