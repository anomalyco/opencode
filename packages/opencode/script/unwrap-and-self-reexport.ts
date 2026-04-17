#!/usr/bin/env bun
/**
 * Unwrap a single `export namespace` in a file into flat top-level exports
 * plus a self-reexport at the bottom of the same file.
 *
 * Usage:
 *
 *   bun script/unwrap-and-self-reexport.ts src/file/ignore.ts
 *   bun script/unwrap-and-self-reexport.ts src/file/ignore.ts --dry-run
 *
 * Input file shape:
 *
 *   // imports ...
 *
 *   export namespace FileIgnore {
 *     export function ...(...) { ... }
 *     const helper = ...
 *   }
 *
 * Output shape:
 *
 *   // imports ...
 *
 *   export function ...(...) { ... }
 *   const helper = ...
 *
 *   export * as FileIgnore from "./ignore"
 *
 * What the script does:
 *
 *   1. Uses ast-grep to locate the single `export namespace Foo { ... }` block.
 *   2. Removes the `export namespace Foo {` line and the matching closing `}`.
 *   3. Dedents the body by one indent level (2 spaces).
 *   4. Rewrites `Foo.Bar` self-references inside the file to just `Bar`
 *      (but only for names that are actually exported from the namespace —
 *      non-exported members get the same treatment so references remain valid).
 *   5. Appends `export * as Foo from "./<basename>"` at the end of the file.
 *
 * What it does NOT do:
 *
 *   - Does not create or modify barrel `index.ts` files.
 *   - Does not rewrite any consumer imports. Consumers already import from
 *     the file path itself (e.g. `import { FileIgnore } from "../file/ignore"`);
 *     the self-reexport keeps that import working unchanged.
 *   - Does not handle files with more than one `export namespace` declaration.
 *     The script refuses that case.
 *
 * Requires: ast-grep (`brew install ast-grep`).
 */

import fs from "node:fs"
import path from "node:path"

const args = process.argv.slice(2)
const dryRun = args.includes("--dry-run")
const targetArg = args.find((a) => !a.startsWith("--"))

if (!targetArg) {
  console.error("Usage: bun script/unwrap-and-self-reexport.ts <file> [--dry-run]")
  process.exit(1)
}

const absPath = path.resolve(targetArg)
if (!fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) {
  console.error(`Not a file: ${absPath}`)
  process.exit(1)
}

// Locate the namespace block with ast-grep (accurate AST boundaries).
const ast = Bun.spawnSync(
  ["ast-grep", "run", "--pattern", "export namespace $NAME { $$$BODY }", "--lang", "typescript", "--json", absPath],
  { stdout: "pipe", stderr: "pipe" },
)
if (ast.exitCode !== 0) {
  console.error("ast-grep failed:", ast.stderr.toString())
  process.exit(1)
}

type AstMatch = {
  range: { start: { line: number; column: number }; end: { line: number; column: number } }
  metaVariables: { single: Record<string, { text: string }> }
}
const matches = JSON.parse(ast.stdout.toString()) as AstMatch[]
if (matches.length === 0) {
  console.error(`No \`export namespace\` found in ${path.relative(process.cwd(), absPath)}`)
  process.exit(1)
}
if (matches.length > 1) {
  console.error(`File has ${matches.length} \`export namespace\` declarations — this script handles one per file.`)
  for (const m of matches) console.error(`  ${m.metaVariables.single.NAME.text} (line ${m.range.start.line + 1})`)
  process.exit(1)
}

const match = matches[0]
const nsName = match.metaVariables.single.NAME.text
const startLine = match.range.start.line
const endLine = match.range.end.line

const original = fs.readFileSync(absPath, "utf-8")
const lines = original.split("\n")

// Split the file into before/body/after.
const before = lines.slice(0, startLine)
const body = lines.slice(startLine + 1, endLine)
const after = lines.slice(endLine + 1)

// Dedent body by one indent level (2 spaces).
const dedented = body.map((line) => {
  if (line === "") return ""
  if (line.startsWith("  ")) return line.slice(2)
  return line
})

// Collect all top-level declared identifiers inside the namespace body so we can
// rewrite `Foo.X` → `X` when X is one of them. We gather BOTH exported and
// non-exported names because the namespace body might reference its own
// non-exported helpers via `Foo.helper` too.
const declaredNames = new Set<string>()
const declRe =
  /^\s*(?:export\s+)?(?:abstract\s+)?(?:async\s+)?(?:const|let|var|function|class|interface|type|enum)\s+(\w+)/
for (const line of dedented) {
  const m = line.match(declRe)
  if (m) declaredNames.add(m[1])
}
// Also capture `export { X, Y }` re-exports inside the namespace.
const reExportRe = /export\s*\{\s*([^}]+)\}/g
for (const line of dedented) {
  for (const reExport of line.matchAll(reExportRe)) {
    for (const part of reExport[1].split(",")) {
      const name = part
        .trim()
        .split(/\s+as\s+/)
        .pop()!
        .trim()
      if (name) declaredNames.add(name)
    }
  }
}

// Rewrite `Foo.X` → `X` inside the body, avoiding matches in strings, comments,
// templates. We walk the line char-by-char rather than using a regex so we can
// skip over those segments cleanly.
let rewriteCount = 0
function rewriteLine(line: string): string {
  const out: string[] = []
  let i = 0
  let stringQuote: string | null = null
  while (i < line.length) {
    const ch = line[i]
    // String / template literal pass-through.
    if (stringQuote) {
      out.push(ch)
      if (ch === "\\" && i + 1 < line.length) {
        out.push(line[i + 1])
        i += 2
        continue
      }
      if (ch === stringQuote) stringQuote = null
      i++
      continue
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      stringQuote = ch
      out.push(ch)
      i++
      continue
    }
    // Line comment: emit the rest of the line untouched.
    if (ch === "/" && line[i + 1] === "/") {
      out.push(line.slice(i))
      i = line.length
      continue
    }
    // Block comment: emit until "*/" if present on same line; else rest of line.
    if (ch === "/" && line[i + 1] === "*") {
      const end = line.indexOf("*/", i + 2)
      if (end === -1) {
        out.push(line.slice(i))
        i = line.length
      } else {
        out.push(line.slice(i, end + 2))
        i = end + 2
      }
      continue
    }
    // Try to match `Foo.<identifier>` at this position.
    if (line.startsWith(nsName + ".", i)) {
      // Make sure the char before is NOT a word character (otherwise we'd be in the middle of another identifier).
      const prev = i === 0 ? "" : line[i - 1]
      if (!/\w/.test(prev)) {
        const after = line.slice(i + nsName.length + 1)
        const nameMatch = after.match(/^([A-Za-z_$][\w$]*)/)
        if (nameMatch && declaredNames.has(nameMatch[1])) {
          out.push(nameMatch[1])
          i += nsName.length + 1 + nameMatch[1].length
          rewriteCount++
          continue
        }
      }
    }
    out.push(ch)
    i++
  }
  return out.join("")
}
const rewrittenBody = dedented.map(rewriteLine)

// Assemble the new file. Collapse multiple trailing blank lines so the
// self-reexport sits cleanly at the end.
const basename = path.basename(absPath, ".ts")
const assembled = [...before, ...rewrittenBody, ...after].join("\n")
const trimmed = assembled.replace(/\s+$/g, "")
const output = `${trimmed}\n\nexport * as ${nsName} from "./${basename}"\n`

if (dryRun) {
  console.log(`--- dry run: ${path.relative(process.cwd(), absPath)} ---`)
  console.log(`namespace:      ${nsName}`)
  console.log(`body lines:     ${body.length}`)
  console.log(`declared names: ${Array.from(declaredNames).join(", ") || "(none)"}`)
  console.log(`self-refs rewr: ${rewriteCount}`)
  console.log(`self-reexport:  export * as ${nsName} from "./${basename}"`)
  console.log(`output preview (last 10 lines):`)
  const outputLines = output.split("\n")
  for (const l of outputLines.slice(Math.max(0, outputLines.length - 10))) {
    console.log(`  ${l}`)
  }
  process.exit(0)
}

fs.writeFileSync(absPath, output)
console.log(`unwrapped ${path.relative(process.cwd(), absPath)} → ${nsName}`)
console.log(`  body lines:      ${body.length}`)
console.log(`  self-refs rewr:  ${rewriteCount}`)
console.log(`  self-reexport:   export * as ${nsName} from "./${basename}"`)
console.log("")
console.log("Next: verify with")
console.log("  bunx --bun tsgo --noEmit")
console.log("  bun run --conditions=browser ./src/index.ts generate")
console.log(
  `  bun run test test/${path.relative(path.join(path.dirname(absPath), "..", ".."), absPath).replace(/\.ts$/, "")}*`,
)
