// P-FILE helper for E.4, driven by crates/tui/tests/all/attach.rs. Run it from <ts-root>/packages/tui with
// OpenTUI's Solid preload, as E.2-history.ts runs.
//
//   bun E.4-stash.ts <ts-root> <state>    stdin: [op]; the real PromptStashProvider on <state>
//
// An op is {list: true}, which prints the entries' texts, {push: prompt}, {pop: true}, which prints the
// popped text or null, or {remove: index}. The provider loads <state>/prompt-stash.jsonl first, which
// rewrites the file as TypeScript serializes it. Prints one JSON array of results.

import { mock } from "bun:test"
import fs from "node:fs/promises"

const [root, state] = process.argv.slice(2)
if (!root || !state) throw new Error("usage: E.4-stash.ts <ts-root> <state>")

// The provider's writes (`writeFile`, `appendFile`) are not awaited, and one that starts while another runs can
// lose the other's lines. So the writes are counted where they run, before the TUI modules load, as E.2 does.
const writes = { started: 0, pending: 0 }
const counted =
  <A extends unknown[]>(write: (...args: A) => Promise<void>) =>
  (...args: A) => {
    writes.started++
    writes.pending++
    return write(...args).finally(() => writes.pending--)
  }
mock.module("node:fs/promises", () => ({
  ...fs,
  writeFile: counted(fs.writeFile),
  appendFile: counted(fs.appendFile),
}))

const load = (spec: string) => import(Bun.resolveSync(spec, `${root}/packages/tui/src`))
const tui = `${root}/packages/tui`
const { testRender } = await import(Bun.resolveSync("@opentui/solid", tui))
const { createComponent } = await import(Bun.resolveSync("solid-js", tui))
const { TuiPathsProvider } = await load("./context/runtime")
const { PromptStashProvider, usePromptStash } = await load("./prompt/stash")
const ops = await Bun.stdin.json()

type Entry = { prompt: { text: string }; timestamp: number }
let stash: {
  list(): Entry[]
  push(entry: { prompt: unknown }): void
  pop(): Entry | undefined
  remove(index: number): void
}
const app = await testRender(() =>
  createComponent(TuiPathsProvider, {
    value: { cwd: state, home: state, state, worktree: state },
    get children() {
      return createComponent(PromptStashProvider, {
        get children() {
          stash = usePromptStash()
          return undefined
        },
      })
    },
  }),
)
await app.renderOnce()
// Waits for a condition, up to 30 s: a loaded machine can take seconds to read or write the file.
const until = async (what: string, done: () => boolean) => {
  const deadline = Date.now() + 30_000
  while (!done()) {
    if (Date.now() >= deadline) return console.error(`timed out waiting for ${what}`)
    await Bun.sleep(5)
  }
}
// Waits until a write started after `started` writes, and none is pending.
const written = (what: string, started: number) =>
  until(what, () => writes.started > started && writes.pending === 0)
// The provider reads the file on mount, and rewrites a file with entries: wait until that write has ended.
const file = Bun.file(`${state}/prompt-stash.jsonl`)
if ((await file.exists()) && (await file.text()).trim()) {
  await until("the load", () => stash!.list().length > 0)
  await written("the load's rewrite", 0)
}

const output: unknown[] = []
for (const op of ops) {
  const started = writes.started
  const entries = stash!.list().length
  if (op.list) output.push(stash!.list().map((entry) => entry.prompt.text))
  if (op.push) stash!.push({ prompt: op.push })
  if (op.pop) output.push(stash!.pop()?.prompt.text ?? null)
  if (op.remove !== undefined) stash!.remove(op.remove)
  // A push, and a pop or remove that took an entry, write: let it end before the next op writes again.
  if (op.push || stash!.list().length < entries) await written("the write", started)
}
app.renderer.destroy()
console.log(JSON.stringify(output))
