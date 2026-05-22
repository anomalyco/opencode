import { describe, expect, test } from "bun:test"
import { DatabaseMigration } from "@opencode-ai/core/database/migration"

const rand = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) >>> 0
  return seed / 0x100000000
}

describe("DatabaseMigration", () => {
  test("diff creates missing tables before indexes", () => {
    const table = makeTable(
      "session",
      [makeColumn("id", { primaryKey: true })],
      [makeIndex("session_id_idx", "session", ["id"])],
    )

    expect(DatabaseMigration.diff(emptySchema(), schema(table))).toEqual([
      { type: "create_table", table },
      { type: "create_index", index: table.indexes.session_id_idx },
    ])
  })

  test("diff adds missing columns and indexes without recreating existing tables", () => {
    const actual = makeTable("session", [makeColumn("id", { primaryKey: true })], [])
    const desired = makeTable(
      "session",
      [makeColumn("id", { primaryKey: true }), makeColumn("title", { notNull: true })],
      [makeIndex("session_title_idx", "session", ["title"])],
    )

    expect(DatabaseMigration.diff(schema(actual), schema(desired))).toEqual([
      { type: "add_column", table: "session", column: desired.columns.title },
      { type: "create_index", index: desired.indexes.session_title_idx },
    ])
  })

  test("diff is empty when actual already satisfies desired", () => {
    const table = makeTable(
      "session",
      [makeColumn("id", { primaryKey: true }), makeColumn("title")],
      [makeIndex("session_title_idx", "session", ["title"])],
    )

    expect(DatabaseMigration.diff(schema(table), schema(table))).toEqual([])
  })

  test("random desired schemas generate exactly missing additive operations", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const random = rand(seed)
      const desiredTables = Array.from({ length: 1 + Math.floor(random() * 5) }, (_, i) =>
        makeRandomTable(random, `table_${i}`),
      )
      const actualTables = desiredTables
        .filter(() => random() > 0.25)
        .map((table) =>
          makeTable(
            table.name,
            Object.values(table.columns).filter((column) => column.primaryKey || random() > 0.35),
            Object.values(table.indexes).filter(() => random() > 0.5),
          ),
        )
      const operations = DatabaseMigration.diff(schema(...actualTables), schema(...desiredTables))
      const expected = desiredTables.flatMap<DatabaseMigration.Operation>((table) => {
        const actual = actualTables.find((item) => item.name === table.name)
        if (!actual) {
          return [createTableOperation(table), ...Object.values(table.indexes).map(createIndexOperation)]
        }
        return [
          ...Object.values(table.columns)
            .filter((column) => actual.columns[column.name] === undefined)
            .map((column) => addColumnOperation(table.name, column)),
          ...Object.values(table.indexes)
            .filter((index) => actual.indexes[index.name] === undefined)
            .map(createIndexOperation),
        ]
      })

      expect(operations).toEqual(expected)
    }
  })

  test("random operations render quoted SQL", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const random = rand(seed)
      const table = makeRandomTable(random, `table_"${seed}`)
      const operations = DatabaseMigration.diff(emptySchema(), schema(table))

      for (const operation of operations) {
        const rendered = DatabaseMigration.toSql(operation)
        expect(rendered).not.toContain("undefined")
        expect(rendered).toContain('"')
      }
    }
  })
})

function emptySchema(): DatabaseMigration.SchemaAst {
  return { tables: {} }
}

function schema(...tables: DatabaseMigration.TableAst[]): DatabaseMigration.SchemaAst {
  return { tables: Object.fromEntries(tables.map((table) => [table.name, table])) }
}

function makeTable(
  name: string,
  columns: DatabaseMigration.ColumnAst[],
  indexes: DatabaseMigration.IndexAst[],
): DatabaseMigration.TableAst {
  return {
    name,
    columns: Object.fromEntries(columns.map((column) => [column.name, column])),
    indexes: Object.fromEntries(indexes.map((index) => [index.name, index])),
  }
}

function createTableOperation(table: DatabaseMigration.TableAst): DatabaseMigration.Operation {
  return { type: "create_table", table }
}

function addColumnOperation(table: string, column: DatabaseMigration.ColumnAst): DatabaseMigration.Operation {
  return { type: "add_column", table, column }
}

function createIndexOperation(index: DatabaseMigration.IndexAst): DatabaseMigration.Operation {
  return { type: "create_index", index }
}

function makeColumn(
  name: string,
  options: Partial<Omit<DatabaseMigration.ColumnAst, "name" | "type">> = {},
): DatabaseMigration.ColumnAst {
  return {
    name,
    type: "text",
    notNull: options.notNull ?? false,
    primaryKey: options.primaryKey ?? false,
    ...(options.default === undefined ? {} : { default: options.default }),
  }
}

function makeIndex(name: string, table: string, columns: string[], unique = false): DatabaseMigration.IndexAst {
  return { name, table, columns, unique }
}

function makeRandomTable(random: () => number, name: string) {
  const columns = Array.from({ length: 1 + Math.floor(random() * 8) }, (_, i) =>
    makeColumn(`column_${i}`, {
      primaryKey: i === 0,
      notNull: i === 0 || random() > 0.5,
      default: random() > 0.7 ? String(Math.floor(random() * 100)) : undefined,
    }),
  )
  const indexes = columns
    .filter((column) => !column.primaryKey && random() > 0.5)
    .map((column) => makeIndex(`${name}_${column.name}_idx`, name, [column.name], random() > 0.75))
  return makeTable(name, columns, indexes)
}
