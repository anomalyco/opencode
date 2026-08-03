#!/usr/bin/env bun

/**
 * Count lines of code in the codebase.
 * Usage: bun run script/count-loc.ts [directory] [--detailed] [--include-ext ext1,ext2]
 *
 * By default scans packages/ and sdks/ excluding node_modules, dist, .git, and build artifacts.
 * Pass a directory path to scan a specific location instead.
 *
 * Flags:
 *   --help           Show this help message
 *   --detailed       Show per-file breakdown
 *   --include-ext    Comma-separated list of extensions to include (e.g. "ts,tsx,go")
 *   --all            Include blank lines in counts (default: blank lines excluded)
 */

import { readdir, stat, readFile } from "node:fs/promises"
import { join, relative, extname } from "node:path"

const ROOT = join(import.meta.dirname, "..")

const DEFAULT_DIRS = ["packages", "sdks"]
const DEFAULT_EXTS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".go", ".rs", ".py", ".rb",
  ".css", ".scss", ".sass", ".less",
  ".html", ".vue", ".svelte",
  ".json", ".yaml", ".yml", ".toml",
  ".md", ".mdx",
  ".sql",
  ".sh", ".bash", ".zsh",
  ".Dockerfile",
])

const EXCLUDE_DIRS = new Set([
  "node_modules", ".git", ".claude", "dist", ".next",
  ".turbo", ".sst", "build", "out", "coverage",
  "__pycache__", ".venv", "venv", "target",
  ".idea", ".vscode", ".zed",
])

const EXCLUDE_PATTERNS = [
  /\.test\./, /\.spec\./, /\.d\.ts$/,
  /bun\.lock/, /pnpm-lock/, /package-lock/, /yarn\.lock/,
  /\.map$/, /\.generated\./,
]

// ── CLI ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2)

if (args.includes("--help") || args.includes("-h")) {
  console.log(`Usage: bun run script/count-loc.ts [directory] [flags]

Count lines of code in the codebase. By default scans packages/ and sdks/.

Flags:
  --help, -h       Show this help message
  --detailed       Show per-file breakdown sorted by line count
  --all            Include blank lines in counts (default: blank lines excluded)
  --include-ext    Comma-separated extensions to include (e.g. "ts,tsx,go")
                   Without this flag, all common source extensions are counted.

Examples:
  bun run script/count-loc.ts
  bun run script/count-loc.ts packages/core
  bun run script/count-loc.ts --include-ext ts,tsx
  bun run script/count-loc.ts packages/core --include-ext ts --detailed
  bun run script/count-loc.ts --all`)
  process.exit(0)
}

const detailed = args.includes("--detailed")
const includeBlank = args.includes("--all")

let includeExts: Set<string> | null = null
const extFlagIdx = args.findIndex((a) => a === "--include-ext")
if (extFlagIdx !== -1 && args[extFlagIdx + 1]) {
  includeExts = new Set(
    args[extFlagIdx + 1].split(",").map((e) => (e.startsWith(".") ? e : `.${e}`))
  )
}

const targetArg = args.find((a) => !a.startsWith("--") && a !== args[extFlagIdx + 1])
const scanDirs = targetArg ? [targetArg] : DEFAULT_DIRS

// ── Helpers ──────────────────────────────────────────────────────────

function shouldExcludeDir(name: string): boolean {
  return EXCLUDE_DIRS.has(name)
}

function shouldExcludeFile(filePath: string): boolean {
  return EXCLUDE_PATTERNS.some((p) => p.test(filePath))
}

function shouldIncludeExt(ext: string): boolean {
  if (includeExts) return includeExts.has(ext)
  return DEFAULT_EXTS.has(ext)
}

async function countLines(filePath: string): Promise<{ total: number; code: number }> {
  const content = await readFile(filePath, "utf-8")
  const lines = content.split("\n")
  // Handle trailing newline — don't count an empty string after the last \n
  const total = lines[lines.length - 1] === "" ? lines.length - 1 : lines.length
  const code = lines.filter((l) => l.trim() !== "").length
  return { total, code }
}

interface FileEntry {
  path: string
  ext: string
  total: number
  code: number
}

interface LangStats {
  files: number
  total: number
  code: number
}

// ── Scanner ──────────────────────────────────────────────────────────

async function scanDir(dir: string, entries: FileEntry[]): Promise<void> {
  let items: string[]
  try {
    items = await readdir(dir)
  } catch {
    return
  }

  for (const name of items) {
    if (shouldExcludeDir(name)) continue

    const fullPath = join(dir, name)
    let st: Awaited<ReturnType<typeof stat>>
    try {
      st = await stat(fullPath)
    } catch {
      continue
    }

    if (st.isDirectory()) {
      await scanDir(fullPath, entries)
    } else if (st.isFile()) {
      const relPath = relative(ROOT, fullPath)
      if (shouldExcludeFile(relPath)) continue

      const ext = extname(name).toLowerCase() || (name === "Dockerfile" ? ".Dockerfile" : ".other")
      if (!shouldIncludeExt(ext)) continue

      const { total, code } = await countLines(fullPath)
      entries.push({ path: relPath, ext, total, code })
    }
  }
}

// ── Report ───────────────────────────────────────────────────────────

function report(entries: FileEntry[]): void {
  const byLang = new Map<string, LangStats>()

  for (const e of entries) {
    const prev = byLang.get(e.ext) ?? { files: 0, total: 0, code: 0 }
    byLang.set(e.ext, {
      files: prev.files + 1,
      total: prev.total + e.total,
      code: prev.code + e.code,
    })
  }

  const sorted = [...byLang.entries()].sort((a, b) => b[1].code - a[1].code)

  console.log("\n╔══════════════════════════════════════════════╗")
  console.log("║           Lines of Code Report              ║")
  console.log("╠══════════════════════════════════════════════╣")

  const countField = includeBlank ? "total" : "code"
  const colLabel = includeBlank ? "Lines (incl. blank)" : "Code Lines"

  let grandFiles = 0
  let grandTotal = 0
  let grandCode = 0

  for (const [ext, stats] of sorted) {
    console.log(
      `║ ${ext.padEnd(10)} │ ${String(stats.files).padStart(5)} files │ ${String(stats[countField]).padStart(8)} ${colLabel}`
    )
    grandFiles += stats.files
    grandTotal += stats.total
    grandCode += stats.code
  }

  console.log("╠══════════════════════════════════════════════╣")
  console.log(
    `║ ${"TOTAL".padEnd(10)} │ ${String(grandFiles).padStart(5)} files │ ${String(includeBlank ? grandTotal : grandCode).padStart(8)} ${colLabel}`
  )
  console.log("╚══════════════════════════════════════════════╝")

  if (!includeBlank) {
    console.log(
      `\n(Including blank lines: ${grandTotal.toLocaleString()} total lines across ${grandFiles.toLocaleString()} files)`
    )
  }

  if (detailed) {
    console.log("\n── Per-file Breakdown ──\n")
    const sortedEntries = [...entries].sort((a, b) => b.code - a.code)
    for (const e of sortedEntries) {
      const n = includeBlank ? e.total : e.code
      console.log(`  ${String(n).padStart(6)}  ${e.path}`)
    }
  }
}

// ── Main ─────────────────────────────────────────────────────────────

const entries: FileEntry[] = []

for (const dir of scanDirs) {
  const fullPath = join(ROOT, dir)
  console.error(`Scanning ${relative(ROOT, fullPath)}...`)
  await scanDir(fullPath, entries)
}

if (entries.length === 0) {
  console.error("No matching files found.")
  process.exit(1)
}

report(entries)
