#!/usr/bin/env bun

import { $ } from "bun"
import path from "path"

const root = path.resolve(import.meta.dirname, "../../..")
const sqlDir = path.join(root, "packages/core/migration")
const tsDir = path.join(root, "packages/core/src/database/migration")
const registry = path.join(root, "packages/core/src/database/migration.gen.ts")

await $`bun drizzle-kit generate`.cwd(path.join(root, "packages/core"))

const sqlMigrations = (await Array.fromAsync(new Bun.Glob("*/migration.sql").scan({ cwd: sqlDir })))
  .map((file) => file.split("/")[0])
  .filter((name) => name !== undefined)
  .sort()

for (const name of sqlMigrations) {
  if (await Bun.file(path.join(tsDir, `${name}.ts`)).exists()) continue
  await Bun.write(path.join(tsDir, `${name}.ts`), renderMigration(name, await Bun.file(path.join(sqlDir, name, "migration.sql")).text()))
}

await Bun.write(registry, renderRegistry(sqlMigrations))

function renderMigration(name: string, sql: string) {
  return `import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: ${JSON.stringify(name)},
  up(tx) {
    return Effect.gen(function* () {
${sql
  .split("--> statement-breakpoint")
  .map((statement) => statement.trim())
  .filter((statement) => statement.length > 0)
  .map(renderRun)
  .join("\n")}
    })
  },
} satisfies DatabaseMigration.Migration
`
}

function renderRun(statement: string) {
  const lines = statement.replaceAll("\t", "  ").split("\n")
  if (lines.length === 1) return `      yield* tx.run(\`${escapeTemplate(lines[0])}\`)`
  return `      yield* tx.run(\`\n${lines.map((line) => `        ${escapeTemplate(line)}`).join("\n")}\n      \`)`
}

function escapeTemplate(line: string) {
  return line.replaceAll("\\", "\\\\").replaceAll("`", "\\`").replaceAll("${", "\\${")
}

function renderRegistry(names: string[]) {
  return `import type { DatabaseMigration } from "./migration"

export const migrations = (await Promise.all([
${names.map((name) => `  import("./migration/${name}"),`).join("\n")}
])).map((module) => module.default) satisfies DatabaseMigration.Migration[]
`
}
