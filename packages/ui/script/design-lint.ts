#!/usr/bin/env bun

import path from "node:path"
import { lint, type Finding } from "../src/design-lint/design-lint"

const root = path.resolve(import.meta.dir, "../../..")

const baselinePath = path.join(import.meta.dir, "design-lint.baseline.json")

const scanned = [
  "packages/ui/src",
  "packages/app/src",
  "packages/desktop/src",
  "packages/session-ui/src",
  "packages/enterprise/src",
  "packages/gui-extensions/src",
]

const skipped =
  /(^|\/)(node_modules|dist|generated)\/|^packages\/ui\/src\/design-lint\/|\.(test|spec|stories|fixture)\.tsx?$|\.d\.ts$|\.gen\.ts$/

const args = process.argv.slice(2)

const json = args.includes("--json")

const update = args.includes("--update-baseline")

const files = args.filter((arg) => !arg.startsWith("--"))

if (files.length > 0) {
  const findings = (await Promise.all((await Promise.all(files.map(resolveFile))).map(lintFile))).flat()

  if (json) console.log(JSON.stringify(findings, null, 2))

  if (!json) findings.forEach(print)
  process.exit(findings.length > 0 ? 1 : 0)
}

const paths = (
  await Promise.all(
    scanned.map((dir) =>
      Array.fromAsync(new Bun.Glob("**/*.{css,ts,tsx}").scan({ cwd: path.join(root, dir), onlyFiles: true })).then(
        (entries) => entries.map((entry) => path.posix.join(dir, entry.replaceAll("\\", "/"))),
        () => [],
      ),
    ),
  )
)
  .flat()
  .filter((file) => !skipped.test(file))
  .toSorted()
  .map((file) => path.join(root, file))

const results = (await Promise.all(paths.map(lintFile))).flat()

const counts = countFindings(results)

if (update) {
  await Bun.write(baselinePath, JSON.stringify(counts, null, 2) + "\n")
  console.log(`Updated ${path.relative(root, baselinePath)} with ${results.length} findings`)
  process.exit(0)
}

const baseline: Record<string, Record<string, number>> = await Bun.file(baselinePath)
  .json()
  .catch(() => ({}))

const regressions = Object.entries(counts).flatMap(([file, rules]) =>
  Object.entries(rules)
    .filter(([rule, count]) => count > (baseline[file]?.[rule] ?? 0))
    .map(([rule, count]) => ({ file, rule, count, allowed: baseline[file]?.[rule] ?? 0 })),
)

const improved = Object.entries(baseline).some(([file, rules]) =>
  Object.entries(rules).some(([rule, count]) => (counts[file]?.[rule] ?? 0) < count),
)

if (json)
  console.log(
    JSON.stringify(
      regressions.flatMap((item) => matching(item.file, item.rule)),
      null,
      2,
    ),
  )

if (!json) {
  regressions.forEach((item) => {
    console.log(`${item.file}: ${item.rule} has ${item.count} findings, baseline allows ${item.allowed}`)
    matching(item.file, item.rule).forEach(print)
  })

  if (regressions.length > 0) {
    console.log(
      "\nFix the new findings, or add `design-lint-allow <rule-id>: <reason>` on the line or the line above. See the skill named in each rule.",
    )
  }

  if (improved) {
    console.log(
      "Design lint counts dropped below the baseline. Run `bun run --cwd packages/ui lint:design --update-baseline`.",
    )
  }

  if (regressions.length === 0) console.log(`Design lint passed (${results.length} baselined findings).`)
}

process.exit(regressions.length > 0 ? 1 : 0)

async function resolveFile(file: string) {
  const direct = path.resolve(file)

  if (await Bun.file(direct).exists()) return direct

  return path.resolve(root, file)
}

async function lintFile(file: string) {
  const text = await Bun.file(file).text()

  return lint({ path: path.relative(root, file).replaceAll("\\", "/"), text })
}

function countFindings(items: Finding[]) {
  const counts: Record<string, Record<string, number>> = {}
  items.forEach((finding) => {
    const file = (counts[finding.path] ??= {})
    file[finding.rule] = (file[finding.rule] ?? 0) + 1
  })

  return Object.fromEntries(
    Object.entries(counts)
      .toSorted(byKey)
      .map(([file, ruleCounts]) => [file, Object.fromEntries(Object.entries(ruleCounts).toSorted(byKey))]),
  )
}

function byKey(a: [string, unknown], b: [string, unknown]) {
  return a[0] < b[0] ? -1 : 1
}

function matching(file: string, rule: string) {
  return results.filter((finding) => finding.path === file && finding.rule === rule)
}

function print(finding: Finding) {
  console.log(`  ${finding.path}:${finding.line}:${finding.column} ${finding.rule} ${finding.message}`)
}
