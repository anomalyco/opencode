// P-FILE helper for E.3, driven by crates/tui/tests/complete.rs. Run it from <ts-root>/packages/tui with
// OpenTUI's Solid preload, as E.2-history.ts runs.
//
//   bun E.3-frecency.ts <ts-root> <state> <cwd>    stdin: [path]; the real FrecencyProvider on <state>
//
// The provider loads <state>/frecency.jsonl on mount, which rewrites it as TypeScript keeps it. Each path is
// then opened once (`updateFrecency`). Prints the frequencies by absolute path, after the updates.

const [root, state, cwd] = process.argv.slice(2)
if (!root || !state || !cwd) throw new Error("usage: E.3-frecency.ts <ts-root> <state> <cwd>")

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
// The provider reads the file on mount; wait until an existing file's entries are in.
const file = Bun.file(`${state}/frecency.jsonl`)
if ((await file.exists()) && (await file.text()).trim()) {
  for (let i = 0; i < 200 && Object.keys(frecency!.data()).length === 0; i++) await Bun.sleep(5)
}
for (const path of paths) frecency!.updateFrecency(path)
// Appends write asynchronously.
await Bun.sleep(50)
app.renderer.destroy()
console.log(
  JSON.stringify(Object.fromEntries(Object.entries(frecency!.data()).map(([path, entry]) => [path, entry.frequency]))),
)
