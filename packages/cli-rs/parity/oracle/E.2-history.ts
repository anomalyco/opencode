// P-FILE helper for E.2, driven by crates/tui/tests/all/prompt_history.rs. Run it from
// <ts-root>/packages/tui with OpenTUI's Solid preload, as parity/lib/provider.ts says.
//
//   bun E.2-history.ts <ts-root> <state>    stdin: [op]; the real PromptHistoryProvider on <state>
//
// An op is {move: [direction, input]}, which prints the entry's text or null, or {append: entry}.
// The provider loads <state>/prompt-history.jsonl first, which rewrites the file as TypeScript
// serializes it. Prints one JSON array of results.

import { existsSync, readFileSync } from "node:fs"
import { countWrites, mount, until } from "../lib/provider"

const [root, state] = process.argv.slice(2)
if (!root || !state) throw new Error("usage: E.2-history.ts <ts-root> <state>")

// The load's rewrite (`writeText`, a `writeFile`) is not awaited, and an append that lands before it ends is
// lost. Neither the file's time nor its text tells when it ended: a rewrite of the same entries writes the same
// bytes and then truncates. So the writes are counted.
const writes = countWrites(["writeFile"])
const ops = await Bun.stdin.json()

// What the provider reads on mount, read before its rewrite can change the file.
const before = existsSync(`${state}/prompt-history.jsonl`) ? readFileSync(`${state}/prompt-history.jsonl`, "utf8") : ""
const { app, value: history } = await mount<{
  move(direction: 1 | -1, input: string): { text: string } | undefined
  append(item: unknown): void
}>(root, "./prompt/history", "PromptHistoryProvider", "usePromptHistory", {
  cwd: state,
  home: state,
  state,
  worktree: state,
})
// The provider reads the file on mount; wait until an existing file's entries are in.
const file = Bun.file(`${state}/prompt-history.jsonl`)
if (before.trim()) {
  let newest = history.move(-1, "")
  await until("the load", () => {
    newest ??= history.move(-1, "")
    return newest !== undefined
  })
  // Back to the end, where the ops start.
  if (newest) history.move(1, newest.text)
  // A file with entries is rewritten on load: wait until that write has ended.
  await until("the load's rewrite", () => writes.started > 0 && writes.pending === 0)
}

const output: unknown[] = []
for (const op of ops) {
  if (op.move) output.push(history.move(op.move[0], op.move[1])?.text ?? null)
  if (op.append) history.append(op.append)
}
// Appends write asynchronously: wait until the file ends with them.
const appended: string[] = ops.flatMap((op: { append?: { text: string } }) => (op.append ? [op.append.text] : []))
if (appended.length > 0) {
  await until("the appends", async () => {
    // A fresh handle: a `BunFile` can keep the size it first saw.
    const lines = (await Bun.file(file.name!).text()).split("\n").filter(Boolean)
    const last = lines.slice(-appended.length).map((line) => JSON.parse(line).text)
    return last.length === appended.length && last.every((text, index) => text === appended[index])
  })
}
app.renderer.destroy()
console.log(JSON.stringify(output))
