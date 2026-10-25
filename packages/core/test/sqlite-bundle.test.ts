import { describe, expect, test } from "bun:test"
import type { BunPlugin } from "bun"
import { join } from "path"

// Pins the #sqlite subpath-import condition gate: bundling database.ts for a
// non-Bun runtime must never reach the static `import "bun:sqlite"` in
// sqlite.bun.ts, which crashes workerd (and any other non-Bun bundle) at
// module load. Bare imports are externalized so only core-relative modules —
// including the #sqlite resolution under test — end up in the bundle.
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
describe.skipIf(process.platform === "win32")("sqlite bundle conditions", () => {
  test("workerd conditions select the Durable Object driver and never bun:sqlite", async () => {
    const output = await bundle(["workerd"])
    expect(output).not.toContain("bun:sqlite")
    expect(output).not.toContain("node:sqlite")
    expect(output).toContain("SqliteWorkerd")
  })

  test("default conditions fall back to node:sqlite, not bun:sqlite", async () => {
    const output = await bundle([])
    expect(output).not.toContain("bun:sqlite")
    expect(output).toContain("SqliteNode")
  })
})
