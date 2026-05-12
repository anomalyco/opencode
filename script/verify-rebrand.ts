#!/usr/bin/env bun

/**
 * verify-rebrand.ts — Verify OpenCode→Octopus rebrand completion
 *
 * Usage:
 *   bun run script/verify-rebrand.ts              # Verify all Issues
 *   bun run script/verify-rebrand.ts --issue 1,2   # Verify specific Issues
 *   bun run script/verify-rebrand.ts --verbose      # Show match details
 *   bun run script/verify-rebrand.ts --json         # JSON output for CI
 *
 * Run from repo root.
 */

import { Glob } from "bun"
import { existsSync } from "node:fs"
import { resolve } from "node:path"

interface CheckResult {
  issue: number
  name: string
  passed: boolean
  matches: string[]
  fileCount: number
  durationMs: number
}

interface CheckDef {
  name: string
  run: () => Promise<CheckResult>
}

const args = process.argv.slice(2)
const issueFilter = args.includes("--issue")
  ? (args[args.indexOf("--issue") + 1]?.split(",").map(Number) ?? null)
  : null
const verbose = args.includes("--verbose")
const jsonOutput = args.includes("--json")

const ROOT = import.meta.dir ? resolve(import.meta.dir, "..") : process.cwd()
const EXCLUDE = "node_modules|dist|.turbo|bun.lock"
const EXCLUDE_FILE = /node_modules|dist|\.turbo|bun\.lock|verify-rebrand\.ts|rebrand-smoke\.ts/

async function grepFiles(pattern: string, include: string, exclude = EXCLUDE): Promise<string[]> {
  const glob = new Glob(`**/*.${include.replace("*.", "")}`)
  const results: string[] = []
  for await (const file of glob.scan({ cwd: ROOT, absolute: true, onlyFiles: true })) {
    if (exclude && new RegExp(exclude).test(file)) continue
    if (file.includes("verify-rebrand.ts") || file.includes("rebrand-smoke.ts")) continue
    const content = await Bun.file(file).text()
    const lines = content.split("\n")
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(pattern)) {
        results.push(`${file.replace(ROOT + "/", "")}:${i + 1}`)
      }
    }
  }
  return results
}

const checks: CheckDef[] = [
  // Issue 1: npm scope
  {
    name: "Issue 1: npm scope @opencode-ai/",
    run: async () => {
      const start = Date.now()
      const matches = await grepFiles("@opencode-ai/", "*.ts")
      const tsxMatches = await grepFiles("@opencode-ai/", "*.tsx")
      const allMatches = [...matches, ...tsxMatches].filter(
        (m) =>
          !m.includes("gitlab/opencode") &&
          !m.includes("opencode-poe") &&
          !m.includes("opencode-gitlab") &&
          !m.includes("@opentui"),
      )
      return {
        issue: 1,
        name: "npm scope",
        passed: allMatches.length === 0,
        matches: allMatches,
        fileCount: new Set(allMatches.map((m) => m.split(":")[0])).size,
        durationMs: Date.now() - start,
      }
    },
  },
  // Issue 2: directory rename
  {
    name: "Issue 2: packages/opencode/ directory",
    run: async () => {
      const start = Date.now()
      const dirExists = existsSync(resolve(ROOT, "packages/opencode"))
      const matches: string[] = []
      if (dirExists) matches.push("packages/opencode/ directory still exists")
      return {
        issue: 2,
        name: "directory rename",
        passed: !dirExists,
        matches,
        fileCount: dirExists ? 1 : 0,
        durationMs: Date.now() - start,
      }
    },
  },
  // Issue 3: API identifiers
  {
    name: "Issue 3: API identifiers",
    run: async () => {
      const start = Date.now()
      const matches = await grepFiles("OpencodeClient", "*.ts")
      const matches2 = await grepFiles("createOpencode", "*.ts")
      const allMatches = matches.filter((m) => !m.includes("OCTOPUS_CLIENT")).concat(matches2)
      return {
        issue: 3,
        name: "API identifiers",
        passed: allMatches.length === 0,
        matches: allMatches,
        fileCount: new Set(allMatches.map((m) => m.split(":")[0])).size,
        durationMs: Date.now() - start,
      }
    },
  },
  // Issue 4: env vars (OPENCODE_ prefix)
  {
    name: "Issue 4: OPENCODE_ env vars",
    run: async () => {
      const start = Date.now()
      const matches = await grepFiles("OPENCODE_", "*.ts")
      const filtered = matches.filter(
        (m) =>
          !m.includes("OTEL_") && !m.includes("@openauthjs") && !m.includes("/opencode.") && !m.includes(".opencode/"),
      )
      return {
        issue: 4,
        name: "OPENCODE_ env vars",
        passed: filtered.length === 0,
        matches: filtered,
        fileCount: new Set(filtered.map((m) => m.split(":")[0])).size,
        durationMs: Date.now() - start,
      }
    },
  },
  // Issue 9: docs paths (quick check)
  {
    name: "Issue 9: ~/.config/opencode/ in docs",
    run: async () => {
      const start = Date.now()
      const matches = await grepFiles("~/.config/opencode/", "*.md")
      return {
        issue: 9,
        name: "docs config paths",
        passed: matches.length === 0,
        matches,
        fileCount: new Set(matches.map((m) => m.split(":")[0])).size,
        durationMs: Date.now() - start,
      }
    },
  },
]

async function main() {
  const results: CheckResult[] = []
  for (const check of checks) {
    if (issueFilter) {
      const issueNum = parseInt(check.name.match(/Issue (\d+)/)?.[1] ?? "0")
      if (!issueFilter.includes(issueNum)) continue
    }
    const result = await check.run()
    results.push(result)
  }

  if (jsonOutput) {
    console.log(JSON.stringify(results, null, 2))
  } else {
    for (const r of results) {
      const icon = r.passed ? "✅" : "❌"
      console.log(`${icon} ${r.name}: ${r.passed ? "PASS" : "FAIL"} (${r.durationMs}ms, ${r.fileCount} files)`)
      if (!r.passed && r.matches.length > 0) {
        for (const m of verbose ? r.matches : r.matches.slice(0, 5)) {
          console.log(`   ${m}`)
        }
        if (!verbose && r.matches.length > 5) console.log(`   ... and ${r.matches.length - 5} more`)
      }
    }
    const failed = results.filter((r) => !r.passed)
    if (failed.length > 0) {
      console.log(`\n❌ ${failed.length} check(s) failed`)
      process.exit(1)
    } else {
      console.log(`\n✅ All ${results.length} check(s) passed`)
    }
  }
}

main()
