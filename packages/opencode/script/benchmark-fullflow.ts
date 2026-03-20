#!/usr/bin/env bun

import path from "path"
import { fileURLToPath } from "url"
import { BenchmarkFullflow } from "../src/eda/benchmark/fullflow"

const pkg = fileURLToPath(new URL("..", import.meta.url))
const repo = path.resolve(pkg, "..", "..")
const args = process.argv.slice(2)
const list = args.includes("--list") || process.env.OPENCODE_BENCHMARK_LIST === "1"
const vals = args.filter((row) => row !== "--list")
const jobs = vals[0] || process.env.OPENCODE_BENCHMARK_JOBS_ROOT
const name = vals[1] || process.env.OPENCODE_BENCHMARK_CASE
const man = await BenchmarkFullflow.load(jobs)

if (list) {
  console.log(
    JSON.stringify(
      {
        suite: man.suite,
        root: man.root,
        smoke: man.smoke,
        cases: man.cases.map((row) => ({
          name: row.name,
          job: row.job,
          start: row.start,
        })),
      },
      null,
      2,
    ),
  )
  process.exit(0)
}

const run = await BenchmarkFullflow.run({
  jobs,
  repo,
  root: path.join(repo, "benchmark"),
  tag: process.env.OPENCODE_BENCHMARK_TAG,
  name,
})

console.log(
  JSON.stringify(
    {
      artifact_root: run.root,
      status: run.status,
      suite: run.suite,
      case: run.name,
      job: run.job,
      missing: run.missing,
      cases: man.cases.map((row) => row.name),
    },
    null,
    2,
  ),
)

if (run.status === "fail") process.exit(1)
