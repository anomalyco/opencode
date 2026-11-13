// The shared fixture of the plugin work (rich-plugins 4.14, O-124), TypeScript reader: the TS TUI is driven through
// the life machine of plugins.json, with parity/plugins/life loaded as a local plugin, each path on a fresh app,
// observing after every action. The Rust reader is crates/tui/tests/all/plugin_machines.rs; both read the file and
// neither reads the other. Run it from packages/cli-rs: `bun test parity/machines`. It takes about two minutes, so
// it is not part of packages/tui's suite.
import { InputRenderable } from "@opentui/core"
import { expect, test } from "bun:test"
import path from "node:path"
import { createAppFixture } from "../../../tui/test/fixture/app"
import machines from "./plugins.json"

type Fixture = Awaited<ReturnType<typeof createAppFixture>>
type Machine = { initial: string; states: Record<string, [string, Record<string, string>]>; xfail: string[][] }

const plugin = path.join(import.meta.dir, "../plugins/life")
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

async function open() {
  const setup = await createAppFixture({
    width: 80,
    height: 24,
    config: { animations: false, plugins: [{ package: plugin, options: { run: ++runs } }] },
  })
  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("life plugin:"))
  return setup
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

async function act(setup: Fixture, action: string) {
  if (action === "toggle") {
    const before = await manager(setup)
    setup.mockInput.pressEnter()
    // An enable whose setup throws leaves the row as it was and shows the error in a toast.
    await poll(setup, (frame) => row(frame) !== before || frame.includes("armed to throw"), 2000)
    await closeManager(setup)
    return
  }
  await palette(setup, `Life ${action}`, true)
  await setup.renderOnce()
}

async function observe(setup: Fixture) {
  const frame = setup.captureCharFrame()
  const line = ["A", "B"].find((side) => frame.includes(`life plugin: ${side}`)) ?? "-"
  const listed = (await palette(setup, "Life flip", false)) ? "yes" : "no"
  const found = await manager(setup)
  await closeManager(setup)
  const status = found.includes("failed") ? "failed" : found.includes("inactive") ? "off" : "on"
  return `${line}/${listed}/${status}`
}

// Replays `path` on a fresh app. An action a state has no edge for does nothing. The first difference that is not a
// known row, or undefined; a known row ends the path.
async function replay(path: string[], known: Set<string>, seen: Set<string>) {
  await using setup = await open()
  let state = machine.initial
  for (const [index, action] of ["mount", ...path].entries()) {
    const next = index === 0 ? state : (machine.states[state][1][action] ?? state)
    if (index > 0) await act(setup, action)
    const [expected, actual] = [machine.states[next][0], await observe(setup)]
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

function known() {
  return new Set(machine.xfail.filter((row) => row[0] === "ts").map((row) => row[2]))
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

async function check(paths: string[][]) {
  const [rows, seen] = [known(), new Set<string>()]
  const failures: string[] = []
  for (const path of paths) {
    const failure = await replay(path, rows, seen)
    if (failure) failures.push(failure)
  }
  expect(failures).toEqual([])
  return seen
}

// The budgets name the work: 73 paths of up to 4 actions, 8 walks of 12, and the fault trials, each on a fresh app.
test("the plugin life follows the shared fixture", async () => {
  const seen = await check(paths())
  expect([...known()].filter((row) => !seen.has(row))).toEqual([])
}, 600_000)

test("the plugin life follows the shared fixture on walks", async () => {
  await check(walks())
}, 600_000)

test("the plugin life recovers from a dropped, repeated or swapped action", async () => {
  await check(faulted())
}, 600_000)
