// P-FILE helper for E.2, driven by crates/tui/tests/prompt_history.rs. Run it from
// <ts-root>/packages/tui with OpenTUI's Solid preload. Solid and OpenTUI resolve as packages/tui
// resolves them, so this file and the TUI sources share one Solid instance (no JSX here for that reason).
//
//   bun E.2-history.ts <ts-root> <state>    stdin: [op]; the real PromptHistoryProvider on <state>
//
// An op is {move: [direction, input]}, which prints the entry's text or null, or {append: entry}.
// The provider loads <state>/prompt-history.jsonl first, which rewrites the file as TypeScript
// serializes it. Prints one JSON array of results.

const [root, state] = process.argv.slice(2)
if (!root || !state) throw new Error("usage: E.2-history.ts <ts-root> <state>")

const load = (spec: string) => import(Bun.resolveSync(spec, `${root}/packages/tui/src`))
const tui = `${root}/packages/tui`
const { testRender } = await import(Bun.resolveSync("@opentui/solid", tui))
const { createComponent } = await import(Bun.resolveSync("solid-js", tui))
const { TuiPathsProvider } = await load("./context/runtime")
const { PromptHistoryProvider, usePromptHistory } = await load("./prompt/history")
const ops = await Bun.stdin.json()

let history: { move(direction: 1 | -1, input: string): { text: string } | undefined; append(item: unknown): void }
const app = await testRender(() =>
  createComponent(TuiPathsProvider, {
    value: { cwd: state, home: state, state, worktree: state },
    get children() {
      return createComponent(PromptHistoryProvider, {
        get children() {
          history = usePromptHistory()
          return undefined
        },
      })
    },
  }),
)
await app.renderOnce()
// The provider reads the file on mount; wait until an existing file's entries are in.
const file = Bun.file(`${state}/prompt-history.jsonl`)
if ((await file.exists()) && (await file.text()).trim()) {
  let newest = history!.move(-1, "")
  for (let i = 0; i < 200 && !newest; i++) {
    await Bun.sleep(5)
    newest = history!.move(-1, "")
  }
  // Back to the end, where the ops start.
  if (newest) history!.move(1, newest.text)
}

const output: unknown[] = []
for (const op of ops) {
  if (op.move) output.push(history!.move(op.move[0], op.move[1])?.text ?? null)
  if (op.append) history!.append(op.append)
}
// Appends write asynchronously.
await Bun.sleep(50)
app.renderer.destroy()
console.log(JSON.stringify(output))
