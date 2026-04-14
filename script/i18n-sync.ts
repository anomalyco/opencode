#!/usr/bin/env bun

import { checkKeys } from "./lib/detect"
import { fillAllKeys, fillKeys } from "./lib/fill"
import type { Options } from "./lib/types"

const args = process.argv.slice(2)
let command = "check"
let locale: string | undefined
let dryRun = true
let verbose = false
let source = "en"
let json = false

for (let i = 0; i < args.length; i++) {
  const arg = args[i]
  if (arg === "check" || arg === "fill") {
    command = arg
  } else if (arg === "--locale" && args[i + 1]) {
    locale = args[i + 1]
    i++
  } else if (arg === "--dry-run") {
    dryRun = true
  } else if (arg === "--apply") {
    dryRun = false
  } else if (arg === "--verbose" || arg === "-v") {
    verbose = true
  } else if (arg === "--source" && args[i + 1]) {
    source = args[i + 1]
    i++
  } else if (arg === "--json") {
    json = true
  } else if (arg === "--help" || arg === "-h") {
    printHelp()
    process.exit(0)
  }
}

const cwd = process.cwd()

if (command === "check") {
  const reports = await checkKeys(cwd, source)
  if (json) {
    console.log(JSON.stringify(reports, null, 2))
  } else {
    console.log("\nMissing keys per locale:")
    for (const report of reports) {
      console.log(`  ${report.locale}: ${report.count} missing`)
    }
    const total = reports.reduce((sum, r) => sum + r.count, 0)
    console.log(`\nTotal: ${total} missing keys across ${reports.length} locales`)
  }
} else if (command === "fill") {
  if (dryRun) {
    console.log("\nRunning in DRY RUN mode. Use --apply to write changes.\n")
  }
  let results
  if (locale) {
    const result = await fillKeys(cwd, source, locale, dryRun, verbose)
    results = [result]
  } else {
    results = await fillAllKeys(cwd, source, dryRun, verbose)
  }
  if (!json) {
    console.log("\nFill results:")
    for (const result of results) {
      console.log(`  ${result.locale}: +${result.added} added, ${result.skipped} skipped`)
    }
  }
  const totalAdded = results.reduce((sum, r) => sum + r.added, 0)
  if (!json) {
    console.log(`\nTotal: ${totalAdded} keys added`)
    if (dryRun) {
      console.log("\nRun with --apply to write changes.")
    }
  }
}

function printHelp() {
  console.log(`
i18n-sync - Synchronize i18n keys across locales

Usage:
  bun run script/i18n-sync.ts <command> [options]

Commands:
  check   Check for missing keys (default)
  fill    Fill missing keys with source language values

Options:
  --locale <code>    Target specific locale
  --source <code>    Source language (default: en)
  --apply           Write changes (default: dry-run)
  --dry-run         Preview without writing (default)
  --verbose, -v     Verbose output
  --json            JSON output
  --help, -h        Show this help

Examples:
  bun run script/i18n-sync.ts check
  bun run script/i18n-sync.ts check --locale ru
  bun run script/i18n-sync.ts fill --dry-run
  bun run script/i18n-sync.ts fill --apply
`.trim())
}