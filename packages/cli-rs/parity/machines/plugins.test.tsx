// The shared fixture of the plugin work (rich-plugins 4.14, O-124), TypeScript reader: the TS TUI is driven through
// the life machine of plugins.json, with parity/plugins/life loaded as a local plugin, each path on a fresh app,
// observing after every action. The Rust reader is crates/tui/tests/all/plugin_machines.rs; both read the file and
// neither reads the other. `bun run test` in packages/cli-rs, which CI runs, covers each edge once and the seeded walks;
// `bun run parity:machines` adds every path to the file's depth and the fault trials, which take a few minutes. Both
// run with parity/ as the working directory, whose bunfig.toml loads the TUI's preloads.
import { InputRenderable } from "@opentui/core"
import { expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { mkdir, symlink } from "node:fs/promises"
import path from "node:path"
import { createAppFixture } from "../../../tui/test/fixture/app"
import { tmpdir } from "../../../tui/test/fixture/fixture"
import machines from "./plugins.json"

type Fixture = Awaited<ReturnType<typeof createAppFixture>>
type Machine = { initial: string; states: Record<string, [string, Record<string, string>]>; xfail: string[][] }

// The full sweep: every path to the file's depth, and the fault trials.
const deep = process.env.PARITY_DEEP === "1"
// The app, and the copy of the plugin a reload rewrites.
type App = { setup: Fixture; entry: string; builds: number }

const plugin = path.join(import.meta.dir, "../plugins/life/tui.tsx")
// JSON gives each state as a mixed array; the file's shape is checked once here.
const machine: Machine = {
  ...machines.machines.life,
  states: Object.fromEntries(
    Object.entries(machines.machines.life.states).map(([state, [observation, edges]]) => {
      if (typeof observation !== "string" || typeof edges !== "object") throw new Error(`state ${state} is malformed`)
      return [state, [observation, edges as Record<string, string>]]
    }),
  ),
}
let runs = 0

// A fresh app with a copy of the plugin, which resolves packages/tui's dependencies (as `copyPlugin` does).
async function open() {
  const root = await tmpdir()
  const directory = path.join(root.path, "life")
  const entry = path.join(directory, "tui.tsx")
  await mkdir(directory)
  // A junction on Windows, which needs no privilege (as `plugin-source.test.ts` links).
  await symlink(
    path.join(import.meta.dir, "../../../tui/node_modules"),
    path.join(directory, "node_modules"),
    process.platform === "win32" ? "junction" : "dir",
  )
  await Bun.write(entry, Bun.file(plugin))
  const setup = await createAppFixture({
    width: 80,
    height: 24,
    config: { animations: false, plugins: [{ package: directory, options: { run: ++runs } }] },
  })
  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("life plugin:"))
  return {
    setup,
    entry,
    builds: 1,
    async [Symbol.asyncDispose]() {
      await setup[Symbol.asyncDispose]()
      await root[Symbol.asyncDispose]()
    },
  }
}

// A wall-clock wait on the frame, as `command-selection.test.tsx` polls: the plugin manager and the palette load
// and filter on their own timers. Undefined once `ms` passed.
async function poll(setup: Fixture, matches: (frame: string) => boolean, ms: number) {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    await setup.renderOnce()
    if (matches(setup.captureCharFrame())) return setup.captureCharFrame()
    await Bun.sleep(10)
  }
  return undefined
}

async function until(setup: Fixture, matches: (frame: string) => boolean, what: string) {
  const frame = await poll(setup, matches, 5000)
  if (frame === undefined) throw new Error(`${what} never showed:\n${setup.captureCharFrame()}`)
  return frame
}

async function focusedInput(setup: Fixture) {
  await setup.waitFor(() => setup.renderer.currentFocusedEditor instanceof InputRenderable)
}

// Searches the palette for `title`, runs it if `run` asks and it is listed, and returns whether it is.
async function palette(setup: Fixture, title: string, run: boolean) {
  setup.mockInput.pressKey("p", { ctrl: true })
  await until(setup, (frame) => frame.includes("Commands"), "the palette")
  await focusedInput(setup)
  await setup.mockInput.typeText(title)
  // The filter shows the title too, so a listed command shows it twice.
  const frame = await until(
    setup,
    (frame) => frame.split(title).length - 1 >= 2 || frame.includes("No results found"),
    `the palette's search for ${title}`,
  )
  const listed = frame.split(title).length - 1 >= 2
  if (listed && run) setup.mockInput.pressEnter()
  else setup.mockInput.pressEscape()
  await until(setup, (frame) => !frame.includes("Commands"), "the palette closing")
  return listed
}

function row(frame: string) {
  return frame.split("\n").find((line) => line.includes("parity.life") && !line.includes("Plugin failed"))
}

// Opens the plugin manager filtered to the life plugin; returns its row.
async function manager(setup: Fixture) {
  await setup.mockInput.typeText("/plugins")
  await until(setup, (frame) => frame.includes("/plugins"), "/plugins in the prompt")
  setup.mockInput.pressEnter()
  await until(setup, (frame) => row(frame) !== undefined, "the life plugin's row")
  await focusedInput(setup)
  await setup.mockInput.typeText("life")
  return row(await until(setup, (frame) => row(frame) !== undefined, "the filtered row"))!
}

async function closeManager(setup: Fixture) {
  setup.mockInput.pressEscape()
  await until(setup, (frame) => row(frame) === undefined, "the plugin manager closing")
}

async function act(app: App, action: string) {
  const setup = app.setup
  if (action === "toggle") {
    const before = await manager(setup)
    setup.mockInput.pressEnter()
    // An enable whose setup throws leaves the row as it was and shows the error in a toast; one or the other shows.
    await until(setup, (frame) => row(frame) !== before || frame.includes("armed to throw"), "the toggle's outcome")
    await closeManager(setup)
    return
  }
  if (action === "escape" || action === "enter") {
    if (action === "escape") setup.mockInput.pressEscape()
    else setup.mockInput.pressEnter()
    await until(setup, (frame) => dialog(frame) === undefined, "the dialog closing")
    // The answer's promise flips the line after the close.
    await setup.renderOnce()
    return
  }
  if (action === "reload") {
    // A new build in place; the watcher reconciles. The line names the build, also under a dialog.
    const source = await Bun.file(app.entry).text()
    await Bun.write(app.entry, source.replace(/const build = \d+/, `const build = ${++app.builds}`))
    await until(setup, (frame) => frame.includes(`build ${app.builds}`), `build ${app.builds}`)
    return
  }
  await palette(setup, `Life ${action}`, true)
  await setup.renderOnce()
}

// The plugin's dialog on screen, by its title.
function dialog(frame: string) {
  const dialogs = [
    ["Life prompt", "prompt"],
    ["Life asks", "confirm"],
    ["Life says", "alert"],
  ]
  return dialogs.find(([title]) => frame.includes(title))?.[1]
}

// line/palette/row/dialog. While its dialog shows, the palette and the manager would replace it, so the first three
// are not read.
async function observe(setup: Fixture) {
  const frame = setup.captureCharFrame()
  const shown = dialog(frame)
  if (shown) return `?/?/?/${shown}`
  const line = ["A", "B"].find((side) => frame.includes(`life plugin: ${side}`)) ?? "-"
  const listed = (await palette(setup, "Life flip", false)) ? "yes" : "no"
  const found = await manager(setup)
  await closeManager(setup)
  const status = found.includes("failed") ? "failed" : found.includes("inactive") ? "off" : "on"
  return `${line}/${listed}/${status}/-`
}

// Replays `path` on a fresh app. An action a state has no edge for does nothing. The first difference that is not a
// known row, or undefined; a known row ends the path.
async function replay(path: string[], known: Set<string>, seen: Set<string>) {
  await using app = await open()
  let state = machine.initial
  for (const [index, action] of ["mount", ...path].entries()) {
    const next = index === 0 ? state : (machine.states[state][1][action] ?? state)
    if (index > 0) await act(app, action)
    const [expected, actual] = [machine.states[next][0], await observe(app.setup)]
    if (actual !== expected) {
      const key = `${state} ${action} ${actual}`
      if (known.has(key)) {
        seen.add(key)
        return undefined
      }
      return `${[...path.slice(0, index)].join(" ")}: ${state} + ${action}: expected ${expected}, got ${actual}`
    }
    state = next
  }
  return undefined
}

// This client's known differences among `rows`, each naming a deviation file or an open finding.
function known(...rows: string[][][]) {
  const ours = rows.flat().filter((row) => row[0] === "ts")
  for (const [, file] of ours)
    if (!file.startsWith("finding:") && !existsSync(path.join(import.meta.dir, `../deviations/${file}.md`)))
      throw new Error(`xfail row names no deviation file: ${file}`)
  return new Set(ours.map((row) => row[2]))
}

// Each edge once: the shortest path to its state, then its action.
function cover() {
  const reach = new Map<string, string[]>([[machine.initial, []]])
  const queue = [machine.initial]
  for (const state of queue)
    for (const [action, next] of Object.entries(machine.states[state][1]))
      if (!reach.has(next)) {
        reach.set(next, [...reach.get(state)!, action])
        queue.push(next)
      }
  return [...reach].flatMap(([state, path]) => Object.keys(machine.states[state][1]).map((action) => [...path, action]))
}

// Every path from the initial state to the file's depth.
function paths(state = machine.initial, path: string[] = []): string[][] {
  const edges = Object.entries(machine.states[state][1])
  if (path.length === machines.depth || edges.length === 0) return [path]
  return edges.flatMap(([action, next]) => paths(next, [...path, action]))
}

// The file's seeded walks, as OpenTUI's reader makes them.
function walks() {
  const out: string[][] = []
  for (let seed = 0; seed < machines.seeds; seed++) {
    let [state, n, walk] = [machine.initial, seed, [] as string[]]
    for (let step = 0; step < machines.steps; step++) {
      const keys = Object.keys(machine.states[state][1]).sort()
      n = (Math.imul(n, 1664525) + 1013904223) >>> 0
      const action = keys[(n >>> 16) % keys.length]
      walk.push(action)
      state = machine.states[state][1][action]
    }
    out.push(walk)
  }
  return out
}

// Two normal cycles, each with one action dropped, repeated, or swapped with the next.
function faulted() {
  const cycles = machines.faults.life.cycles.map((cycle) => cycle.split(" "))
  const out = new Map<string, string[]>()
  for (const a of cycles)
    for (const b of cycles) {
      const normal = [...a, ...b]
      for (let i = 0; i < normal.length; i++) {
        const variants = [normal.toSpliced(i, 1), normal.toSpliced(i, 0, normal[i])]
        if (i + 1 < normal.length) variants.push(normal.toSpliced(i, 2, normal[i + 1], normal[i]))
        for (const variant of variants) out.set(variant.join(" "), variant)
      }
    }
  return [...out.values()]
}

async function check(paths: string[][], rows: Set<string>) {
  const seen = new Set<string>()
  const failures: string[] = []
  for (const path of paths) {
    const failure = await replay(path, rows, seen)
    if (failure) failures.push(failure)
  }
  expect(failures).toEqual([])
  return seen
}

// The budgets name the work, each path on a fresh app: 37 edges or 323 paths of up to 4 actions, 8 walks of 12, and
// the fault trials. Every edge is on some path, so either set meets every known row.
test("the plugin life follows the shared fixture", async () => {
  const rows = known(machine.xfail)
  const seen = await check(deep ? paths() : cover(), rows)
  expect([...rows].filter((row) => !seen.has(row))).toEqual([])
}, 600_000)

test("the plugin life follows the shared fixture on walks", async () => {
  await check(walks(), known(machine.xfail))
}, 600_000)

test.if(deep)("the plugin life recovers from a dropped, repeated or swapped action", async () => {
  await check(faulted(), known(machine.xfail, machines.faults.life.xfail))
}, 600_000)
