#!/usr/bin/env bun

// Verification gate. Runs deterministic tools (typecheck, test, lint) from a package directory and
// reports structured evidence. The LLM orchestrates and repairs; this script verifies. It makes NO
// model calls and does not touch the Session core (see docs/adr/0001-verification-and-quality-pipeline).
//
//   bun run script/verify.ts                  # default target: packages/opencode
//   bun run script/verify.ts packages/core    # verify a specific package
//   bun run script/verify.ts --json           # machine-readable evidence for the agent
//   bun run script/verify.ts --bail           # stop at the first failing gate

import path from "node:path"
import { existsSync } from "node:fs"

type Status = "pass" | "fail" | "skip"
type Gate = {
  stage: string
  tool: string
  status: Status
  durationMs: number
  evidence: string
  numbers: Record<string, number>
}

const args = process.argv.slice(2)
const json = args.includes("--json")
const bail = args.includes("--bail")
const target = args.find((a) => !a.startsWith("--")) ?? "packages/opencode"
const root = process.cwd()
const dir = path.resolve(root, target)

if (!existsSync(path.join(dir, "package.json"))) {
  console.error(`verify: no package.json at ${target}`)
  process.exit(2)
}

const pkg = (await Bun.file(path.join(dir, "package.json")).json()) as {
  name?: string
  scripts?: Record<string, string>
}
const name = pkg.name ?? path.basename(dir)
const hasTests = existsSync(path.join(dir, "test")) || Boolean(pkg.scripts?.test)

function tail(text: string, lines = 20) {
  return text.trimEnd().split("\n").slice(-lines).join("\n")
}

function extract(stage: string, text: string): Record<string, number> {
  const numbers: Record<string, number> = {}
  if (stage === "test") {
    const pass = text.match(/(\d+)\s+pass/)
    const fail = text.match(/(\d+)\s+fail/)
    if (pass) numbers.pass = Number(pass[1])
    if (fail) numbers.fail = Number(fail[1])
  }
  const coverage = text.match(/All files\s*\|\s*([\d.]+)/)
  if (coverage) numbers.coverage = Number(coverage[1])
  return numbers
}

async function runGate(stage: string, tool: string, argv: string[], cwd: string): Promise<Gate> {
  const started = Bun.nanoseconds()
  const proc = Bun.spawn(argv, { cwd, stdout: "pipe", stderr: "pipe", env: { ...process.env, FORCE_COLOR: "0" } })
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  const combined = (out + err).trim()
  return {
    stage,
    tool,
    status: code === 0 ? "pass" : "fail",
    durationMs: Math.round((Bun.nanoseconds() - started) / 1e6),
    evidence: tail(combined),
    numbers: extract(stage, combined),
  }
}

// Each gate is a real tool. Tests run from the package directory (do-not-run-tests-from-root);
// typecheck goes through turbo filtered to this package; lint scopes oxlint to the package dir.
const plan = [
  {
    stage: "typecheck",
    tool: "bun turbo typecheck",
    argv: ["bun", "turbo", "typecheck", `--filter=${name}`],
    cwd: root,
    skip: false,
  },
  { stage: "test", tool: "bun test", argv: ["bun", "test"], cwd: dir, skip: !hasTests },
  { stage: "lint", tool: "oxlint", argv: ["bun", "run", "lint", dir], cwd: root, skip: false },
]

const gates: Gate[] = []
for (const step of plan) {
  if (step.skip) {
    gates.push({
      stage: step.stage,
      tool: step.tool,
      status: "skip",
      durationMs: 0,
      evidence: "no tests in package",
      numbers: {},
    })
    continue
  }
  const gate = await runGate(step.stage, step.tool, step.argv, step.cwd)
  gates.push(gate)
  if (bail && gate.status === "fail") break
}

const status: Status = gates.some((g) => g.status === "fail") ? "fail" : "pass"
const report = { package: name, dir: target, status, gates }

if (json) {
  console.log(JSON.stringify(report, null, 2))
} else {
  console.log(`\nverify ${name} → ${status.toUpperCase()}`)
  for (const gate of gates) {
    const mark = gate.status === "pass" ? "✓" : gate.status === "fail" ? "✗" : "·"
    const numbers = Object.entries(gate.numbers)
      .map(([key, value]) => `${key}=${value}`)
      .join(" ")
    console.log(`  ${mark} ${gate.stage.padEnd(10)} ${gate.tool.padEnd(22)} ${gate.durationMs}ms ${numbers}`)
    if (gate.status === "fail")
      console.log(
        gate.evidence
          .split("\n")
          .map((line) => "      " + line)
          .join("\n"),
      )
  }
}

process.exit(status === "fail" ? 1 : 0)
