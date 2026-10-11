#!/usr/bin/env bun
// Fails when a GUI package file this branch adds or edits has any oxlint problem, including warn-level rules (anti-slop):
// a change that touches a file leaves the whole file clean. Untouched files and other packages are not checked.
// Usage: bun script/lint-changed.ts [base-ref]   (default: merge base with upstream/dev, origin/dev, or dev)
import { $ } from "bun"

type Diagnostic = {
  message: string
  code: string
  filename: string
  labels: { span: { line: number; column: number } }[]
}

const base = await resolveBase(process.argv[2] ?? process.env.LINT_BASE)
const tracked = (await $`git diff --name-only --diff-filter=ACMR ${base}`.text()).split("\n")
const untracked = (await $`git ls-files --others --exclude-standard`.text()).split("\n")
// The packages .oxlintrc.json applies the anti-slop rules to.
const packages = ["packages/app/", "packages/desktop/", "packages/gui-extensions/", "packages/ui/", "packages/session-ui/"]
const files = [...new Set([...tracked, ...untracked])].filter(
  (file) =>
    /\.(ts|tsx)$/.test(file) && packages.some((prefix) => file.startsWith(prefix)) && Bun.file(file).size > 0,
)

if (files.length === 0) {
  console.log(`lint:changed: no changed TypeScript files since ${base.slice(0, 10)}`)
  process.exit(0)
}

const report = JSON.parse(await $`bunx oxlint --format json ${files}`.nothrow().quiet().text()) as {
  diagnostics: Diagnostic[]
}

report.diagnostics.forEach((diagnostic) => {
  const span = diagnostic.labels[0]?.span
  console.log(`${diagnostic.filename}:${span?.line}:${span?.column}  ${diagnostic.code}  ${diagnostic.message}`)
})
const dirty = new Set(report.diagnostics.map((diagnostic) => diagnostic.filename))
console.log(
  `lint:changed: ${report.diagnostics.length} problem(s) in ${dirty.size} of ${files.length} changed files since ${base.slice(0, 10)}`,
)
process.exit(report.diagnostics.length > 0 ? 1 : 0)

async function resolveBase(explicit: string | undefined) {
  if (explicit) return (await $`git rev-parse ${explicit}`.text()).trim()
  const refs = ["upstream/dev", "origin/dev", "dev"]
  const found = await Promise.all(
    refs.map(async (ref) => (await $`git rev-parse --verify --quiet ${ref}`.nothrow().quiet()).exitCode === 0),
  )
  const ref = refs.find((_, index) => found[index])
  if (!ref) throw new Error("lint:changed: no v2 ref found; pass a base ref")
  return (await $`git merge-base HEAD ${ref}`.text()).trim()
}
