// P-FILE helper for E.3, driven by crates/tui/tests/all/complete.rs. Run it from <ts-root>/packages/tui with
// OpenTUI's Solid preload, as E.2-history.ts runs.
//
//   bun E.3-frecency.ts <ts-root> <state> <cwd>    stdin: [path]; the real FrecencyProvider on <state>
//
// The provider loads <state>/frecency.jsonl on mount, which rewrites it as TypeScript keeps it. Each path is
// then opened once (`updateFrecency`). Prints the frequencies by absolute path, after the updates.

import { mock } from "bun:test"
import fs from "node:fs/promises"
import { resolve } from "node:path"

const [root, state, cwd] = process.argv.slice(2)
if (!root || !state || !cwd) throw new Error("usage: E.3-frecency.ts <ts-root> <state> <cwd>")

// The load's rewrite (`writeText`, a `writeFile`) is not awaited, and an append that lands before it ends is lost.
// The file's time changes while the rewrite still runs, so the writes are counted where they run, before the TUI
// modules load, as E.2 does.
const writes = { started: 0, pending: 0 }
mock.module("node:fs/promises", () => ({
  ...fs,
  writeFile: (...args: Parameters<typeof fs.writeFile>) => {
    writes.started++
    writes.pending++
    return fs.writeFile(...args).finally(() => writes.pending--)
  },
}))

const load = (spec: string) => import(Bun.resolveSync(spec, `${root}/packages/tui/src`))
const tui = `${root}/packages/tui`
const { testRender } = await import(Bun.resolveSync("@opentui/solid", tui))
const { createComponent } = await import(Bun.resolveSync("solid-js", tui))
const { TuiPathsProvider } = await load("./context/runtime")
const { FrecencyProvider, useFrecency } = await load("./prompt/frecency")
const paths: string[] = await Bun.stdin.json()

let frecency: { updateFrecency(path: string): void; data(): Record<string, { frequency: number }> }
const app = await testRender(() =>
  createComponent(TuiPathsProvider, {
    value: { cwd, home: state, state, worktree: cwd },
    get children() {
      return createComponent(FrecencyProvider, {
        get children() {
          frecency = useFrecency()
          return undefined
        },
      })
    },
  }),
)
await app.renderOnce()
// Waits for a condition, up to 30 s: a loaded machine can take seconds to read or write the file.
const until = async (what: string, done: () => Promise<boolean> | boolean) => {
  const deadline = Date.now() + 30_000
  while (!(await done())) {
    if (Date.now() >= deadline) return console.error(`timed out waiting for ${what}`)
    await Bun.sleep(5)
  }
}
// The provider reads the file on mount; wait until an existing file's entries are in.
const file = Bun.file(`${state}/frecency.jsonl`)
if ((await file.exists()) && (await file.text()).trim()) {
  await until("the load", () => Object.keys(frecency!.data()).length > 0)
  // A file with entries is rewritten on load: wait until that write has ended.
  await until("the load's rewrite", () => writes.started > 0 && writes.pending === 0)
}
const loaded = Object.keys(frecency!.data()).length
for (const path of paths) frecency!.updateFrecency(path)
// Appends write asynchronously, in any order: wait until the load's one line per path is followed by one line
// per update.
const updated = JSON.stringify(paths.map((path) => resolve(cwd, path)).sort())
await until("the appends", async () => {
  // A fresh handle: a `BunFile` can keep the size it first saw.
  const lines = (await Bun.file(file.name!).text()).split("\n").filter(Boolean)
  const appended = lines.slice(loaded).map((line) => JSON.parse(line).path)
  return lines.length === loaded + paths.length && JSON.stringify(appended.sort()) === updated
})
app.renderer.destroy()
console.log(
  JSON.stringify(Object.fromEntries(Object.entries(frecency!.data()).map(([path, entry]) => [path, entry.frequency]))),
)
