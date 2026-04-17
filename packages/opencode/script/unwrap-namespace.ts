#!/usr/bin/env bun
/**
 * Unwrap a TypeScript `export namespace` into flat exports + barrel.
 *
 * Usage:
 *   bun script/unwrap-namespace.ts src/bus/index.ts
 *   bun script/unwrap-namespace.ts src/bus/index.ts --dry-run
 *   bun script/unwrap-namespace.ts src/pty/index.ts --name service   # avoid collision with pty.ts
 *
 * What it does:
 *   1. Reads the file and finds the `export namespace Foo { ... }` block
 *      (uses ast-grep for accurate AST-based boundary detection)
 *   2. Removes the namespace wrapper and dedents the body
 *   3. Fixes self-references (e.g. Config.PermissionAction → PermissionAction)
 *   4. If the file is index.ts, renames it to <lowercase-name>.ts
 *   5. Creates/updates index.ts with `export * as Foo from "./<file>"`
 *   6. Rewrites import paths across src/, test/, and script/
 *   7. Fixes sibling imports within the same directory
 *
 * Requires: ast-grep (`brew install ast-grep` or `cargo install ast-grep`)
 */

import path from "path"
import fs from "fs"

const args = process.argv.slice(2)
const dryRun = args.includes("--dry-run")
const nameFlag = args.find((a, i) => args[i - 1] === "--name")
const filePath = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--name")

if (!filePath) {
  console.error("Usage: bun script/unwrap-namespace.ts <file> [--dry-run] [--name <impl-name>]")
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
  return line
})

let newContent = [...before, ...dedented, ...after].join("\n")

// --- Fix self-references ---
// After unwrapping, references like `Config.PermissionAction` inside the same file
// need to become just `PermissionAction`. Only fix code positions, not strings.
const exportedNames = new Set<string>()
const exportRegex = /export\s+(?:const|function|class|interface|type|enum|abstract\s+class)\s+(\w+)/g
for (const line of dedented) {
  for (const m of line.matchAll(exportRegex)) exportedNames.add(m[1])
}
const reExportRegex = /export\s*\{\s*([^}]+)\}/g
for (const line of dedented) {
  for (const m of line.matchAll(reExportRegex)) {
    for (const name of m[1].split(",")) {
      const trimmed = name
        .trim()
        .split(/\s+as\s+/)
        .pop()!
        .trim()
      if (trimmed) exportedNames.add(trimmed)
    }
  }
}

let selfRefCount = 0
if (exportedNames.size > 0) {
  const fixedLines = newContent.split("\n").map((line) => {
    // Split line into string-literal and code segments to avoid replacing inside strings
    const segments: Array<{ text: string; isString: boolean }> = []
    let i = 0
    let current = ""
    let inString: string | null = null

    while (i < line.length) {
      const ch = line[i]
      if (inString) {
        current += ch
        if (ch === "\\" && i + 1 < line.length) {
          current += line[i + 1]
          i += 2
          continue
        }
        if (ch === inString) {
          segments.push({ text: current, isString: true })
          current = ""
          inString = null
        }
        i++
        continue
      }
      if (ch === '"' || ch === "'" || ch === "`") {
        if (current) segments.push({ text: current, isString: false })
        current = ch
        inString = ch
        i++
        continue
      }
      if (ch === "/" && i + 1 < line.length && line[i + 1] === "/") {
        current += line.slice(i)
        segments.push({ text: current, isString: true })
        current = ""
        i = line.length
        continue
      }
      current += ch
      i++
    }
    if (current) segments.push({ text: current, isString: !!inString })

    return segments
      .map((seg) => {
        if (seg.isString) return seg.text
        let result = seg.text
        for (const name of exportedNames) {
          const pattern = `${nsName}.${name}`
          while (result.includes(pattern)) {
            const idx = result.indexOf(pattern)
            const charBefore = idx > 0 ? result[idx - 1] : " "
            const charAfter = idx + pattern.length < result.length ? result[idx + pattern.length] : " "
            if (/\w/.test(charBefore) || /\w/.test(charAfter)) break
            result = result.slice(0, idx) + name + result.slice(idx + pattern.length)
            selfRefCount++
          }
        }
        return result
      })
      .join("")
  })
  newContent = fixedLines.join("\n")
}

// Figure out file naming
const dir = path.dirname(absPath)
const basename = path.basename(absPath, ".ts")
const isIndex = basename === "index"
const implName = nameFlag ?? (isIndex ? nsName.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase() : basename)
const implFile = path.join(dir, `${implName}.ts`)
const indexFile = path.join(dir, "index.ts")
const barrelLine = `export * as ${nsName} from "./${implName}"\n`

console.log("")
if (isIndex) {
  console.log(`Plan: rename ${basename}.ts → ${implName}.ts, create new index.ts barrel`)
} else {
  console.log(`Plan: rewrite ${basename}.ts in place, create index.ts barrel`)
}
if (selfRefCount > 0) console.log(`Fixed ${selfRefCount} self-reference(s) (${nsName}.X → X)`)
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
  console.log("")
  if (!isIndex) {
    const relDir = path.relative(path.resolve("src"), dir)
    console.log(`=== Import rewrites (would apply) ===`)
    console.log(`  ${relDir}/${basename}" → ${relDir}" across src/, test/, script/`)
  } else {
    console.log("No import rewrites needed (was index.ts)")
  }
} else {
  if (isIndex) {
    fs.writeFileSync(implFile, newContent)
    fs.writeFileSync(indexFile, barrelLine)
    console.log(`Wrote ${implName}.ts (${newContent.split("\n").length} lines)`)
    console.log(`Wrote index.ts (barrel)`)
  } else {
    fs.writeFileSync(absPath, newContent)
    if (fs.existsSync(indexFile)) {
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

  // --- Rewrite import paths across src/, test/, script/ ---
  const relDir = path.relative(path.resolve("src"), dir)
  if (!isIndex) {
    const oldTail = `${relDir}/${basename}`
    const searchDirs = ["src", "test", "script"].filter((d) => fs.existsSync(d))
    const rgResult = Bun.spawnSync(["rg", "-l", `from.*${oldTail}"`, ...searchDirs], {
      stdout: "pipe",
      stderr: "pipe",
    })
    const filesToRewrite = rgResult.stdout
      .toString()
      .trim()
      .split("\n")
      .filter((f) => f.length > 0)

    if (filesToRewrite.length > 0) {
      console.log(`\nRewriting imports in ${filesToRewrite.length} file(s)...`)
      for (const file of filesToRewrite) {
        const content = fs.readFileSync(file, "utf-8")
        fs.writeFileSync(file, content.replaceAll(`${oldTail}"`, `${relDir}"`))
      }
      console.log(`  Done: ${oldTail}" → ${relDir}"`)
    } else {
      console.log("\nNo import rewrites needed")
    }
  } else {
    console.log("\nNo import rewrites needed (was index.ts)")
  }

  // --- Fix sibling imports within the same directory ---
  const siblingFiles = fs.readdirSync(dir).filter((f) => {
    if (!f.endsWith(".ts")) return false
    if (f === "index.ts" || f === `${implName}.ts`) return false
    return true
  })

  let siblingFixCount = 0
  for (const sibFile of siblingFiles) {
    const sibPath = path.join(dir, sibFile)
    const content = fs.readFileSync(sibPath, "utf-8")
    const pattern = new RegExp(`from\\s+["']\\./${basename}["']`, "g")
    if (pattern.test(content)) {
      fs.writeFileSync(sibPath, content.replace(pattern, `from "."`))
      siblingFixCount++
    }
  }
  if (siblingFixCount > 0) {
    console.log(`Fixed ${siblingFixCount} sibling import(s) in ${path.basename(dir)}/ (./${basename} → .)`)
  }
}

console.log("")
console.log("=== Verify ===")
console.log("")
console.log("bunx --bun tsgo --noEmit   # typecheck")
console.log("bun run test               # run tests")
