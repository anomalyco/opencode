import { describe, expect, test } from "bun:test"
import type { BunPlugin } from "bun"
import { join } from "path"

// Pins the #database and #sqlite subpath-import condition gates: bundling
// database.ts for a non-Bun runtime must never reach @effect/sql-sqlite-bun
// (and its static `import "bun:sqlite"`), which crashes workerd (and any other
// non-Bun bundle) at module load. The default build talks to PostgreSQL; only
// the workerd and explicit sqlite conditions select a SQLite client. Bare
// imports are externalized so only core-relative modules — including the
// resolution under test — end up in the bundle, and the client package each
// runtime picked stays visible as an import specifier.
const externalizeBare: BunPlugin = {
  name: "externalize-bare",
  setup(build) {
    build.onResolve({ filter: /^[^.#/]/ }, (args) => ({ path: args.path, external: true }))
  },
}

const bundle = async (conditions: Array<string>) => {
  const result = await Bun.build({
    // join over URL.pathname: on Windows the latter yields "/C:/..." which
    // module resolution rejects.
    entrypoints: [join(import.meta.dir, "../src/database/database.ts")],
    target: "browser",
    conditions,
    plugins: [externalizeBare],
    throw: false,
  })
  expect(result.logs).toEqual([])
  expect(result.success).toBe(true)
  return result.outputs[0].text()
}

// Skipped on Windows: Bun.build inside `bun test` reliably panics Bun 1.3.14
// there ("Internal assertion failure", twice in a row on CI, always at this
// file). The assertions pin platform-independent package.json condition
// resolution, so Linux coverage loses nothing.
describe.skipIf(process.platform === "win32")("database driver bundle conditions", () => {
  test("workerd conditions select the Durable Object driver and never bun:sqlite", async () => {
    const output = await bundle(["workerd"])
    expect(output).not.toContain("bun:sqlite")
    expect(output).not.toContain("node:sqlite")
    expect(output).not.toContain("@effect/sql-sqlite-bun")
    expect(output).not.toContain("@effect/sql-sqlite-node")
    expect(output).not.toContain("@effect/sql-pg")
    expect(output).toContain("SqliteWorkerd")
  })

  test.each([[["node"]], [[]]])("%p conditions select PostgreSQL, not a SQLite client", async (conditions) => {
    const output = await bundle(conditions)
    expect(output).not.toContain("bun:sqlite")
    expect(output).not.toContain("node:sqlite")
    expect(output).not.toContain("@effect/sql-sqlite-bun")
    expect(output).not.toContain("@effect/sql-sqlite-node")
    expect(output).toContain("@effect/sql-pg")
  })

  test("the sqlite condition selects the Node client, not bun:sqlite", async () => {
    const output = await bundle(["node", "sqlite"])
    expect(output).not.toContain("bun:sqlite")
    expect(output).not.toContain("@effect/sql-sqlite-bun")
    expect(output).not.toContain("@effect/sql-pg")
    expect(output).toContain("@effect/sql-sqlite-node")
  })
})
