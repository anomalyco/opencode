// P-FILE helper for E.4, driven by crates/tui/tests/all/attach.rs. Run it from <ts-root>/packages/tui with
// OpenTUI's Solid preload, as parity/lib/provider.ts says.
//
//   bun E.4-stash.ts <ts-root> <state>    stdin: [op]; the real PromptStashProvider on <state>
//
// An op is {list: true}, which prints the entries' texts, {push: prompt}, {pop: true}, which prints the
// popped text or null, or {remove: index}. The provider loads <state>/prompt-stash.jsonl first, which
// rewrites the file as TypeScript serializes it. Prints one JSON array of results.

import { countWrites, mount, until } from "../lib/provider"

const [root, state] = process.argv.slice(2)
if (!root || !state) throw new Error("usage: E.4-stash.ts <ts-root> <state>")

// The provider's writes (`writeFile`, `appendFile`) are not awaited, and one that starts while another runs can
// lose the other's lines. So the writes are counted, as E.2 does.
const writes = countWrites(["writeFile", "appendFile"])
const ops = await Bun.stdin.json()

type Entry = { prompt: { text: string }; timestamp: number }
const { app, value: stash } = await mount<{
  list(): Entry[]
  push(entry: { prompt: unknown }): void
  pop(): Entry | undefined
  remove(index: number): void
}>(root, "./prompt/stash", "PromptStashProvider", "usePromptStash", {
  cwd: state,
  home: state,
  state,
  worktree: state,
})
// Waits until a write started after `started` writes, and none is pending.
const written = (what: string, started: number) =>
  until(what, () => writes.started > started && writes.pending === 0)
// The provider reads the file on mount, and rewrites a file with entries: wait until that write has ended.
const file = Bun.file(`${state}/prompt-stash.jsonl`)
if ((await file.exists()) && (await file.text()).trim()) {
  await until("the load", () => stash.list().length > 0)
  await written("the load's rewrite", 0)
}

const output: unknown[] = []
for (const op of ops) {
  const started = writes.started
  const entries = stash.list().length
  if (op.list) output.push(stash.list().map((entry) => entry.prompt.text))
  if (op.push) stash.push({ prompt: op.push })
  if (op.pop) output.push(stash.pop()?.prompt.text ?? null)
  if (op.remove !== undefined) stash.remove(op.remove)
  // A push, and a pop or remove that took an entry, write: let it end before the next op writes again.
  if (op.push || stash.list().length < entries) await written("the write", started)
}
app.renderer.destroy()
console.log(JSON.stringify(output))
