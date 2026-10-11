#!/usr/bin/env bun

import fs from "fs/promises"
import os from "os"
import path from "path"
import { pathToFileURL } from "url"
import { parseArgs } from "util"
import { getTableColumns, getTableName, is } from "drizzle-orm"
import { SQLiteTable } from "drizzle-orm/sqlite-core"

const root = path.resolve(import.meta.dirname, "../../..")
const snapshot = path.join(root, "packages/core/schema.json")
const tsDir = path.join(root, "packages/core/src/database/migration")
const registry = path.join(root, "packages/core/src/database/migration.gen.ts")
const schema = path.join(root, "packages/core/src/database/schema.gen.ts")
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

await generate()

async function generate() {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-core-migration-"))
  const incremental = path.join(temporary, "incremental")
  const full = path.join(temporary, "full")
  try {
    await fs.mkdir(incremental)
    await fs.mkdir(path.join(incremental, "baseline"))
    await fs.copyFile(snapshot, path.join(incremental, "baseline/snapshot.json"))
    await drizzle(temporary, incremental, args.values.name)

    const generated = await generatedMigrations(incremental)
    if (generated.length > 1) throw new Error(`Expected one generated migration, found ${generated.length}.`)
    const name = generated[0]
    if (name) {
      const target = path.join(tsDir, `${name}.ts`)
      if (await Bun.file(target).exists()) throw new Error(`Database migration already exists: ${name}`)
      await Bun.write(
        target,
        await formatTypescript(
          renderMigration(name, await Bun.file(path.join(incremental, name, "migration.sql")).text()),
        ),
      )
      await Bun.write(snapshot, await formatJson(await Bun.file(path.join(incremental, name, "snapshot.json")).text()))
    }

    await fs.mkdir(full)
    await drizzle(temporary, full, "schema")
    await Bun.write(schema, await formatTypescript(await renderSchema(await generatedSql(full))))
    await Bun.write(registry, await formatTypescript(renderRegistry(await typescriptMigrations())))
  } finally {
    await fs.rm(temporary, { recursive: true, force: true })
  }
}

async function check() {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-core-migration-check-"))
  const incremental = path.join(temporary, "incremental")
  const full = path.join(temporary, "full")
  try {
    await fs.mkdir(incremental)
    await fs.mkdir(path.join(incremental, "baseline"))
    await fs.copyFile(snapshot, path.join(incremental, "baseline/snapshot.json"))
    await drizzle(temporary, incremental)
    if ((await generatedMigrations(incremental)).length > 0) {
      throw new Error(
        "Core schema has ungenerated database migrations. Run `bun script/migration.ts` from packages/core.",
      )
    }

    await fs.mkdir(full)
    await drizzle(temporary, full, "schema")
    if ((await Bun.file(schema).text()) !== (await formatTypescript(await renderSchema(await generatedSql(full))))) {
      throw new Error("Current database schema is stale. Run `bun script/migration.ts` from packages/core.")
    }

    const migrations = await typescriptMigrations()
    if ((await Bun.file(registry).text()) !== (await formatTypescript(renderRegistry(migrations)))) {
      throw new Error("Database migration registry is stale. Run `bun script/migration.ts` from packages/core.")
    }
  } finally {
    await fs.rm(temporary, { recursive: true, force: true })
  }
}

async function drizzle(temporary: string, output: string, name?: string) {
  const config = path.join(temporary, `${path.basename(output)}.config.ts`)
  await Bun.write(
    config,
    `import config from ${JSON.stringify(pathToFileURL(path.join(root, "packages/core/drizzle.config.ts")).href)}

export default { ...config, out: ${JSON.stringify(output)} }
`,
  )
  const child = Bun.spawn(["bun", "drizzle-kit", "generate", "--config", config, ...(name ? ["--name", name] : [])], {
    cwd: path.join(root, "packages/core"),
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  })
  const exit = await child.exited
  if (exit !== 0) throw new Error(`Drizzle generation failed with exit code ${exit}.`)
}

async function generatedMigrations(directory: string) {
  return (await Array.fromAsync(new Bun.Glob("*/migration.sql").scan({ cwd: directory })))
    .map((file) => file.split("/")[0])
    .filter((name): name is string => name !== undefined)
    .sort()
}

async function generatedSql(directory: string) {
  const generated = await generatedMigrations(directory)
  if (generated.length !== 1) throw new Error(`Expected one full schema migration, found ${generated.length}.`)
  return Bun.file(path.join(directory, generated[0]!, "migration.sql")).text()
}

async function typescriptMigrations() {
  return (await Array.fromAsync(new Bun.Glob("*.ts").scan({ cwd: tsDir })))
    .map((file) => path.basename(file, ".ts"))
    .sort()
}

function renderMigration(name: string, sql: string) {
  return `import { sql } from "drizzle-orm"
import { Effect } from "effect"
import { prefixedIdentifier } from "../drizzle.js"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: ${JSON.stringify(name)},
  up(tx) {
    return Effect.gen(function* () {
${renderStatements(sql, { table: (table) => `prefixedIdentifier(${JSON.stringify(table)})` })}
    })
  },
}

export default migration
`
}

async function renderSchema(sql: string) {
  const tables = await tableDeclarations()
  const names: Names = {
    table: (name) => declaration(tables, name).name,
    column: (table, column) => {
      const found = declaration(tables, table)
      const key = Object.entries(getTableColumns(found.table)).find((entry) => entry[1].name === column)?.[0]
      if (key === undefined) throw new Error(`Column ${table}.${column} has no declaration.`)
      return `${found.name}.${key}`
    },
  }
  const body = renderStatements(sql, names)
  const modules = Map.groupBy(
    [...tables.values()].filter((table) => body.includes(`\${${table.name}`)),
    (table) => table.module,
  )
  return `import { sql } from "drizzle-orm"
import { Effect } from "effect"
import { prefixedIdentifier } from "./drizzle.js"
import type { DatabaseMigration } from "./migration.js"
${[...modules.entries()]
  .sort((a, b) => a[0].localeCompare(b[0]))
  .map(
    ([module, declared]) =>
      `import { ${declared
        .map((table) => table.name)
        .sort()
        .join(", ")} } from ${JSON.stringify(module)}`,
  )
  .join("\n")}

const schema: Omit<DatabaseMigration.Migration, "id"> = {
  up(tx) {
    return Effect.gen(function* () {
${body}
    })
  },
}

export default schema
`
}

// How generated SQL names OpenCode's tables. The current schema references
// the table declarations; migrations are snapshots, so they name tables by
// string and stay correct when a declaration is later renamed or removed.
type Names = {
  table: (name: string) => string
  column?: (table: string, column: string) => string
}

// Every exported table declaration the Drizzle config's schema globs see, by
// table name, with the module the generated schema imports it from.
async function tableDeclarations() {
  const files = (
    await Promise.all(
      ["src/**/sql.ts", "src/**/*.sql.ts"].map((pattern) =>
        Array.fromAsync(new Bun.Glob(pattern).scan({ cwd: path.join(root, "packages/core") })),
      ),
    )
  ).flat()
  const declarations = await Promise.all(
    files.map(async (file) =>
      Object.entries(await import(path.join(root, "packages/core", file))).flatMap(([name, value]) =>
        is(value, SQLiteTable)
          ? [
              {
                name,
                table: value,
                module: path.relative("src/database", file).replace(/\.ts$/, ".js"),
              },
            ]
          : [],
      ),
    ),
  )
  return new Map(declarations.flat().map((declaration) => [getTableName(declaration.table), declaration]))
}

function declaration<T>(tables: Map<string, T>, name: string) {
  const found = tables.get(name)
  if (found === undefined) throw new Error(`Table ${name} has no declaration.`)
  return found
}

function renderStatements(sql: string, names: Names) {
  return sql
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0)
    .map((statement) => renderRun(statement, names))
    .join("\n")
}

function renderRun(statement: string, names: Names) {
  const lines = statement.replaceAll("\t", "  ").split("\n")
  if (lines.length === 1) return `      yield* tx.run(sql\`${renderLine(lines[0], names)}\`)`
  return `      yield* tx.run(sql\`\n${lines.map((line) => `        ${renderLine(line, names)}`).join("\n")}\n      \`)`
}

// Drizzle Kit quotes every name. Index names follow `INDEX`, table names follow
// the other keywords, and tables qualify columns in index expressions; those
// become interpolations that the prefixed dialect renders under the prefix.
function renderLine(line: string, names: Names) {
  const expressions: string[] = []
  const hole = (expression: string) => `\0${expressions.push(expression) - 1}\0`
  const marked = line
    .replace(
      /\b(INDEX) `(\w+)`/g,
      (_, keyword: string, name: string) => `${keyword} ${hole(`prefixedIdentifier(${JSON.stringify(name)})`)}`,
    )
    .replace(
      /\b(TABLE|REFERENCES|INTO|FROM|RENAME TO|ON) `(\w+)`/g,
      (_, keyword: string, name: string) => `${keyword} ${hole(names.table(name))}`,
    )
    .replace(/([`"])(\w+)\1\.([`"])(\w+)\3/g, (_, quote: string, table: string, columnQuote: string, column: string) =>
      names.column
        ? hole(names.column(table, column))
        : `${hole(names.table(table))}.${columnQuote}${column}${columnQuote}`,
    )
  return escapeTemplate(marked).replace(/\0(\d+)\0/g, (_, index: string) => `\${${expressions[Number(index)]}}`)
}

function escapeTemplate(line: string) {
  return line.replaceAll("\\", "\\\\").replaceAll("`", "\\`").replaceAll("${", "\\${")
}

async function formatTypescript(input: string) {
  const prettier = await import("prettier")
  const typescript = await import("prettier/plugins/typescript")
  const estree = await import("prettier/plugins/estree")
  return prettier.format(input, {
    parser: "typescript",
    plugins: [typescript.default, estree.default],
    semi: false,
    printWidth: 120,
  })
}

// Drizzle emits every array multi-line; format the snapshot so regeneration
// diffs stay minimal against the prettier-styled checked-in copy.
async function formatJson(input: string) {
  const prettier = await import("prettier")
  const babel = await import("prettier/plugins/babel")
  const estree = await import("prettier/plugins/estree")
  return prettier.format(input, {
    parser: "json",
    plugins: [babel.default, estree.default],
    printWidth: 120,
  })
}

function renderRegistry(names: string[]) {
  return `import type { DatabaseMigration } from "./migration.js"
${names.map((name, index) => `import m${index.toString().padStart(2, "0")} from "./migration/${name}.js"`).join("\n")}

export const migrations = [
${names.map((_, index) => `  m${index.toString().padStart(2, "0")},`).join("\n")}
] satisfies DatabaseMigration.Migration[]
`
}
