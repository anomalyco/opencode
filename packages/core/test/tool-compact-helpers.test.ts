import { expect } from "bun:test"
import { Database } from "bun:sqlite"
import path from "path"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Environment } from "@opencode/core/environment/index"
import { Location } from "@opencode/core/location"
import { FileAccess } from "@opencode/core/file-access"
import { Permission } from "@opencode/core/permission"
import { Ripgrep } from "@opencode/core/ripgrep"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { GrepTool } from "@opencode/core/tool/plugin/grep"
import { DbQueryTool } from "@opencode/core/tool/plugin/db-query"
import { Tool } from "@opencode/core/tool"
import { location } from "./fixture/location"
import { tmpdirScoped } from "./fixture/tmpdir"
import { it } from "./lib/effect"
import { permissionLayer } from "./lib/permission"
import { executeTool, registerToolPlugin, toolIdentity } from "./lib/tool"

const helperNode = makeLocationNode({
  name: "test/compact-helpers",
  layer: Layer.effectDiscard(
    Effect.gen(function* () {
      yield* registerToolPlugin(GrepTool.Plugin)
      yield* registerToolPlugin(DbQueryTool.Plugin)
    }),
  ),
  deps: [Tool.node, Environment.node, Ripgrep.node, Location.node, FileAccess.node, Permission.node],
})

const withTools = <A, E, R>(directory: string, body: (registry: Tool.Interface) => Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const registry = yield* Tool.Service
    return yield* body(registry)
  }).pipe(
    Effect.provide(
      AppNodeBuilder.build(LayerNode.group([Tool.node, helperNode]), [
        Location.node.replace(
          Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make(directory) }))),
        ),
        Permission.node.replace(permissionLayer({ assert: () => Effect.void })),
      ]),
    ),
  )

const run = (registry: Tool.Interface, code: string) =>
  executeTool(registry, {
    sessionID: Session.ID.make("ses_compact_helpers"),
    ...toolIdentity,
    call: { type: "tool-call", id: "call-compact-helper", name: "execute", input: { code } },
  })

it.live("search results stay inside execute until the program returns its summary", () =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped()
    yield* Effect.promise(() =>
      Bun.write(path.join(tmp.path, "sample.txt"), ("needle " + "😀".repeat(50) + "\n").repeat(3)),
    )
    yield* withTools(tmp.path, (registry) =>
      Effect.gen(function* () {
        const result = yield* run(
          registry,
          'const r = await tools.opencode.fs_search({ pattern: "needle", limit: 2, maxChars: 20 }); return { count: r.count, truncated: r.truncated, lengths: r.matches.map(m => Array.from(m.text).length), cut: r.matches.every(m => m.truncated) }',
        )
        expect(result.status).toBe("completed")
        expect(result.content?.[0]).toEqual({
          type: "text",
          text: JSON.stringify({ count: 2, truncated: true, lengths: [20, 20], cut: true }, null, 2),
        })
        const invalid = yield* run(registry, 'return await tools.opencode.fs_search({ pattern: "needle", limit: 51 })')
        expect(invalid.content?.[0]?.type === "text" && invalid.content[0].text).not.toContain("matches")
      }),
    )
  }),
)

it.live("SQLite results are bounded, parameterized and read-only through execute", () =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped()
    yield* Effect.sync(() => {
      const db = new Database(path.join(tmp.path, "fixture.db"))
      db.run("CREATE TABLE sample (id INTEGER, text TEXT, data BLOB)")
      const insert = db.query("INSERT INTO sample VALUES (?, ?, ?)")
      for (const id of [1, 2, 3]) insert.run(id, "😀".repeat(80), new Uint8Array([1, 2, 3]))
      db.close()
    })
    yield* withTools(tmp.path, (registry) =>
      Effect.gen(function* () {
        const result = yield* run(
          registry,
          'const r = await tools.opencode.db_query({ path: "fixture.db", query: "SELECT * FROM sample WHERE id > ? ORDER BY id", params: [0], limit: 2, maxChars: 20 }); return { ids: r.rows.map(row => row.id), length: Array.from(r.rows[0].text).length, blob: r.rows[0].data, truncated: r.truncated, truncatedCells: r.truncatedCells }',
        )
        expect(result.status).toBe("completed")
        expect(result.content?.[0]).toEqual({
          type: "text",
          text: JSON.stringify(
            { ids: [1, 2], length: 20, blob: "[blob: 3 bytes]", truncated: true, truncatedCells: 2 },
            null,
            2,
          ),
        })
        for (const query of [
          "DELETE FROM sample",
          "WITH x AS (SELECT 1) DELETE FROM sample",
          "SELECT * FROM sample); DELETE FROM sample; --",
        ]) {
          yield* run(registry, `return await tools.opencode.db_query(${JSON.stringify({ path: "fixture.db", query })})`)
        }
        const count = yield* run(
          registry,
          'const r = await tools.opencode.db_query({ path: "fixture.db", query: "SELECT COUNT(*) AS count FROM sample" }); return r.rows[0].count',
        )
        expect(count.content?.[0]).toEqual({ type: "text", text: "3" })
      }),
    )
  }),
)
