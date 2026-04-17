#!/usr/bin/env bun
/**
 * Collapse a single-namespace barrel directory into a dir/index.ts module.
 *
 * Given a directory `src/foo/` that contains:
 *
 *   - `index.ts`  (exactly `export * as Foo from "./foo"`)
 *   - `foo.ts`    (the real implementation)
 *   - zero or more sibling files
 *
 * this script:
 *
 *   1. Deletes the old `index.ts` barrel.
 *   2. `git mv`s `foo.ts` → `index.ts` so the implementation IS the directory entry.
 *   3. Appends `export * as Foo from "."` to the new `index.ts`.
 *   4. Rewrites any same-directory sibling `*.ts` files that imported
 *      `./foo` (with or without the namespace name) to import `"."` instead.
 *
 * Consumer files outside the directory keep importing from the directory
 * (`"@/foo"` / `"../foo"` / etc.) and continue to work, because
 * `dir/index.ts` now provides the `Foo` named export directly.
 *
 * Usage:
 *
 *   bun script/collapse-barrel.ts src/bus
 *   bun script/collapse-barrel.ts src/bus --dry-run
 *
 * Notes:
 *
 *   - Only works on directories whose barrel is a single
 *     `export * as Name from "./file"` line. Refuses otherwise.
 *   - Refuses if the implementation file name already conflicts with
 *     `index.ts`.
 *   - Safe to run repeatedly: a second run on an already-collapsed dir
 *     will exit with a clear message.
 */

import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"

const args = process.argv.slice(2)
const dryRun = args.includes("--dry-run")
const targetArg = args.find((a) => !a.startsWith("--"))

if (!targetArg) {
  console.error("Usage: bun script/collapse-barrel.ts <dir> [--dry-run]")
  process.exit(1)
}

const dir = path.resolve(targetArg)
const indexPath = path.join(dir, "index.ts")

if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
  console.error(`Not a directory: ${dir}`)
  process.exit(1)
}
if (!fs.existsSync(indexPath)) {
  console.error(`No index.ts in ${dir}`)
  process.exit(1)
}

// Validate barrel shape.
const indexContent = fs.readFileSync(indexPath, "utf-8").trim()
const match = indexContent.match(/^export\s+\*\s+as\s+(\w+)\s+from\s+["']\.\/([^"']+)["']\s*;?\s*$/)
if (!match) {
  console.error(`Not a simple single-namespace barrel:\n${indexContent}`)
  process.exit(1)
}
const namespaceName = match[1]
const implRel = match[2].replace(/\.ts$/, "")
const implPath = path.join(dir, `${implRel}.ts`)

if (!fs.existsSync(implPath)) {
  console.error(`Implementation file not found: ${implPath}`)
  process.exit(1)
}

if (implRel === "index") {
  console.error(`Nothing to do — impl file is already index.ts`)
  process.exit(0)
}

console.log(`Collapsing ${path.relative(process.cwd(), dir)}`)
console.log(`  namespace: ${namespaceName}`)
console.log(`  impl file: ${implRel}.ts → index.ts`)

// Figure out which sibling files need rewriting.
const siblings = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"))
  .filter((f) => f !== "index.ts" && f !== `${implRel}.ts`)
  .map((f) => path.join(dir, f))

type SiblingEdit = { file: string; content: string }
const siblingEdits: SiblingEdit[] = []

for (const sibling of siblings) {
  const content = fs.readFileSync(sibling, "utf-8")
  // Match any import or re-export referring to "./<implRel>" inside this directory.
  const siblingRegex = new RegExp(`(from\\s*["'])\\.\\/${implRel.replace(/[-\\^$*+?.()|[\]{}]/g, "\\$&")}(["'])`, "g")
  if (!siblingRegex.test(content)) continue
  const updated = content.replace(siblingRegex, `$1.$2`)
  siblingEdits.push({ file: sibling, content: updated })
}

if (siblingEdits.length > 0) {
  console.log(`  sibling rewrites: ${siblingEdits.length}`)
  for (const edit of siblingEdits) {
    console.log(`    ${path.relative(process.cwd(), edit.file)}`)
  }
} else {
  console.log(`  sibling rewrites: none`)
}

if (dryRun) {
  console.log(`\n(dry run) would:`)
  console.log(`  - delete ${path.relative(process.cwd(), indexPath)}`)
  console.log(`  - git mv ${path.relative(process.cwd(), implPath)} ${path.relative(process.cwd(), indexPath)}`)
  console.log(`  - append \`export * as ${namespaceName} from "."\` to the new index.ts`)
  for (const edit of siblingEdits) {
    console.log(`  - rewrite sibling: ${path.relative(process.cwd(), edit.file)}`)
  }
  process.exit(0)
}

// Apply: remove the old barrel, git-mv the impl onto it, then rewrite content.
// We can't git-mv on top of an existing tracked file, so we remove the barrel first.
function runGit(...cmd: string[]) {
  const res = spawnSync("git", cmd, { stdio: "inherit" })
  if (res.status !== 0) {
    console.error(`git ${cmd.join(" ")} failed`)
    process.exit(res.status ?? 1)
  }
}

// Step 1: remove the barrel
runGit("rm", "-f", indexPath)

// Step 2: rename the impl file into index.ts
runGit("mv", implPath, indexPath)

// Step 3: append the self-reexport to the new index.ts
const newContent = fs.readFileSync(indexPath, "utf-8")
const trimmed = newContent.endsWith("\n") ? newContent : newContent + "\n"
fs.writeFileSync(indexPath, `${trimmed}\nexport * as ${namespaceName} from "."\n`)
console.log(`  appended: export * as ${namespaceName} from "."`)

// Step 4: rewrite siblings
for (const edit of siblingEdits) {
  fs.writeFileSync(edit.file, edit.content)
}
if (siblingEdits.length > 0) {
  console.log(`  rewrote ${siblingEdits.length} sibling file(s)`)
}

console.log(`\nDone. Verify with:`)
console.log(`  cd packages/opencode`)
console.log(`  bunx --bun tsgo --noEmit`)
console.log(`  bun run --conditions=browser ./src/index.ts generate`)
console.log(`  bun run test`)
