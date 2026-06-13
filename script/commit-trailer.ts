#!/usr/bin/env bun

// Build an enriched commit trailer from verification evidence. Every number comes from the tools
// (script/verify.ts --json), never from a model. See docs/adr/0001-verification-and-quality-pipeline.
//
//   bun run script/verify.ts --json packages/core | bun run script/commit-trailer.ts
//   bun run script/commit-trailer.ts report.json

type Gate = { stage: string; status: string; numbers: Record<string, number> }
type Report = { package?: string; status?: string; gates?: Gate[] }

async function read() {
  const file = process.argv[2]
  if (file) return Bun.file(file).text()
  return new Response(Bun.stdin.stream()).text()
}

const raw = (await read()).trim()
if (!raw) {
  console.error("commit-trailer: no verify JSON on stdin or as an argument")
  process.exit(2)
}

const report = JSON.parse(raw) as Report
if (!Array.isArray(report.gates)) {
  console.error("commit-trailer: input is not a verify report (missing gates[])")
  process.exit(2)
}

const byStage = new Map(report.gates.map((gate) => [gate.stage, gate]))
const lines = ["Verified-by: opencode/verify"]

const typecheck = byStage.get("typecheck")
if (typecheck) lines.push(`Typecheck: ${typecheck.status}`)

const test = byStage.get("test")
if (test && test.status !== "skip") {
  const passed = test.numbers.pass ?? 0
  const failed = test.numbers.fail ?? 0
  lines.push(`Tests: ${passed} passed${failed ? `, ${failed} failed` : ""}`)
  if (test.numbers.coverage !== undefined) lines.push(`Coverage: ${test.numbers.coverage}%`)
}

const lint = byStage.get("lint")
if (lint) lines.push(`Lint: ${lint.status}`)

console.log(lines.join("\n"))
