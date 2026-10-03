#!/usr/bin/env bun

import { $ } from "bun"
import os from "os"

// tsgo (TypeScript-Go) peaks at ~84 MB committed memory per process during startup.
// On Windows, the commit limit (RAM + pagefile) can be nearly exhausted by other processes.
// Running 30 tsgo processes in parallel can exceed the remaining commit budget, causing
// fatal OOM crashes (errno=1455). This script limits turbo's concurrency based on available
// commit memory to prevent that. See https://github.com/anomalyco/opencode/issues/49224.
const MB_PER_PROCESS = 100

function computeConcurrency(cpuCount: number, freeMB: number) {
  return Math.max(1, Math.min(cpuCount, Math.floor(freeMB / MB_PER_PROCESS)))
}

const task = process.argv[2]
if (!task) {
  console.error("Usage: bun run script/turbo.ts <task> [extra turbo args...]")
  process.exit(1)
}

const extraArgs = process.argv.slice(3)

if (process.platform === "win32") {
  const freeMB = Math.floor(os.freemem() / (1024 * 1024))
  const cpuCount = os.availableParallelism()
  const concurrency = computeConcurrency(cpuCount, freeMB)
  console.log(`turbo ${task}: concurrency=${concurrency} (cpus=${cpuCount}, free=${freeMB}MB)`)
  await $`bun turbo ${task} --concurrency=${concurrency} ${extraArgs}`
} else {
  await $`bun turbo ${task} ${extraArgs}`
}
