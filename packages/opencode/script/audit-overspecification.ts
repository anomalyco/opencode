#!/usr/bin/env bun

import PROMPT_ANTHROPIC from "../src/session/prompt/anthropic.txt"
import PROMPT_QWEN from "../src/session/prompt/qwen.txt"
import PROMPT_BEAST from "../src/session/prompt/beast.txt"
import PROMPT_GEMINI from "../src/session/prompt/gemini.txt"
import PROMPT_CODEX from "../src/session/prompt/codex_header.txt"
import PROMPT_TRINITY from "../src/session/prompt/trinity.txt"
import PROMPT_PLAN from "../src/session/prompt/plan.txt"
import PROMPT_BUILD_SWITCH from "../src/session/prompt/build-switch.txt"
import PROMPT_MAX_STEPS from "../src/session/prompt/max-steps.txt"

import PROMPT_EXPLORE from "../src/agent/prompt/explore.txt"
import PROMPT_COMPACTION from "../src/agent/prompt/compaction.txt"
import PROMPT_SUMMARY from "../src/agent/prompt/summary.txt"
import PROMPT_TITLE from "../src/agent/prompt/title.txt"
import PROMPT_GENERATE from "../src/agent/generate.txt"

interface PromptAuditResult {
  name: string
  file: string
  type: "provider" | "utility" | "agent" | "meta"
  lines: number
  chars: number
  tokens: number
  directives: {
    must: number
    never: number
    always: number
    important: number
    critical: number
    total: number
  }
  examples: number
  violations: string[]
}

interface Threshold {
  type: "provider" | "utility" | "agent" | "meta"
  tokenLimit: number
  directiveLimit: number
  exampleLimit: number
}

const THRESHOLDS: Threshold[] = [
  { type: "provider", tokenLimit: 1500, directiveLimit: 12, exampleLimit: 5 },
  { type: "utility", tokenLimit: 200, directiveLimit: 4, exampleLimit: 0 },
  { type: "agent", tokenLimit: 400, directiveLimit: 6, exampleLimit: 3 },
  { type: "meta", tokenLimit: 800, directiveLimit: 0, exampleLimit: 0 },
]

function estimateTokens(content: string): number {
  return Math.max(0, Math.round((content || "").length / 4))
}

function countDirectives(content: string): PromptAuditResult["directives"] {
  const must = (content.match(/\bMUST\b/gi) || []).length
  const never = (content.match(/\bNEVER\b/gi) || []).length
  const always = (content.match(/\bALWAYS\b/gi) || []).length
  const important = (content.match(/\bIMPORTANT\b/gi) || []).length
  const critical = (content.match(/\bCRITICAL\b/gi) || []).length

  return {
    must,
    never,
    always,
    important,
    critical,
    total: must + never + always + important + critical,
  }
}

function countExamples(content: string): number {
  const xmlExamples = (content.match(/<example>[\s\S]*?<\/example>/g) || []).length

  const lines = content.split("\n")
  let markdownExamples = 0
  let inExample = false

  for (const line of lines) {
    const trimmed = line.trim().toLowerCase()
    if (trimmed.startsWith("user:") || trimmed.startsWith("assistant:") || trimmed.startsWith("model:")) {
      if (!inExample) {
        inExample = true
        markdownExamples++
      }
    } else if (line.trim() === "" || line.trim().startsWith("<") || line.trim().startsWith("```")) {
      inExample = false
    }
  }

  return xmlExamples + markdownExamples
}

function countLines(content: string): number {
  return content.split("\n").length
}

function auditPrompt(name: string, file: string, type: PromptAuditResult["type"], content: string): PromptAuditResult {
  const lines = countLines(content)
  const chars = content.length
  const tokens = estimateTokens(content)
  const directives = countDirectives(content)
  const examples = countExamples(content)

  const threshold = THRESHOLDS.find((t) => t.type === type)!
  const violations: string[] = []

  if (tokens > threshold.tokenLimit) {
    violations.push(`tokens: ${tokens} > ${threshold.tokenLimit}`)
  }
  if (directives.total > threshold.directiveLimit) {
    violations.push(`directives: ${directives.total} > ${threshold.directiveLimit}`)
  }
  if (examples > threshold.exampleLimit) {
    violations.push(`examples: ${examples} > ${threshold.exampleLimit}`)
  }

  return {
    name,
    file,
    type,
    lines,
    chars,
    tokens,
    directives,
    examples,
    violations,
  }
}

const prompts: Array<{ name: string; file: string; type: PromptAuditResult["type"]; content: string }> = [
  { name: "anthropic", file: "src/session/prompt/anthropic.txt", type: "provider", content: PROMPT_ANTHROPIC },
  { name: "qwen", file: "src/session/prompt/qwen.txt", type: "provider", content: PROMPT_QWEN },
  { name: "beast", file: "src/session/prompt/beast.txt", type: "provider", content: PROMPT_BEAST },
  { name: "gemini", file: "src/session/prompt/gemini.txt", type: "provider", content: PROMPT_GEMINI },
  { name: "codex_header", file: "src/session/prompt/codex_header.txt", type: "provider", content: PROMPT_CODEX },
  { name: "trinity", file: "src/session/prompt/trinity.txt", type: "provider", content: PROMPT_TRINITY },
  { name: "plan", file: "src/session/prompt/plan.txt", type: "utility", content: PROMPT_PLAN },
  { name: "build-switch", file: "src/session/prompt/build-switch.txt", type: "utility", content: PROMPT_BUILD_SWITCH },
  { name: "max-steps", file: "src/session/prompt/max-steps.txt", type: "utility", content: PROMPT_MAX_STEPS },
  { name: "explore", file: "src/agent/prompt/explore.txt", type: "agent", content: PROMPT_EXPLORE },
  { name: "compaction", file: "src/agent/prompt/compaction.txt", type: "agent", content: PROMPT_COMPACTION },
  { name: "summary", file: "src/agent/prompt/summary.txt", type: "agent", content: PROMPT_SUMMARY },
  { name: "title", file: "src/agent/prompt/title.txt", type: "agent", content: PROMPT_TITLE },
  { name: "generate", file: "src/agent/generate.txt", type: "meta", content: PROMPT_GENERATE },
]

function main() {
  console.log("Prompt Overspecification Audit")
  console.log("=============================\n")

  const results = prompts.map((p) => auditPrompt(p.name, p.file, p.type, p.content))

  const byType: Record<string, PromptAuditResult[]> = {
    provider: [],
    utility: [],
    agent: [],
    meta: [],
  }

  for (const r of results) {
    byType[r.type].push(r)
  }

  let totalViolations = 0

  for (const [type, typeResults] of Object.entries(byType)) {
    if (typeResults.length === 0) continue

    const threshold = THRESHOLDS.find((t) => t.type === type)!
    console.log(
      `\n${type.toUpperCase()} PROMPTS (thresholds: ≤${threshold.tokenLimit} tokens, ≤${threshold.directiveLimit} directives, ≤${threshold.exampleLimit} examples)`,
    )
    console.log("-".repeat(100))
    console.log(
      `${"Name".padEnd(15)} ${"Lines".padStart(6)} ${"Tokens".padStart(7)} ${"Directives".padStart(11)} ${"Examples".padStart(9)} ${"Status".padStart(10)}`,
    )
    console.log("-".repeat(100))

    for (const r of typeResults) {
      const hasViolations = r.violations.length > 0
      const status = hasViolations ? "❌ FAIL" : "✓ PASS"
      const directives =
        `${r.directives.total} (M:${r.directives.must},N:${r.directives.never},I:${r.directives.important})`.padStart(
          11,
        )

      console.log(
        `${r.name.padEnd(15)} ${r.lines.toString().padStart(6)} ${r.tokens.toString().padStart(7)} ${directives} ${r.examples.toString().padStart(9)} ${status.padStart(10)}`,
      )

      if (hasViolations) {
        totalViolations += r.violations.length
        for (const v of r.violations) {
          console.error(`    ⚠️  ${v}`)
        }
      }
    }
  }

  console.log("\n" + "=".repeat(100))
  console.log(`\nSummary: ${totalViolations} violation(s) across ${results.length} prompt files`)

  if (totalViolations > 0) {
    console.error("\n⚠️  Some prompts exceed recommended thresholds.")
    console.error("   Review violations above and consider optimization.")
  } else {
    console.log("\n✓ All prompts are within recommended thresholds.")
  }

  process.exit(0)
}

main()
