// P-FILE helper for E.4, driven by crates/tui/tests/attach.rs. Run it from <ts-root>/packages/tui with
// OpenTUI's Solid preload, as E.2-history.ts runs.
//
//   bun E.4-stash.ts <ts-root> <state>    stdin: [op]; the real PromptStashProvider on <state>
//
// An op is {list: true}, which prints the entries' texts, {push: prompt}, {pop: true}, which prints the
// popped text or null, or {remove: index}. The provider loads <state>/prompt-stash.jsonl first, which
// rewrites the file as TypeScript serializes it. Prints one JSON array of results.

const [root, state] = process.argv.slice(2)
if (!root || !state) throw new Error("usage: E.4-stash.ts <ts-root> <state>")

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
// The provider reads the file on mount; wait until an existing file's entries are in.
const file = Bun.file(`${state}/prompt-stash.jsonl`)
if ((await file.exists()) && (await file.text()).trim()) {
  for (let i = 0; i < 200 && stash!.list().length === 0; i++) await Bun.sleep(5)
}

const output: unknown[] = []
for (const op of ops) {
  if (op.list) output.push(stash!.list().map((entry) => entry.prompt.text))
  if (op.push) stash!.push({ prompt: op.push })
  if (op.pop) output.push(stash!.pop()?.prompt.text ?? null)
  if (op.remove !== undefined) stash!.remove(op.remove)
  // Writes are asynchronous; let each land before the next rewrites the file.
  await Bun.sleep(20)
}
app.renderer.destroy()
console.log(JSON.stringify(output))
