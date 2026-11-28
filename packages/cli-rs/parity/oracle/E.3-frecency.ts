// P-FILE helper for E.3, driven by crates/tui/tests/all/complete.rs. Run it from <ts-root>/packages/tui with
// OpenTUI's Solid preload, as parity/lib/provider.ts says.
//
//   bun E.3-frecency.ts <ts-root> <state> <cwd>    stdin: [path]; the real FrecencyProvider on <state>
//
// The provider loads <state>/frecency.jsonl on mount, which rewrites it as TypeScript keeps it. Each path is
// then opened once (`updateFrecency`). Prints the frequencies by absolute path, after the updates.

import { resolve } from "node:path"
import { countWrites, mount, until } from "../lib/provider"

const [root, state, cwd] = process.argv.slice(2)
if (!root || !state || !cwd) throw new Error("usage: E.3-frecency.ts <ts-root> <state> <cwd>")

// The load's rewrite (`writeText`, a `writeFile`) is not awaited, and an append that lands before it ends is lost.
// The file's time changes while the rewrite still runs, so the writes are counted, as E.2 does.
const writes = countWrites(["writeFile"])
const paths: string[] = await Bun.stdin.json()

const { app, value: frecency } = await mount<{
  updateFrecency(path: string): void
  data(): Record<string, { frequency: number }>
}>(root, "./prompt/frecency", "FrecencyProvider", "useFrecency", { cwd, home: state, state, worktree: cwd })
// The provider reads the file on mount; wait until an existing file's entries are in.
const file = Bun.file(`${state}/frecency.jsonl`)
if ((await file.exists()) && (await file.text()).trim()) {
  await until("the load", () => Object.keys(frecency.data()).length > 0)
  // A file with entries is rewritten on load: wait until that write has ended.
  await until("the load's rewrite", () => writes.started > 0 && writes.pending === 0)
}
const loaded = Object.keys(frecency.data()).length
for (const path of paths) frecency.updateFrecency(path)
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
  JSON.stringify(Object.fromEntries(Object.entries(frecency.data()).map(([path, entry]) => [path, entry.frequency]))),
)
