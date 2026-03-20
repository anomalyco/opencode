#!/usr/bin/env bun

import path from "path"
import { fileURLToPath } from "url"
import { BenchmarkSmoke } from "../src/eda/benchmark/smoke"

const pkg = fileURLToPath(new URL("..", import.meta.url))
const repo = path.resolve(pkg, "..", "..")
const run = await BenchmarkSmoke.run({
  jobs: process.argv[2] || process.env.OPENCODE_BENCHMARK_JOBS_ROOT,
  repo,
  root: path.join(repo, "benchmark"),
  tag: process.env.OPENCODE_BENCHMARK_TAG,
  name: process.argv[3] || process.env.OPENCODE_BENCHMARK_CASE,
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
    },
    null,
    2,
  ),
)

if (run.status === "fail") process.exit(1)
