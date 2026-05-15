#!/usr/bin/env bun

import { $ } from "bun"
import path from "path"

const args = process.argv.slice(2)
const build = args.includes("--build")
const positional = args.filter((arg) => arg !== "--build")
const runs = Number.parseInt(positional[0] ?? "5", 10)
const target = positional[1] ?? "dev"
const root = path.resolve(import.meta.dir, "../../..")
const packageRoot = path.resolve(import.meta.dir, "..")
const session = `opencode-bench-${process.pid}`

if (!Number.isFinite(runs) || runs <= 0) {
  console.error("usage: bun run script/benchmark-startup.ts [runs] [dev|release] [--build]")
  process.exit(1)
}

if (target !== "dev" && target !== "release") {
  console.error("target must be dev or release")
  process.exit(1)
}

const command =
  target === "release"
    ? "OPENCODE_PERF_STDERR=1 ./dist/opencode-darwin-arm64/bin/opencode >\"/dev/null\" 2>\"/tmp/logs\""
    : "OPENCODE_PERF_STDERR=1 bun dev >\"/dev/null\" 2>\"/tmp/logs\""
const workdir = target === "release" ? packageRoot : root
const values: number[] = []

if (build) {
  console.log("building release binary before benchmark")
  await $`bun run script/build.ts --single --skip-install --skip-embed-web-ui`.cwd(packageRoot)
}

for (let i = 0; i < runs; i++) {
  const logPath = `/tmp/opencode-bench-${process.pid}-${i}.log`
  const shellCommand = `${command.replace('/tmp/logs', logPath)}`
  await $`tmux kill-session -t ${session} 2>/dev/null`.quiet().nothrow()
  await $`rm -f ${logPath}`.quiet()
  await $`tmux new-session -d -s ${session} 'cd ${workdir} && ${shellCommand}'`.quiet()
  let text = ""
  for (let j = 0; j < 150; j++) {
    text = await Bun.file(logPath).text().catch(() => "")
    if (/opencode perf: tui-ready [0-9]+ms/.test(text)) break
    await $`sleep 0.02`.quiet()
  }
  await $`tmux kill-session -t ${session} 2>/dev/null`.quiet().nothrow()
  const matches = [...text.matchAll(/opencode perf: tui-ready ([0-9]+)ms/g)]
  const match = matches.at(-1)
  if (!match) continue
  const value = Number.parseInt(match[1], 10)
  if (Number.isNaN(value)) continue
  values.push(value)
  console.log(`${target} run ${i + 1}: ${value}ms`)
}

if (values.length === 0) {
  console.error("No measurements collected")
  process.exit(1)
}

if (values.length < runs) {
  console.error(`Collected ${values.length}/${runs} samples`)
}

const sorted = [...values].sort((a, b) => a - b)
const min = sorted[0]!
const max = sorted.at(-1)!
const avg = Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
const median = sorted[Math.floor(sorted.length / 2)]!

console.log(`summary (${target}, n=${values.length}): min=${min}ms median=${median}ms avg=${avg}ms max=${max}ms`)
