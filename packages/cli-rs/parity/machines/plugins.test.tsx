// The shared fixture of the plugin work, TypeScript reader: the TS TUI is driven through
// the life, project, manager and viewer machines of plugins.json, with parity/plugins/life loaded as a local plugin or found in a
// project, each path on a fresh app,
// observing after every action. The Rust reader is crates/tui/tests/all/plugin_machines.rs; both read the file and
// neither reads the other. `bun run parity:machines` in packages/cli-rs covers each edge once and the seeded walks;
// `bun run parity:machines:deep` adds every path to the file's depth and the fault trials, which take a few minutes. Both
// run with parity/ as the working directory, whose bunfig.toml loads the TUI's preloads.
import { CodeRenderable, InputRenderable, type Renderable } from "@opentui/core"
import { expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { mkdir, symlink } from "node:fs/promises"
import path from "node:path"
import { createAppFixture } from "../../../tui/test/fixture/app"
import { tmpdir } from "../../../tui/test/fixture/fixture"
import { directory, json, worktree } from "../../../tui/test/fixture/tui-client"
import machines from "./plugins.json"

type Fixture = Awaited<ReturnType<typeof createAppFixture>>
type Machine = {
  initial: string
  states: Record<string, [string, Record<string, string>]>
  xfail: string[][]
  // A known row does not end the path: this client follows the machine on.
  continue?: boolean
  // The actions of a state that a reader does not send: the machine leaves their outcome open.
  unspecified?: Record<string, string[]>
}

// The full sweep: every path to the file's depth, and the fault trials.
const deep = process.env.PARITY_DEEP === "1"
// The app, and the copy of the plugin a reload rewrites.
type App = { setup: Fixture; entry: string; builds: number }

const plugin = path.join(import.meta.dir, "../plugins/life/tui.tsx")
// The views machine's distractor, beside life, whose setup fails with its own cause.
const distractor = path.join(import.meta.dir, "../plugins/other/tui.tsx")
// JSON gives each state as a mixed array; the file's shape is checked once here.
function parse(source: (typeof machines.machines)[keyof typeof machines.machines]): Machine {
  return {
    ...source,
    states: Object.fromEntries(
      Object.entries(source.states).map(([state, [observation, edges]]) => {
        if (typeof observation !== "string" || typeof edges !== "object") throw new Error(`state ${state} is malformed`)
        return [state, [observation, edges as Record<string, string>]]
      }),
    ),
  }
}
const machine = parse(machines.machines.life)
// The same plugin found in the project's plugins directory, with nothing in the config naming it.
const project = parse(machines.machines.project)
// The plugin manager's keys; every action of a state has an edge, or is one it leaves unspecified.
const managerKeys = parse(machines.machines.manager)
// The plugin manager's views, with the plugin failing as it loads; as the keys, every action has an outcome.
const managerViews = parse(machines.machines.views)
// The diff viewer's route; as the manager's keys, every action has an outcome.
const viewer = parse(machines.machines.viewer)
let runs = 0

// A fresh app with a copy of the plugin, which resolves packages/tui's dependencies (as `copyPlugin` does). In the
// config, or with `inProject` in the `.opencode/plugins` of a project the app starts in; with `fail`, its setup throws,
// and so does the distractor's beside it.
async function open(inProject = false, fail = false) {
  const root = await tmpdir()
  const repo = path.join(root.path, "repo")
  const directory = inProject ? path.join(repo, ".opencode", "plugins", "life") : path.join(root.path, "parity.life")
  const entry = path.join(directory, "tui.tsx")
  // A copy that resolves packages/tui's dependencies; a junction on Windows, which needs no privilege (as
  // `plugin-source.test.ts` links).
  const copy = async (directory: string, source: string) => {
    await mkdir(directory, { recursive: true })
    await symlink(
      path.join(import.meta.dir, "../../../tui/node_modules"),
      path.join(directory, "node_modules"),
      process.platform === "win32" ? "junction" : "dir",
    )
    await Bun.write(path.join(directory, "tui.tsx"), Bun.file(source))
  }
  if (inProject) await mkdir(path.join(repo, ".git"), { recursive: true })
  await copy(directory, plugin)
  const other = path.join(root.path, "parity.other")
  if (fail) await copy(other, distractor)
  const plugins = inProject
    ? []
    : [
        { package: directory, options: { run: ++runs, fail } },
        ...(fail ? [{ package: other, options: { fail } }] : []),
      ]
  // The app reads its plugins directories from the working directory once it runs, after the fixture returns.
  const cwd = process.cwd()
  if (inProject) process.chdir(repo)
  const setup = await (async () => {
    const setup = await createAppFixture({ width: 80, height: 24, config: { animations: false, plugins } })
    await setup.ready
    // A plugin whose setup throws draws no line: its failure shows instead.
    if (fail) await poll(setup, (frame) => frame.includes("plugins failed") || frame.includes("parity.other"), 5000)
    else await setup.waitForFrame((frame) => frame.includes("life plugin:"))
    return setup
  })().finally(() => process.chdir(cwd))
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
  // TS has no question about a project's plugin (deviation F16-project-plugin-approval): it runs at once.
  if (action === "approve" || action === "decline") return
  if (action === "leader") {
    // The leader starts a key sequence, which the line shows while it is pending.
    setup.mockInput.pressKey("x", { ctrl: true })
    await until(setup, (frame) => keys(frame) !== undefined, "the pending keys")
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

// The keys the plugin's line shows as pending, if any.
function keys(frame: string) {
  return frame.match(/life plugin: [AB][^\n]* keys (\S+)/)?.[1]
}

// line/palette/row/dialog. While its dialog shows, the palette and the manager would replace it, so the first three
// are not read; while a key sequence is pending, a key would continue it, so the line is read with its keys alone.
async function observe(setup: Fixture) {
  const frame = setup.captureCharFrame()
  const shown = dialog(frame)
  if (shown) return `?/?/?/${shown}`
  const line = ["A", "B"].find((side) => frame.includes(`life plugin: ${side}`)) ?? "-"
  const pending = keys(frame)
  if (pending) return `${line}+${pending}/?/?/-`
  const listed = (await palette(setup, "Life flip", false)) ? "yes" : "no"
  const found = await manager(setup)
  await closeManager(setup)
  const status =
    ["failed", "pending", "declined"].find((status) => found.includes(status)) ??
    (found.includes("inactive") ? "off" : "on")
  return `${line}/${listed}/${status}/-`
}

// The manager's footer offers to show or hide the built-in rows; undefined while it is closed.
function internal(frame: string) {
  return ["show", "hide"].find((word) => frame.includes(`${word} internal`))
}

// An action of the manager machine: /plugins, escape, ctrl+a, or enter on the selected row.
async function actManager(app: App, action: string) {
  const setup = app.setup
  const frame = setup.captureCharFrame()
  if (action === "open") {
    await setup.mockInput.typeText("/plugins")
    await until(setup, (frame) => frame.includes("/plugins"), "/plugins in the prompt")
    setup.mockInput.pressEnter()
    await until(setup, (frame) => internal(frame) !== undefined && row(frame) !== undefined, "the plugin manager")
    return
  }
  // With the manager closed the key goes to the empty home composer, where nothing shows a change: it is sent, and the
  // frame is read once it has settled.
  if (internal(frame) === undefined) {
    if (action === "escape") setup.mockInput.pressEscape()
    if (action === "internal") setup.mockInput.pressKey("a", { ctrl: true })
    if (action === "toggle") setup.mockInput.pressEnter()
    await poll(setup, () => false, 100)
    return
  }
  if (action === "escape") {
    setup.mockInput.pressEscape()
    await until(setup, (frame) => internal(frame) === undefined, "the plugin manager closing")
    return
  }
  if (action === "internal") {
    const before = internal(frame)
    setup.mockInput.pressKey("a", { ctrl: true })
    await until(setup, (frame) => internal(frame) !== before, "the internal rows")
    return
  }
  const before = row(frame)
  setup.mockInput.pressEnter()
  await until(setup, (frame) => row(frame) !== before, "the toggle's outcome")
}

// An action of the views machine: /plugins, life typed into the filter, the key the footer offers for view error, or
// escape.
async function actViews(app: App, action: string) {
  const setup = app.setup
  const frame = setup.captureCharFrame()
  if (action === "open") {
    await setup.mockInput.typeText("/plugins")
    await until(setup, (frame) => frame.includes("/plugins"), "/plugins in the prompt")
    setup.mockInput.pressEnter()
    await until(setup, (frame) => internal(frame) !== undefined, "the plugin manager")
    await focusedInput(setup)
    return
  }
  if (action === "filter") {
    await setup.mockInput.typeText("parity.other")
    await until(setup, (frame) => !frame.includes("Search"), "the filter")
    return
  }
  if (action === "down") {
    setup.mockInput.pressArrow("down")
    await setup.renderOnce()
    return
  }
  if (action === "details") {
    if (frame.includes("view error space")) setup.mockInput.pressKey(" ")
    else setup.mockInput.pressEnter()
    await until(setup, (frame) => frame.includes("TUI plugin error"), "the details")
    return
  }
  setup.mockInput.pressEscape()
  if (frame.includes("TUI plugin error")) {
    await until(setup, (frame) => internal(frame) !== undefined, "the list again")
    await focusedInput(setup)
    return
  }
  // With the manager closed the key goes to the empty home composer, where nothing shows a change.
  if (internal(frame) === undefined) return void (await poll(setup, () => false, 100))
  await until(setup, (frame) => internal(frame) === undefined, "the plugin manager closing")
}

// dialog/a/b, as plugins.json writes them for the views machine: the query and the rows of the list, or the plugin
// whose source and the plugin whose cause the details show.
function observeViews(setup: Fixture) {
  const frame = setup.captureCharFrame()
  const lines = frame.split("\n")
  if (frame.includes("TUI plugin error")) {
    // The source, on the row under the title: the plugin's directory. A toast may name other plugins.
    const title = lines.findIndex((line) => line.includes("TUI plugin error"))
    const plugin = (lines[title + 1] ?? "").match(/parity\.([a-z]+)/)?.[1] ?? "?"
    const [life, other] = [frame.includes("life setup"), frame.includes("other setup")]
    return `error/${plugin}/${life && !other ? "life" : other && !life ? "other" : "?"}`
  }
  if (internal(frame) === undefined) return "-/?/?"
  // The filter's field is two rows under the title's.
  const title = lines.findIndex((line) => line.includes("Plugins") && line.includes("esc"))
  const query = title < 0 ? "?" : (lines[title + 2] ?? "").trim()
  const rows = lines
    .filter((line) => line.includes("parity.") && line.includes("local"))
    .map((line) => {
      const name = line.match(/parity\.([a-z]+)/)?.[1] ?? "?"
      const status = line.includes("failed") ? "failed" : line.includes("inactive") ? "off" : "on"
      return `${name}:${status}`
    })
  return `list/${query === "Search" ? "-" : query}/${rows.join("+")}`
}

// dialog/internal/life, as plugins.json writes them for the manager machine.
function observeManager(setup: Fixture) {
  const frame = setup.captureCharFrame()
  const shown = internal(frame)
  if (!shown) return `-/?/${frame.includes("life plugin:") ? "on" : "off"}`
  // The built-in rows may push the life row below the screen.
  if (shown === "hide") return "list/hide/?"
  const found = row(frame)
  return `list/${shown}/${found === undefined ? "none" : found.includes("inactive") ? "off" : "on"}`
}

// The diff viewer's files: a.ts and b.ts, one changed line each, which fit on one screen.
function diffFile(name: string) {
  return {
    file: `${name}.ts`,
    patch: `@@ -1 +1 @@\n-old ${name}\n+new ${name}\n`,
    additions: 1,
    deletions: 1,
    status: "modified",
  }
}

// A fresh app on home at 120 by 30 cells whose server lists the two files' diff.
async function openViewer() {
  const location = { directory, project: { id: "proj_test", directory: worktree, canonical: worktree } }
  const setup = await createAppFixture({
    width: 120,
    height: 30,
    config: { animations: false, diffs: { source: "working" } },
    fetch: (url) =>
      url.pathname === "/api/vcs/diff" ? json({ location, data: [diffFile("a"), diffFile("b")] }) : undefined,
  })
  await setup.ready
  await until(setup, (frame) => frame.includes("Ask anything"), "home")
  return {
    setup,
    // A highlight still in flight when the renderer goes is rejected, and OpenTUI warns about it with a stack trace.
    async [Symbol.asyncDispose]() {
      await highlighted(setup.renderer.root)
      await setup[Symbol.asyncDispose]()
    },
  }
}

// Waits for every code block under `node` to finish highlighting.
async function highlighted(node: Renderable): Promise<void> {
  if (node instanceof CodeRenderable) await node.highlightingDone
  await Promise.all(node.getChildren().map(highlighted))
}

// Draws until three frames in a row are the same.
async function settled(setup: Fixture) {
  let [last, same] = ["", 0]
  for (let tries = 0; tries < 200 && same < 3; tries++) {
    await setup.renderOnce()
    const frame = setup.captureCharFrame()
    same = frame === last ? same + 1 : 0
    last = frame
    await Bun.sleep(10)
  }
}

// An action of the viewer machine: /diff and enter, q, m or s.
async function actViewer(setup: Fixture, action: string) {
  if (action === "open") {
    await setup.mockInput.typeText("/diff")
    await until(setup, (frame) => frame.includes("/diff"), "/diff in the prompt")
    setup.mockInput.pressEnter()
    await until(setup, (frame) => frame.includes("≡ a.ts"), "the diff viewer")
  } else setup.mockInput.pressKey({ close: "q", review: "m", single: "s" }[action]!)
  await settled(setup)
}

// screen/reviewed/shown, as plugins.json writes them for the viewer machine: the tree is the first 30 columns.
function observeViewer(setup: Fixture) {
  const frame = setup.captureCharFrame()
  if (!frame.includes("≡ a.ts")) return "-/?/?"
  let [reviewed, shown] = ["", ""]
  for (const line of frame.split("\n")) {
    const cells = Array.from(line)
    const [tree, pane] = [cells.slice(0, 30).join(""), cells.slice(30).join("")]
    for (const name of ["a", "b"]) {
      if (tree.includes(`≡ ${name}.ts`) && tree.trimEnd().endsWith("✓")) reviewed += name
      if (pane.includes(`${name}.ts`)) shown += name
    }
  }
  return `diff/${reviewed || "-"}/${shown}`
}

// Replays `path` of the viewer machine on a fresh app, sending every action but those a state leaves unspecified.
async function replayViewer(path: string[], known: Set<string>, seen: Set<string>) {
  await using app = await openViewer()
  let state = viewer.initial
  for (const [index, action] of ["mount", ...path].entries()) {
    const edge = viewer.states[state][1][action]
    const next = index === 0 ? state : (edge ?? state)
    if (index > 0 && edge !== undefined) await actViewer(app.setup, action)
    if (index > 0 && edge === undefined && !viewer.unspecified?.[state]?.includes(action))
      throw new Error(`the viewer machine names no outcome of ${action} in ${state}`)
    const [expected, actual] = [viewer.states[next][0], observeViewer(app.setup)]
    if (actual !== expected) {
      const key = `${state} ${action} ${actual}`
      if (known.has(key)) return void seen.add(key)
      return `${path.slice(0, index).join(" ")}: ${state} + ${action}: expected ${expected}, got ${actual}`
    }
    state = next
  }
  return undefined
}

// Replays `path` of `machine` on a fresh app. An action a state has no edge for does nothing; the manager machine names
// an outcome for each, and its reader sends every action but those it lists as unspecified. The first difference that
// is not a known row, or undefined; a known row ends the path, unless the machine says to follow it on.
async function replay(machine: Machine, path: string[], known: Set<string>, seen: Set<string>) {
  if (machine === viewer) return replayViewer(path, known, seen)
  await using app = await open(machine === project, machine === managerViews)
  const views = machine === managerViews
  const keyed = machine === managerKeys || views
  let state = machine.initial
  for (const [index, action] of ["mount", ...path].entries()) {
    const edge = machine.states[state][1][action]
    const next = index === 0 ? state : (edge ?? state)
    if (index > 0 && !keyed) await act(app, action)
    if (index > 0 && views && edge !== undefined) await actViews(app, action)
    if (index > 0 && keyed && !views && edge !== undefined) await actManager(app, action)
    if (index > 0 && keyed && edge === undefined && !machine.unspecified?.[state]?.includes(action))
      throw new Error(`the manager machine names no outcome of ${action} in ${state}`)
    const observed = views ? observeViews(app.setup) : keyed ? observeManager(app.setup) : await observe(app.setup)
    const [expected, actual] = [machine.states[next][0], observed]
    if (actual !== expected) {
      const key = `${state} ${action} ${actual}`
      if (known.has(key)) {
        seen.add(key)
        if (!machine.continue) return undefined
        state = next
        continue
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

// Each edge of `machine` once: the shortest path to its state, then its action.
function cover(machine: Machine) {
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

// Every path of `machine` from its initial state to the file's depth.
function paths(machine: Machine, state = machine.initial, path: string[] = []): string[][] {
  const edges = Object.entries(machine.states[state][1])
  if (path.length === machines.depth || edges.length === 0) return [path]
  return edges.flatMap(([action, next]) => paths(machine, next, [...path, action]))
}

// The file's seeded walks, as OpenTUI's reader makes them.
function walks(machine: Machine) {
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
function faulted(name: "life" | "manager" | "views" | "viewer") {
  const cycles = machines.faults[name].cycles.map((cycle) => cycle.split(" "))
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

async function check(paths: string[][], rows: Set<string>, from = machine) {
  const seen = new Set<string>()
  const failures: string[] = []
  for (const path of paths) {
    const failure = await replay(from, path, rows, seen)
    if (failure) failures.push(failure)
  }
  expect(failures).toEqual([])
  return seen
}

// The budgets name the work, each path on a fresh app: 37 edges or 323 paths of up to 4 actions, 8 walks of 12, and
// the fault trials. Every edge is on some path, so either set meets every known row.
test("the plugin life follows the shared fixture", async () => {
  const rows = known(machine.xfail)
  const seen = await check(deep ? paths(machine) : cover(machine), rows)
  expect([...rows].filter((row) => !seen.has(row))).toEqual([])
}, 600_000)

// A plugin in the project's plugins directory: TS loads it at once and has no question about it, as the file says
// (Rust lists it pending, then declined or approved: deviation F16-project-plugin-approval).
test("a project plugin follows the shared fixture", async () => {
  const rows = known(project.xfail)
  const seen = await check(deep ? paths(project) : cover(project), rows, project)
  expect([...rows].filter((row) => !seen.has(row))).toEqual([])
}, 600_000)

test("the plugin life follows the shared fixture on walks", async () => {
  await check(walks(machine), known(machine.xfail))
}, 600_000)

test.if(deep)(
  "the plugin life recovers from a dropped, repeated or swapped action",
  async () => {
    await check(faulted("life"), known(machine.xfail, machines.faults.life.xfail))
  },
  600_000,
)

test("the plugin manager's keys follow the shared fixture", async () => {
  const rows = known(managerKeys.xfail)
  const seen = await check(deep ? paths(managerKeys) : cover(managerKeys), rows, managerKeys)
  expect([...rows].filter((row) => !seen.has(row))).toEqual([])
}, 600_000)

test("the plugin manager's keys follow the shared fixture on walks", async () => {
  await check(walks(managerKeys), known(managerKeys.xfail), managerKeys)
}, 600_000)

test.if(deep)(
  "the plugin manager's keys recover from a dropped, repeated or swapped action",
  async () => {
    await check(faulted("manager"), known(managerKeys.xfail, machines.faults.manager.xfail), managerKeys)
  },
  600_000,
)

test("the plugin manager's views follow the shared fixture", async () => {
  const rows = known(managerViews.xfail)
  const seen = await check(deep ? paths(managerViews) : cover(managerViews), rows, managerViews)
  expect([...rows].filter((row) => !seen.has(row))).toEqual([])
}, 600_000)

test("the plugin manager's views follow the shared fixture on walks", async () => {
  await check(walks(managerViews), known(managerViews.xfail), managerViews)
}, 600_000)

test.if(deep)(
  "the plugin manager's views recover from a dropped, repeated or swapped action",
  async () => {
    await check(faulted("views"), known(managerViews.xfail, machines.faults.views.xfail), managerViews)
  },
  600_000,
)

test("the diff viewer follows the shared fixture", async () => {
  const rows = known(viewer.xfail)
  const seen = await check(deep ? paths(viewer) : cover(viewer), rows, viewer)
  expect([...rows].filter((row) => !seen.has(row))).toEqual([])
}, 600_000)

test("the diff viewer follows the shared fixture on walks", async () => {
  await check(walks(viewer), known(viewer.xfail), viewer)
}, 600_000)

test.if(deep)(
  "the diff viewer recovers from a dropped, repeated or swapped action",
  async () => {
    await check(faulted("viewer"), known(viewer.xfail, machines.faults.viewer.xfail), viewer)
  },
  600_000,
)
