#!/usr/bin/env bun

// skill-vetter — deterministic quality/security gate for a skill directory. It flags concrete risk
// patterns (NOT lines of code) and fails on any HIGH finding. The skills audit's worst issues were
// SSRF, hardcoded secrets, unsafe JSON.parse, "remote/LLM as a data source", and 0% tests — this
// catches those mechanically. See docs/adr/0001 and .opencode/skills/AUTHORING.md.
//
//   bun run script/skills/vetter.ts .opencode/skills/report-builder
//   bun run script/skills/vetter.ts --json <skill-dir>

import { Glob } from "bun"
import path from "node:path"
import { existsSync } from "node:fs"

type Severity = "high" | "medium" | "info"
type Finding = { severity: Severity; rule: string; file: string; line: number; message: string }

const args = process.argv.slice(2)
const json = args.includes("--json")
const target = args.find((a) => !a.startsWith("--"))
if (!target) {
  console.error("usage: vetter.ts [--json] <skill-dir>")
  process.exit(2)
}
const root = path.resolve(target)
if (!existsSync(path.join(root, "SKILL.md"))) {
  console.error(`vetter: ${target} has no SKILL.md (not a skill directory)`)
  process.exit(2)
}

const TEXT = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".py", ".sh", ".md", ".json"])
const CODE = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".py"])

const LINE_RULES = [
  {
    rule: "remote-data",
    severity: "high" as const,
    code: true,
    test: /\b(fetch|axios|requests\.(get|post)|urllib\.request|http\.get)\s*\(/,
    message:
      "network call in a skill — read local, caller-provided data and reuse .opencode/skills/lib (SSRF / remote-as-data-source)",
  },
  {
    rule: "hardcoded-secret",
    severity: "high" as const,
    code: false,
    test: /(api[_-]?key|secret|token|password|passwd|bearer)\s*[:=]\s*['"][A-Za-z0-9_\-/+]{16,}['"]/i,
    message: "looks like a hardcoded secret — read it from env/config instead",
  },
  {
    rule: "unsafe-json-parse",
    severity: "medium" as const,
    code: true,
    test: /\bJSON\.parse\s*\(/,
    message: "raw JSON.parse on possibly-untrusted input — prefer Schema.decodeUnknownOption or validate the shape",
  },
]

async function listFiles() {
  const result: string[] = []
  for await (const file of new Glob("**/*").scan({ cwd: root, dot: true })) {
    if (file.includes("node_modules") || file.includes(".cache")) continue
    if (TEXT.has(path.extname(file))) result.push(file)
  }
  return result.sort()
}

const scanned = await listFiles()
const findings: Finding[] = []

for (const rel of scanned) {
  const isCode = CODE.has(path.extname(rel))
  const lines = (await Bun.file(path.join(root, rel)).text()).split("\n")
  lines.forEach((content, index) => {
    for (const rule of LINE_RULES) {
      if (rule.code && !isCode) continue
      if (rule.test.test(content))
        findings.push({ severity: rule.severity, rule: rule.rule, file: rel, line: index + 1, message: rule.message })
    }
  })
  if (lines.length > 800)
    findings.push({
      severity: "info",
      rule: "large-file",
      file: rel,
      line: lines.length,
      message: `${lines.length} lines — check cohesion (informational, never a failure)`,
    })
}

const hasTests = scanned.some((f) => /(\.test\.(ts|js)|(^|\/)(test_|.*_test)\.py)$/.test(f) || f.includes("/test/"))
if (!hasTests)
  findings.push({
    severity: "high",
    rule: "missing-tests",
    file: ".",
    line: 0,
    message: "no tests found — every skill ships with tests (the audit's #1 gap was 0% coverage)",
  })

if (!scanned.some((f) => f.toLowerCase().includes("eval")))
  findings.push({
    severity: "medium",
    rule: "missing-eval",
    file: ".",
    line: 0,
    message: "no eval set found — add eval/ queries so skill quality is measurable",
  })

const frontmatter = (await Bun.file(path.join(root, "SKILL.md")).text()).split("---")[1] ?? ""
if (!/^name:\s*\S+/m.test(frontmatter))
  findings.push({
    severity: "medium",
    rule: "frontmatter-name",
    file: "SKILL.md",
    line: 1,
    message: "SKILL.md frontmatter is missing a `name:`",
  })

const status = findings.some((f) => f.severity === "high") ? "fail" : "pass"

if (json) {
  console.log(JSON.stringify({ skill: path.basename(root), status, findings }, null, 2))
} else {
  console.log(`\nskill-vetter ${path.basename(root)} → ${status.toUpperCase()} (${findings.length} findings)`)
  for (const f of findings) {
    const tag = f.severity === "high" ? "HIGH" : f.severity === "medium" ? "MED " : "INFO"
    console.log(`  [${tag}] ${f.rule} ${f.file}:${f.line} — ${f.message}`)
  }
  console.log("\nLOC is informational only; pass/fail is driven by HIGH findings.")
}

process.exit(status === "fail" ? 1 : 0)
