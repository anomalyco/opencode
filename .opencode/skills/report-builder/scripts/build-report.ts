#!/usr/bin/env bun

// report-builder: turn a LOCAL JSON data file into a Markdown report. No network, no model — the
// numbers come from the caller's file, never invented. See ../../AUTHORING.md and docs/adr/0001.

import path from "node:path"
import { assertLocalSource, resolveInside, fileCache, memoize, SkillSafetyError } from "../../lib/index"

export type ReportRow = { label: string; value: string | number }
export type ReportData = { title: string; generatedFor?: string; rows: ReportRow[] }

// Validate the caller's data instead of trusting it blindly (no raw JSON.parse of unknown shape).
export function parseReportData(value: unknown): ReportData {
  if (typeof value !== "object" || value === null) throw new SkillSafetyError("report data must be an object")
  const data = value as Record<string, unknown>
  if (typeof data.title !== "string") throw new SkillSafetyError("report data needs a string `title`")
  if (!Array.isArray(data.rows)) throw new SkillSafetyError("report data needs a `rows` array")
  const rows = data.rows.map((row) => {
    const record = row as Record<string, unknown>
    if (typeof record.label !== "string") throw new SkillSafetyError("each row needs a string `label`")
    if (typeof record.value !== "string" && typeof record.value !== "number")
      throw new SkillSafetyError("each row needs a string|number `value`")
    return { label: record.label, value: record.value }
  })
  const generatedFor = typeof data.generatedFor === "string" ? data.generatedFor : undefined
  return { title: data.title, generatedFor, rows }
}

export function render(data: ReportData): string {
  const header = [`# ${data.title}`, ""]
  if (data.generatedFor) header.push(`_For: ${data.generatedFor}_`, "")
  const table = ["| Metric | Value |", "| --- | --- |", ...data.rows.map((row) => `| ${row.label} | ${row.value} |`)]
  return [...header, ...table, ""].join("\n")
}

// CLI only when run directly, so tests can import render/parseReportData without side effects.
if (import.meta.main) {
  const args = process.argv.slice(2)
  const flag = (name: string) => {
    const index = args.indexOf(name)
    return index !== -1 ? args[index + 1] : undefined
  }
  const input = flag("--in")
  const outDir = flag("--out-dir") ?? "."
  const name = flag("--name") ?? "report.md"
  if (!input) {
    console.error("usage: build-report.ts --in <data.json> [--out-dir dir] [--name report.md]")
    process.exit(2)
  }
  assertLocalSource(input)
  const data = parseReportData(await Bun.file(input).json())
  const cache = fileCache(path.join(outDir, ".cache"))
  const output = await memoize(cache, JSON.stringify(data), async () => render(data))
  const target = resolveInside(path.resolve(outDir), name)
  await Bun.write(target, output)
  console.log(`wrote ${target} (${data.rows.length} rows)`)
}
