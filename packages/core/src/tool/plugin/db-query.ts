export * as DbQueryTool from "./db-query.js"

import { ToolFailure } from "@opencode/ai"
import type { Context } from "@opencode/plugin/effect/plugin"
import { Effect, Schema } from "effect"
import { SqlClient } from "effect/unstable/sql"
import { Environment } from "../../environment/index.js"
import { FileAccess } from "../../file-access.js"
import { Location } from "../../location.js"

const Cell = Schema.Union([Schema.String, Schema.Number, Schema.Null])

export const Plugin = {
  id: "opencode.tool.db-query",
  effect: Effect.fn("DbQueryTool.Plugin")(function* (ctx: Context) {
    const access = yield* FileAccess.Service
    const location = yield* Location.Service
    const environment = yield* Environment.Service
    yield* ctx.tool
      .transform((editor) => {
        editor.add({
          name: "db_query",
          options: { namespace: "opencode", codemode: true, permission: "read" },
          description:
            "Query a local SQLite file read-only. Supply a SELECT, WITH, or VALUES query without a trailing semicolon. Results are bounded JSON; filter them inside execute and return only the final summary. Blob cells are replaced with byte counts.",
          input: Schema.Struct({
            path: Schema.String,
            query: Schema.String.check(Schema.isMinLength(1)),
            params: Schema.optionalKey(Schema.Array(Cell)),
            limit: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 50 }))),
            maxChars: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 20, maximum: 1000 }))),
          }),
          output: Schema.Struct({
            rows: Schema.Array(Schema.Record(Schema.String, Cell)),
            count: Schema.Int,
            truncated: Schema.Boolean,
            truncatedCells: Schema.Int,
          }),
          execute: (input, context) =>
            Effect.gen(function* () {
              if (location.workspaceID)
                return yield* Effect.fail(new ToolFailure({ message: "SQLite file queries require a local workspace" }))
              const target = yield* access.authorizeRead(input.path, context)
              const kind = yield* Environment.typeFollowing(environment.files, target.absolute)
              if (kind !== "file")
                return yield* Effect.fail(new ToolFailure({ message: "SQLite path must be an existing file" }))
              const { sqliteLayer } = yield* Effect.promise(() => import("#sqlite"))
              const limit = input.limit ?? 10
              const maxChars = input.maxChars ?? 200
              const data = yield* Effect.gen(function* () {
                const sql = yield* SqlClient.SqlClient
                return yield* sql.unsafe(`SELECT * FROM (${input.query}) LIMIT ${limit + 1}`, input.params ?? [])
              }).pipe(
                Effect.provide(
                  sqliteLayer({
                    filename: target.absolute,
                    readonly: true,
                    readwrite: false,
                    create: false,
                    disableWAL: true,
                  }),
                ),
              )
              const cells = data.slice(0, limit).map((row) =>
                Object.entries(row).map(([key, value]) => {
                  if (value === null || typeof value === "number") return { key, value, truncated: false }
                  const text = value instanceof Uint8Array ? `[blob: ${value.byteLength} bytes]` : String(value)
                  const chars = Array.from(text)
                  return { key, value: chars.slice(0, maxChars).join(""), truncated: chars.length > maxChars }
                }),
              )
              return {
                output: {
                  rows: cells.map((row) => Object.fromEntries(row.map((cell) => [cell.key, cell.value]))),
                  count: cells.length,
                  truncated: data.length > limit,
                  truncatedCells: cells.flat().filter((cell) => cell.truncated).length,
                },
              }
            }).pipe(
              Effect.mapError((error) =>
                error instanceof ToolFailure
                  ? error
                  : new ToolFailure({ message: "Unable to query SQLite file", error }),
              ),
            ),
        })
      })
      .pipe(Effect.orDie)
  }),
}
