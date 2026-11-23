// What the P-FILE helpers for the prompt's state files share (oracle/E.2-history.ts, E.3-frecency.ts,
// E.4-stash.ts): they mount one real provider on a state directory and watch its unawaited writes. Run from
// <ts-root>/packages/tui with OpenTUI's Solid preload; Solid and OpenTUI resolve as packages/tui resolves them, so
// the helper and the TUI sources share one Solid instance (no JSX here for that reason).

import { mock } from "bun:test"
import fs from "node:fs/promises"

// The provider's writes of `names` are not awaited, so their calls are counted where they run. Call it before the
// TUI modules load.
export function countWrites(names: ("writeFile" | "appendFile")[]) {
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
    ...Object.fromEntries(names.map((name) => [name, counted(fs[name] as (...args: unknown[]) => Promise<void>)])),
  }))
  return writes
}

// Renders the provider `provider` of the TUI module `module` under `TuiPathsProvider`, and returns what its hook
// `hook` gives inside it.
export async function mount<T>(
  root: string,
  module: string,
  provider: string,
  hook: string,
  paths: { cwd: string; home: string; state: string; worktree: string },
) {
  const load = (spec: string) => import(Bun.resolveSync(spec, `${root}/packages/tui/src`))
  const tui = `${root}/packages/tui`
  const { testRender } = await import(Bun.resolveSync("@opentui/solid", tui))
  const { createComponent } = await import(Bun.resolveSync("solid-js", tui))
  const { TuiPathsProvider } = await load("./context/runtime")
  const loaded = await load(module)
  let value: T | undefined
  const app = await testRender(() =>
    createComponent(TuiPathsProvider, {
      value: paths,
      get children() {
        return createComponent(loaded[provider], {
          get children() {
            value = loaded[hook]()
            return undefined
          },
        })
      },
    }),
  )
  await app.renderOnce()
  return { app, value: value as T }
}

// Waits for a condition, up to 30 s: a loaded machine can take seconds to read or write the file.
export async function until(what: string, done: () => Promise<boolean> | boolean) {
  const deadline = Date.now() + 30_000
  while (!(await done())) {
    if (Date.now() >= deadline) return console.error(`timed out waiting for ${what}`)
    await Bun.sleep(5)
  }
}
