#!/usr/bin/env bun
/**
 * Unwrap a TypeScript `export namespace` into flat exports + barrel.
 *
 * Usage:
 *   bun script/unwrap-namespace.ts src/bus/index.ts
 *   bun script/unwrap-namespace.ts src/bus/index.ts --dry-run
 *
 * What it does:
 *   1. Reads the file and finds the `export namespace Foo { ... }` block
 *      (uses ast-grep for accurate AST-based boundary detection)
 *   2. Removes the namespace wrapper and dedents the body
 *   3. If the file is index.ts, renames it to <lowercase-name>.ts
 *   4. Creates/updates index.ts with `export * as Foo from "./<file>"`
 *   5. Prints the import rewrite commands to run across the codebase
 *
 * Does NOT auto-rewrite imports — prints the commands so you can review them.
 *
 * Requires: ast-grep (`brew install ast-grep` or `cargo install ast-grep`)
 */

import path from "path"
import fs from "fs"

const args = process.argv.slice(2)
const dryRun = args.includes("--dry-run")
const filePath = args.find((a) => !a.startsWith("--"))

if (!filePath) {
  console.error("Usage: bun script/unwrap-namespace.ts <file> [--dry-run]")
  process.exit(1)
}

const absPath = path.resolve(filePath)
if (!fs.existsSync(absPath)) {
  console.error(`File not found: ${absPath}`)
  process.exit(1)
}

const src = fs.readFileSync(absPath, "utf-8")
const lines = src.split("\n")

// Use ast-grep to find the namespace boundaries accurately.
// This avoids false matches from braces in strings, templates, comments, etc.
const astResult = Bun.spawnSync(
  ["ast-grep", "run", "--pattern", "export namespace $NAME { $$$BODY }", "--lang", "typescript", "--json", absPath],
  { stdout: "pipe", stderr: "pipe" },
)

if (astResult.exitCode !== 0) {
  console.error("ast-grep failed:", astResult.stderr.toString())
  process.exit(1)
}

const matches = JSON.parse(astResult.stdout.toString()) as Array<{
  text: string
  range: { start: { line: number; column: number }; end: { line: number; column: number } }
  metaVariables: { single: Record<string, { text: string }>; multi: Record<string, Array<{ text: string }>> }
}>

if (matches.length === 0) {
  console.error("No `export namespace Foo { ... }` found in file")
  process.exit(1)
}

if (matches.length > 1) {
  console.error(`Found ${matches.length} namespaces — this script handles one at a time`)
  console.error("Namespaces found:")
  for (const m of matches) console.error(`  ${m.metaVariables.single.NAME.text} (line ${m.range.start.line + 1})`)
  process.exit(1)
}

const match = matches[0]
const nsName = match.metaVariables.single.NAME.text
const nsLine = match.range.start.line // 0-indexed
const closeLine = match.range.end.line // 0-indexed, the line with closing `}`

console.log(`Found: export namespace ${nsName} { ... }`)
console.log(`  Lines ${nsLine + 1}–${closeLine + 1} (${closeLine - nsLine + 1} lines)`)

// Build the new file content:
// 1. Everything before the namespace declaration (imports, etc.)
// 2. The namespace body, dedented by one level (2 spaces)
// 3. Everything after the closing brace (rare, but possible)
const before = lines.slice(0, nsLine)
const body = lines.slice(nsLine + 1, closeLine)
const after = lines.slice(closeLine + 1)

// Dedent: remove exactly 2 leading spaces from each line
const dedented = body.map((line) => {
  if (line === "") return ""
  if (line.startsWith("  ")) return line.slice(2)
  return line // don't touch lines that aren't indented (shouldn't happen)
})

const newContent = [...before, ...dedented, ...after].join("\n")

// Figure out file naming
const dir = path.dirname(absPath)
const basename = path.basename(absPath, ".ts")
const isIndex = basename === "index"

// The implementation file name (lowercase namespace name if currently index.ts)
const implName = isIndex ? nsName.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase() : basename
const implFile = path.join(dir, `${implName}.ts`)
const indexFile = path.join(dir, "index.ts")

// The barrel line
const barrelLine = `export * as ${nsName} from "./${implName}"\n`

console.log("")
if (isIndex) {
  console.log(`Plan: rename ${basename}.ts → ${implName}.ts, create new index.ts barrel`)
} else {
  console.log(`Plan: rewrite ${basename}.ts in place, create index.ts barrel`)
}
console.log("")

if (dryRun) {
  console.log("--- DRY RUN ---")
  console.log("")
  console.log(`=== ${implName}.ts (first 30 lines) ===`)
  newContent
    .split("\n")
    .slice(0, 30)
    .forEach((l, i) => console.log(`  ${i + 1}: ${l}`))
  console.log("  ...")
  console.log("")
  console.log(`=== index.ts ===`)
  console.log(`  ${barrelLine.trim()}`)
} else {
  // Write the implementation file
  if (isIndex) {
    // Rename: write new content to implFile, then overwrite index.ts with barrel
    fs.writeFileSync(implFile, newContent)
    fs.writeFileSync(indexFile, barrelLine)
    console.log(`Wrote ${implName}.ts (${newContent.split("\n").length} lines)`)
    console.log(`Wrote index.ts (barrel)`)
  } else {
    // Rewrite in place, create index.ts
    fs.writeFileSync(absPath, newContent)
    if (fs.existsSync(indexFile)) {
      // Append to existing barrel
      const existing = fs.readFileSync(indexFile, "utf-8")
      if (!existing.includes(`export * as ${nsName}`)) {
        fs.appendFileSync(indexFile, barrelLine)
        console.log(`Appended to existing index.ts`)
      } else {
        console.log(`index.ts already has ${nsName} export`)
      }
    } else {
      fs.writeFileSync(indexFile, barrelLine)
      console.log(`Wrote index.ts (barrel)`)
    }
    console.log(`Rewrote ${basename}.ts (${newContent.split("\n").length} lines)`)
  }
}

// Print the import rewrite guidance
const relDir = path.relative(path.resolve("src"), dir)

console.log("")
console.log("=== Import rewrites ===")
console.log("")

if (!isIndex) {
  // Non-index files: imports like "../provider/provider" need to become "../provider"
  const oldTail = `${relDir}/${basename}`

  console.log(`# Find all imports to rewrite:`)
  console.log(`rg 'from.*${oldTail}' src/ --files-with-matches`)
  console.log("")

  // Auto-rewrite with sed (safe: only rewrites the import path, not other occurrences)
  console.log("# Auto-rewrite (review diff afterward):")
  console.log(`rg -l 'from.*${oldTail}' src/ | xargs sed -i '' 's|${oldTail}"|${relDir}"|g'`)
  console.log("")
  console.log("# What changes:")
  console.log(`#   import { ${nsName} } from ".../${oldTail}"`)
  console.log(`#   import { ${nsName} } from ".../${relDir}"`)
} else {
  console.log("# File was index.ts — import paths already resolve correctly.")
  console.log("# No import rewrites needed!")
}

console.log("")
console.log("=== Verify ===")
console.log("")
console.log("bun typecheck     # from packages/opencode")
console.log("bun run test      # run tests")
