#!/usr/bin/env bun

import { $ } from "bun"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { pathToFileURL } from "url"
import { parseArgs } from "util"

const root = path.resolve(import.meta.dirname, "../../..")
const sqlDir = path.join(root, "packages/core/migration")
const tsDir = path.join(root, "packages/core/src/database/migration")
const registry = path.join(root, "packages/core/src/database/migration.gen.ts")
const args = parseArgs({
  args: process.argv.slice(2),
  options: {
    check: { type: "boolean" },
    name: { type: "string" },
  },
})

if (args.values.check) {
  await check()
  process.exit(0)
}

await $`bun drizzle-kit generate ${args.values.name ? ["--name", args.values.name] : []}`.cwd(
  path.join(root, "packages/core"),
)

const sqlMigrations = (await Array.fromAsync(new Bun.Glob("*/migration.sql").scan({ cwd: sqlDir })))
  .map((file) => file.split("/")[0])
  .filter((name) => name !== undefined)
  .sort()

for (const name of sqlMigrations) {
  if (await Bun.file(path.join(tsDir, `${name}.ts`)).exists()) continue
  await Bun.write(
    path.join(tsDir, `${name}.ts`),
    renderMigration(name, await Bun.file(path.join(sqlDir, name, "migration.sql")).text()),
  )
}

await Bun.write(registry, renderRegistry(sqlMigrations))

async function check() {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-core-migration-check-"))
  const output = path.join(temporary, "migration")
  try {
    await fs.cp(sqlDir, output, { recursive: true })
    const config = path.join(temporary, "drizzle.config.ts")
    await Bun.write(
      config,
      `import config from ${JSON.stringify(pathToFileURL(path.join(root, "packages/core/drizzle.config.ts")).href)}

export default { ...config, out: ${JSON.stringify(output)} }
`,
    )
    const before = await snapshot(output)
    await $`bun drizzle-kit generate --config ${config}`.cwd(path.join(root, "packages/core"))
    const after = await snapshot(output)
    if (JSON.stringify(after) !== JSON.stringify(before)) {
      throw new Error(
        "Core schema has ungenerated database migrations. Run `bun script/migration.ts` from packages/core.",
      )
    }

    const migrations = before
      .map((entry) => entry.path.split("/")[0])
      .filter((name, index, all) => name !== undefined && all.indexOf(name) === index)
      .sort()
    for (const name of migrations) {
      if (await Bun.file(path.join(tsDir, `${name}.ts`)).exists()) continue
      throw new Error(
        `Database migration TypeScript wrapper is missing for ${name}. Run \`bun script/migration.ts\` from packages/core.`,
      )
    }
    if ((await Bun.file(registry).text()) !== renderRegistry(migrations)) {
      throw new Error("Database migration registry is stale. Run `bun script/migration.ts` from packages/core.")
    }
  } finally {
    await fs.rm(temporary, { recursive: true, force: true })
  }
}

async function snapshot(directory: string) {
  const files = await Array.fromAsync(new Bun.Glob("**/*").scan({ cwd: directory, onlyFiles: true }))
  return Promise.all(
    files.sort().map(async (file) => ({ path: file, contents: await Bun.file(path.join(directory, file)).text() })),
  )
}

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

export const migrations = (
  await Promise.all([
${names.map((name) => `    import("./migration/${name}"),`).join("\n")}
  ])
).map((module) => module.default) satisfies DatabaseMigration.Migration[]
`
}
