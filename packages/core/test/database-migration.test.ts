import { describe, expect, test } from "bun:test"
import { SqliteClient } from "@effect/sql-sqlite-bun"
import { EffectDrizzleSqlite } from "@opencode-ai/effect-drizzle-sqlite"
import { DatabaseMigration } from "@opencode-ai/core/database/migration"
import { Effect } from "effect"
import { index, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"
import { sql, type ColumnBuilderBase } from "drizzle-orm"
import path from "path"
import { tmpdir } from "./fixture/tmpdir"

const rand = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) >>> 0
  return seed / 0x100000000
}

describe("DatabaseMigration", () => {
  test("diff creates missing tables before indexes and apply is idempotent", () =>
    withDb((db) =>
      Effect.gen(function* () {
        const table = sqliteTable(
          "session",
          {
            id: text().primaryKey(),
            slug: text().notNull(),
            title: text().notNull().default("untitled"),
          },
          (table) => [index("session_slug_idx").on(table.slug), uniqueIndex("session_title_uidx").on(table.title)],
        )

        const operations = yield* DatabaseMigration.diff(db, [table])
        expect(operations.map((operation) => operation.type)).toEqual(["create_table", "create_index", "create_index"])

        yield* DatabaseMigration.apply(db, operations)
        expect(yield* DatabaseMigration.diff(db, [table])).toEqual([])
        expect((yield* columnNames(db, "session")).sort()).toEqual(["id", "slug", "title"])
        expect((yield* indexNames(db, "session")).sort()).toEqual(["session_slug_idx", "session_title_uidx"])
      }),
    ),
  )

  test("diff adds missing columns and indexes without recreating existing tables", () =>
    withDb((db) =>
      Effect.gen(function* () {
        yield* db.run(`CREATE TABLE "session" ("id" text PRIMARY KEY NOT NULL)`)
        const table = sqliteTable(
          "session",
          {
            id: text().primaryKey(),
            title: text().notNull().default("untitled"),
            path: text(),
          },
          (table) => [index("session_title_idx").on(table.title)],
        )

        const operations = yield* DatabaseMigration.diff(db, [table])
        expect(operations.map((operation) => operation.type)).toEqual(["add_column", "add_column", "create_index"])

        yield* DatabaseMigration.apply(db, operations)
        expect(yield* DatabaseMigration.diff(db, [table])).toEqual([])
        expect((yield* columnNames(db, "session")).sort()).toEqual(["id", "path", "title"])
        expect(yield* indexNames(db, "session")).toEqual(["session_title_idx"])
      }),
    ),
  )

  test("diff is additive only and ignores extra actual schema and definition drift", () =>
    withDb((db) =>
      Effect.gen(function* () {
        yield* db.run(`CREATE TABLE "session" ("id" text PRIMARY KEY NOT NULL, "title" integer NOT NULL, "extra" text)`)
        yield* db.run(`CREATE INDEX "session_extra_idx" ON "session" ("extra")`)
        yield* db.run(`CREATE TABLE "extra_table" ("id" text PRIMARY KEY)`)
        const table = sqliteTable("session", {
          id: text().primaryKey(),
          title: text().notNull().default("untitled"),
        })

        expect(yield* DatabaseMigration.diff(db, [table])).toEqual([])
      }),
    ),
  )

  test("diff ignores changed indexes to stay downgrade safe", () =>
    withDb((db) =>
      Effect.gen(function* () {
        yield* db.run(`CREATE TABLE "session" ("id" text PRIMARY KEY NOT NULL, "title" text, "slug" text)`)
        yield* db.run(`CREATE INDEX "session_lookup_idx" ON "session" ("slug")`)
        yield* db.run(`CREATE INDEX "session_expression_idx" ON "session" (lower("slug"))`)
        const table = sqliteTable(
          "session",
          {
            id: text().primaryKey(),
            title: text(),
            slug: text(),
          },
          (table) => [
            uniqueIndex("session_lookup_idx").on(table.title, table.slug),
            index("session_expression_idx").on(sql`lower(${table.title})`),
          ],
        )

        expect(yield* DatabaseMigration.diff(db, [table])).toEqual([])
        expect((yield* indexColumns(db, "session_lookup_idx")).map((column) => column.name)).toEqual(["slug"])
      }),
    ),
  )

  test("diff ignores changed not-null constraints to stay downgrade safe", () =>
    withDb((db) =>
      Effect.gen(function* () {
        yield* db.run(`CREATE TABLE "session" ("id" text PRIMARY KEY NOT NULL, "required" text, "optional" text NOT NULL)`)
        const table = sqliteTable("session", {
          id: text().primaryKey(),
          required: text().notNull(),
          optional: text(),
        })

        expect(yield* DatabaseMigration.diff(db, [table])).toEqual([])
        expect(yield* columnFlags(db, "session")).toMatchObject({ required: { notnull: 0 }, optional: { notnull: 1 } })
      }),
    ),
  )

  test("apply handles quoted identifiers, composite indexes, unique indexes, and expression indexes", () =>
    withDb((db) =>
      Effect.gen(function* () {
        const table = sqliteTable(
          "table \" with spaces",
          {
            id: text('id " col').primaryKey(),
            value: text('value " one').notNull().default("a'b"),
            other: text("other space"),
          },
          (table) => [
            uniqueIndex('idx " composite').on(table.value, table.other),
            index('idx " expression').on(sql`lower(${table.value})`.inlineParams()),
          ],
        )

        yield* DatabaseMigration.apply(db, yield* DatabaseMigration.diff(db, [table]))
        expect(yield* DatabaseMigration.diff(db, [table])).toEqual([])
        expect((yield* columnNames(db, 'table " with spaces')).sort()).toEqual(["id \" col", "other space", "value \" one"])
        expect((yield* indexNames(db, 'table " with spaces')).sort()).toEqual(['idx " composite', 'idx " expression'])
      }),
    ),
  )

  test("random schema reconciliation reaches a fixed point with additive operations", () =>
    withDb((db) =>
      Effect.gen(function* () {
        for (let seed = 1; seed <= 75; seed++) {
          const random = rand(seed)
          const specs = Array.from({ length: 1 + Math.floor(random() * 4) }, (_, index) => randomSpec(random, seed, index))
          for (const spec of specs) yield* seedActualSchema(db, spec, random)

          const tables = specs.map(tableFromSpec)
          const operations = yield* DatabaseMigration.diff(db, tables)
          expect(
            operations.every((operation) => ["create_table", "add_column", "create_index"].includes(operation.type)),
          ).toBe(true)

          yield* DatabaseMigration.apply(db, operations)
          expect(yield* DatabaseMigration.diff(db, tables)).toEqual([])
        }
      }),
    ),
    20000,
  )
})

type TableSpec = {
  name: string
  columns: ColumnSpec[]
  indexes: IndexSpec[]
}

type ColumnSpec = {
  key: string
  name: string
  primaryKey: boolean
  notNull: boolean
  default?: string
}

type IndexSpec = {
  name: string
  columns: string[]
  unique: boolean
}

function tableFromSpec(spec: TableSpec) {
  const columns = Object.fromEntries(spec.columns.map((column) => [column.key, columnBuilder(column)])) as Record<string, ColumnBuilderBase>
  return sqliteTable(spec.name, columns, (table) =>
    spec.indexes.map((item) => {
      const columns = item.columns.map((key) => table[key]).filter((column) => column !== undefined)
      const first = columns[0]
      if (!first) throw new Error(`index ${item.name} has no columns`)
      return (item.unique ? uniqueIndex(item.name) : index(item.name)).on(first, ...columns.slice(1))
    }),
  )
}

function columnBuilder(spec: ColumnSpec): ColumnBuilderBase {
  if (spec.primaryKey) return text(spec.name).primaryKey()
  if (spec.default !== undefined) return text(spec.name).notNull().default(spec.default)
  if (spec.notNull) return text(spec.name).notNull()
  return text(spec.name)
}

function randomSpec(random: () => number, seed: number, index: number): TableSpec {
  const name = identifier(random, `table_${seed}_${index}`)
  const columns = Array.from({ length: 1 + Math.floor(random() * 8) }, (_, i): ColumnSpec => {
    const primaryKey = i === 0
    const notNull = primaryKey || random() > 0.5
    return {
      key: `column_${i}`,
      name: identifier(random, `column_${i}`),
      primaryKey,
      notNull,
      ...(notNull && !primaryKey ? { default: `default_${Math.floor(random() * 1000)}` } : {}),
    }
  })
  const indexes = columns
    .filter((column) => !column.primaryKey && random() > 0.45)
    .map((column, i): IndexSpec => ({
      name: identifier(random, `${name}_${column.name}_${i}_idx`),
      columns: random() > 0.65 ? columns.filter((item) => !item.primaryKey).slice(0, 2).map((item) => item.key) : [column.key],
      unique: random() > 0.8,
    }))
    .filter((item) => item.columns.length > 0)
  return { name, columns, indexes }
}

function seedActualSchema(db: EffectDrizzleSqlite.EffectSQLiteDatabase, spec: TableSpec, random: () => number) {
  return Effect.gen(function* () {
    if (random() < 0.25) return
    const columns = spec.columns.filter((column) => column.primaryKey || random() > 0.35)
        yield* db.run(`CREATE TABLE ${quoteIdentifier(spec.name)} (${columns.map(columnSql).join(", ")})`)
    for (const column of columns.filter((column) => !column.primaryKey && !column.notNull && random() > 0.6)) {
      yield* db.run(`ALTER TABLE ${quoteIdentifier(spec.name)} ALTER COLUMN ${quoteIdentifier(column.name)} SET NOT NULL`)
    }
    for (const item of spec.indexes.filter(() => random() > 0.5)) {
      if (!item.columns.every((key) => columns.some((column) => column.key === key))) continue
      const changed = random() > 0.5
      yield* db.run(
        indexSql(spec.name, {
          ...item,
          unique: changed ? !item.unique : item.unique,
          columns: changed ? [...item.columns].reverse() : item.columns,
        }),
      )
    }
  })
}

function columnSql(spec: ColumnSpec) {
  return [
    quoteIdentifier(spec.name),
    "text",
    spec.primaryKey ? "PRIMARY KEY" : undefined,
    spec.notNull ? "NOT NULL" : undefined,
    spec.default === undefined ? undefined : `DEFAULT ${literal(spec.default)}`,
  ]
    .filter((item) => item !== undefined)
    .join(" ")
}

function indexSql(table: string, spec: IndexSpec) {
  return [
    "CREATE",
    spec.unique ? "UNIQUE" : undefined,
    "INDEX",
    quoteIdentifier(spec.name),
    "ON",
    quoteIdentifier(table),
    `(${spec.columns.map((column) => quoteIdentifier(columnName(column))).join(", ")})`,
  ]
    .filter((item) => item !== undefined)
    .join(" ")
}

function indexColumns(db: EffectDrizzleSqlite.EffectSQLiteDatabase, index: string) {
  return db.all<{ name: string | null }>(`PRAGMA index_info(${quoteIdentifier(index)})`)
}

function columnName(key: string) {
  return key.replace(/^column_/, "column_")
}

function identifier(random: () => number, fallback: string) {
  const suffixes = ["", " space", ' " quote', " select", "-dash", "_underscore"]
  return `${fallback}${suffixes[Math.floor(random() * suffixes.length)]}`
}

function columnNames(db: EffectDrizzleSqlite.EffectSQLiteDatabase, table: string) {
  return db.all<{ name: string }>(`PRAGMA table_info(${quoteIdentifier(table)})`).pipe(Effect.map((rows) => rows.map((row) => row.name)))
}

function indexNames(db: EffectDrizzleSqlite.EffectSQLiteDatabase, table: string) {
  return db
    .all<{ name: string }>(`PRAGMA index_list(${quoteIdentifier(table)})`)
    .pipe(Effect.map((rows) => rows.map((row) => row.name).filter((name) => !name.startsWith("sqlite_autoindex_"))))
}

function columnFlags(db: EffectDrizzleSqlite.EffectSQLiteDatabase, table: string) {
  return db
    .all<{ name: string; notnull: number }>(`PRAGMA table_info(${quoteIdentifier(table)})`)
    .pipe(Effect.map((rows) => Object.fromEntries(rows.map((row) => [row.name, { notnull: row.notnull }]))))
}

async function withDb<A>(fn: (db: EffectDrizzleSqlite.EffectSQLiteDatabase) => Effect.Effect<A, unknown, never>) {
  const dir = await tmpdir()
  try {
    return await Effect.gen(function* () {
      const db = yield* EffectDrizzleSqlite.makeWithDefaults()
      return yield* fn(db)
    }).pipe(Effect.provide(SqliteClient.layer({ filename: path.join(dir.path, "test.db") })), Effect.runPromise)
  } finally {
    await dir[Symbol.asyncDispose]()
  }
}

function quoteIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`
}

function literal(value: string) {
  return `'${value.replaceAll("'", "''")}'`
}
