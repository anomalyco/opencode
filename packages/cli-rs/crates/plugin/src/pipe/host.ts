// The JS host of opencode-native's pipe carrier (rich-plugins synthesis 3.7 and 4.3, phase P7). One Bun process runs
// every TypeScript TUI plugin and speaks contract 2.0 with the client over its standard streams: frames of a length
// (u32, little-endian), a kind byte (0 control, 1 tree) and JSON. The client embeds this file and runs it; it is not a
// module plugins import.
//
// What it gives a plugin is a `{ id, setup }` module's setup context: the V2 TUI context of the compatibility layer
// (P8, `compat/`, bundled as `compat.js`), whose slots, routes and dialogs render the plugin's JSX into contract trees,
// and under `Symbol.for("opencode.carrier")` the carrier that layer is built on: surfaces whose views return contract
// trees, effects, and reads the host pushes as snapshots. The modules a plugin imports from the TS client
// (`@opencode/plugin/tui`, Solid, `@opentui/solid`, `@opentui/core`) are the layer's.
//
// The rules it keeps:
// - Standard output is the protocol. Before any plugin loads, `console` and `process.stdout` write to standard error.
// - Every host message with a sequence is acknowledged on receipt, apart from the work it asks for. A sequence seen
//   again is dropped; one that skips or goes back breaks the stream, and the process exits.
// - A handler's effects are its call's: a handler that throws has none, and its plugin is called no more.
// - A mount has at most one tree in flight: the next waits until the host adopted or refused the last.
// - The process exits when its input ends, or when the client that started it is gone, even while a plugin spins.

import path from "node:path"
import { Console } from "node:console"
import { existsSync, readFileSync, realpathSync, writeSync } from "node:fs"
import { pathToFileURL } from "node:url"
import { plugin as runtime } from "bun"
import { context as compat, modules, reported } from "./compat.js"

const MAGIC = "opencode-js-host"
const VERSION = 1
const CONTROL = 0
const TREE = 1

// Standard output is the protocol's alone (review F4): every method of `console` (`dir` and `table` too, which Bun's
// own console writes to standard output directly) and the whole `process.stdout` stream, also for a library that
// holds on to it or waits for its callback, write to standard error.
const stderr = (text: string) => process.stderr.write(text.endsWith("\n") ? text : text + "\n")
globalThis.console = new Console(process.stderr, process.stderr)
process.stdout.write = ((chunk: unknown, encoding?: unknown, callback?: unknown) =>
  (process.stderr.write as Function)(chunk, encoding, callback)) as typeof process.stdout.write

// The modules a V2 plugin imports from the TS client are the compatibility layer's, also from a package's own
// `node_modules`, as the TS client's runtime plugin support gives its own (P8). Virtual modules, since Bun resolves the
// JSX runtime a `@jsxImportSource` pragma names without a plugin's `onResolve`.
runtime({
  name: "opencode-compat",
  setup(build) {
    for (const [name, exports] of Object.entries(modules))
      build.module(name, () => ({ exports, loader: "object" }))
  },
})

// Frames go out with blocking writes (review carbon-5): a client that reads nothing stops the JS host in its write,
// which is the pipe's back-pressure, rather than letting it buffer without bound; and no frame is cut at exit.
function write(bytes: Buffer) {
  let at = 0
  while (at < bytes.length) {
    try {
      at += writeSync(1, bytes, at)
    } catch (error) {
      if ((error as { code?: string }).code !== "EAGAIN") throw error
    }
  }
}

// `OPENCODE_JS_HOST_TRACE=<file>` appends every frame the JS host reads and writes to the file, cut at 2,000
// characters: a diagnosis of the protocol, off by default.
const TRACE = process.env.OPENCODE_JS_HOST_TRACE
function trace(line: string) {
  if (TRACE) require("node:fs").appendFileSync(TRACE, line.slice(0, 2000) + "\n")
}

// Throws when `message` cannot be JSON (a `BigInt`, a cycle): nothing of it is written.
function frame(kind: number, message: unknown) {
  const body = Buffer.from(JSON.stringify(message))
  trace(`up ${body.toString()}`)
  const head = Buffer.alloc(5)
  head.writeUInt32LE(body.length, 0)
  head[4] = kind
  write(Buffer.concat([head, body]))
}
const send = (message: unknown) => frame(CONTROL, message)

// The JS host takes everything its plugins started down with it, however the client ends (review: no orphans). The
// client makes it a child subreaper on Linux, so a descendant whose parent exited becomes its child rather than
// escaping; this kills every descendant it finds in `/proc` (one that left the process group too), then the group,
// itself last. Elsewhere there is no `/proc`: the group alone. It runs when the input ends, on the parent-death signal
// the client asks for on Linux (SIGTERM), and from a thread of its own that watches the parent, so a plugin that
// spins on the main thread cannot hold it back.
function killAll(me: number) {
  const fs = require("node:fs")
  const descendants = () => {
    if (!fs.existsSync("/proc/self/stat")) return []
    const children = new Map<number, number[]>()
    for (const name of fs.readdirSync("/proc")) {
      if (!/^[0-9]+$/.test(name)) continue
      try {
        const stat = fs.readFileSync(`/proc/${name}/stat`, "utf8")
        const ppid = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1])
        children.set(ppid, [...(children.get(ppid) ?? []), Number(name)])
      } catch {}
    }
    const found: number[] = []
    for (const queue = [me]; queue.length; ) {
      for (const pid of children.get(queue.shift()!) ?? []) found.push(pid), queue.push(pid)
    }
    return found
  }
  // A descendant may fork as it is killed: again until none is left.
  for (let round = 0; round < 8; round++) {
    const found = descendants()
    if (!found.length) break
    for (const pid of found) {
      try {
        process.kill(pid, "SIGKILL")
      } catch {}
    }
  }
  try {
    process.kill(-me, "SIGKILL")
  } catch {}
  process.kill(me, "SIGKILL")
}
process.on("SIGTERM", () => killAll(process.pid))
const parent = process.ppid
const orphan = `${killAll.toString()}
const parentOf = () => {
  try {
    const stat = require("node:fs").readFileSync("/proc/self/stat", "utf8")
    return Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1])
  } catch {
    return ${parent}
  }
}
setInterval(() => {
  let gone = parentOf() !== ${parent}
  try {
    process.kill(${parent}, 0)
  } catch {
    gone = true
  }
  if (gone) killAll(${process.pid})
}, 100)`
new Worker(URL.createObjectURL(new Blob([orphan], { type: "application/javascript" }))).unref()

type Json = any
type Request = { type: string; [field: string]: Json }

interface Command {
  name: string
  // How many times it is registered.
  count: number
  title: string
  run: (input?: string) => unknown
  hold: boolean
  wire: Json
}

interface Surface {
  name: string
  place: Json
  palette: boolean
  notify: Json[]
  // P2: the mount's handler (its keys, pointer, scroll and input events) and the key layers each mount registers.
  on?: (event: Json) => unknown
  layers: Json[]
  // P6a: the handler hears each mount begin and end (a "mount" event).
  mounts: boolean
  // A view that returns `undefined` has no tree yet: it views again when a snapshot comes (P8).
  view: (cx: ViewContext) => Json
  // P8: a mount of it ended.
  unmount?: (mount: Json) => void
}

interface ViewContext {
  readonly input: Json
  readonly mount: Json
  memo(key: string, value: unknown, build: () => Json): Json
  content(bytes: string | Uint8Array): number
  release(handle: number): void
}

interface Mount {
  id: Json
  key: string
  surface: number
  input: Json
  epoch: number
  rev: number
  adopted: number
  inflight: boolean
  dirty: boolean
  whole: boolean
  last?: string
  // The memo values of the adopted tree, and of the one in flight.
  memo: Map<string, string>
  staged?: Map<string, string>
  // The memos within each memo's subtree, of the adopted tree and of the one in flight.
  nested: Map<string, string[]>
  stagedNested?: Map<string, string[]>
  next: number
  given: Array<[number, Json]>
  released: number[]
}

interface Plugin {
  id: string
  target: string
  dir: string
  options: Json
  definition: { id: string; setup: (context: Json) => unknown }
  active: boolean
  failed: boolean
  setting: boolean
  activation: number
  setupEffects: Request[]
  // What setup watches, told after it was answered, as the host knows the plugin from then on.
  setupWatches: Json[]
  callEffects?: Request[]
  // Who waits for the answer of each effect of the call or setup that runs.
  resolvers: Array<(value: Json) => void>
  commands: Command[]
  storage: string[]
  // P8: a subscription of `data.on` names its type, whose handlers `listening` holds.
  events: Array<{ types: string[]; handler: (event: Json) => unknown; listens?: string }>
  listening: Record<string, Array<(event: Json) => unknown>>
  // P2: the key layers of setup, each with its handler.
  layers: Array<{ layer: Json; handler: (event: Json) => unknown }>
  surfaces: Surface[]
  cleanups: Array<() => unknown>
  mounts: Map<string, Mount>
  snapshots: Map<string, Json>
  readErrors: Map<string, string>
  answers: Map<string, Array<(value: Json) => void>>
  replies: Map<number, (result: Json) => void>
  batch: number
  // P8: who hears each snapshot, and the manifest the host was last told.
  listeners: Array<(key: string) => void>
  told?: string
}

// Each plugin's current activation by ID, which its own messages (effects, watches) name; and every activation by the
// load that made it, which the host's calls and views name. An activation lives until the host deactivates it: a
// candidate set up for a reload does not end the running one, whose registrations the host still routes to.
const plugins = new Map<string, Plugin>()
const generations = new Map<number, Plugin>()
// How long a component's command outlives its mount, in milliseconds (P8).
const UNCOMMAND = 250
let last = 0
let themeMode = "dark"
// The page theme's colors by token, `#rrggbbaa`, which the V2 context's `theme` reads (P8).
let palette: { mode: string; colors: Record<string, string> } = { mode: "dark", colors: {} }

function mountKey(id: Json) {
  return `${id.surface}\u0000${id.key}\u0000${id.generation}`
}

function fail(plugin: Plugin, error: string) {
  if (plugin.failed) return
  plugin.failed = true
  plugin.active = false
  send({ type: "fail", id: plugin.id, error })
}

// Sends what `plugin` gave, which may not be JSON: then it fails, and the call `seq`, if any, is answered with that.
function sendFor(plugin: Plugin, out: Json, seq?: number) {
  try {
    send(out)
  } catch (error) {
    const why = `it gave what is not JSON: ${message(error)}`
    if (seq === undefined) return fail(plugin, why)
    plugin.failed = true
    plugin.active = false
    send({ type: "done", seq, error: why })
  }
}

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

// Queues `request` for the call that runs, the setup that runs, or a batch of its own; resolves with its answer.
function effect(plugin: Plugin, request: Request): Promise<Json> {
  return new Promise((resolve) => {
    if (plugin.failed) return resolve(undefined)
    if (plugin.setting) {
      plugin.setupEffects.push(request)
      plugin.resolvers.push(resolve)
      return
    }
    if (plugin.callEffects) {
      plugin.callEffects.push(request)
      plugin.resolvers.push(resolve)
      return
    }
    const seq = ++plugin.batch
    plugin.answers.set(`b${seq}`, [resolve])
    sendFor(plugin, { type: "effects", id: plugin.id, seq, effects: [request] })
  })
}

function view(plugin: Plugin, mount: Mount) {
  if (plugin.failed || !plugin.active) return
  if (mount.inflight) {
    mount.dirty = true
    return
  }
  mount.dirty = false
  const surface = plugin.surfaces[mount.surface]
  if (!surface) return
  const used = new Map<string, string>()
  // The memos within each memo's subtree: a kept subtree keeps them too, so they stay known (review carbon-7).
  const nested = new Map<string, string[]>()
  const within: string[][] = []
  const kept = (key: string) => {
    for (const inner of mount.nested.get(key) ?? []) {
      used.set(inner, mount.memo.get(inner) ?? "")
      nested.set(inner, mount.nested.get(inner) ?? [])
      kept(inner)
    }
  }
  const given: Array<[number, Json]> = []
  const released: number[] = []
  const cx: ViewContext = {
    input: { ...mount.input, full: mount.whole },
    mount: mount.id,
    memo(key, value, build) {
      const text = JSON.stringify(value) ?? "undefined"
      used.set(key, text)
      within.at(-1)?.push(key)
      if (!mount.whole && mount.memo.get(key) === text) {
        nested.set(key, mount.nested.get(key) ?? [])
        kept(key)
        return { type: "keep", key }
      }
      within.push([])
      let node: Json
      try {
        node = build()
      } finally {
        nested.set(key, within.pop() ?? [])
      }
      // The subtree takes the key as its id, as the Rust SDK's memo gives it.
      return node && typeof node === "object" && node.type !== "keep" && node.type !== "slot" ? { ...node, id: key } : node
    },
    content(bytes) {
      const handle = mount.next++
      given.push([handle, typeof bytes === "string" ? bytes : { base64: Buffer.from(bytes).toString("base64") }])
      return handle
    },
    release(handle) {
      released.push(handle)
    },
  }
  let node: Json
  let text: string
  try {
    node = surface.view(cx)
    if (node === undefined) return
    text = JSON.stringify(node)
  } catch (error) {
    fail(plugin, `view threw: ${message(error)}`)
    return
  }
  if (!mount.whole && text === mount.last && given.length === 0 && released.length === 0) return
  mount.rev += 1
  mount.inflight = true
  // A keep of the whole tree (P6a) holds every value of the adopted one: the table stays as it is (review carbon-2).
  const root = node?.type === "keep"
  mount.staged = root ? new Map(mount.memo) : used
  mount.stagedNested = root ? new Map(mount.nested) : nested
  mount.last = text
  frame(TREE, {
    id: plugin.id,
    mount: mount.id,
    rev: mount.rev,
    base: mount.adopted,
    epoch: mount.epoch,
    whole: mount.whole,
    node,
    content: given,
    released,
    memo: mount.staged.size,
  })
}

function viewAll(plugin: Plugin) {
  for (const mount of plugin.mounts.values()) view(plugin, mount)
}

// Runs plugin code for a message without a sequence (a view after an adoption or a snapshot, an answer's resolvers, a
// cleanup): the host is told whose it is, so an end within it names that plugin (review carbon-3).
function within(plugin: Plugin, run: () => void) {
  send({ type: "entered", id: plugin.id })
  try {
    run()
  } finally {
    send({ type: "entered" })
  }
}

function context(plugin: Plugin) {
  const commands = (layer: Json) => {
    for (const command of layer?.commands ?? []) {
      const name = command.id ?? `${plugin.id}.inline-${plugin.commands.length}`
      // P8: a command registered again, as each mount of a component registers its layer, runs the latest handler;
      // it goes once every registration of it went.
      const known = plugin.commands.find((existing) => existing.name === name)
      if (known) {
        known.run = command.run
        known.count += 1
        continue
      }
      plugin.commands.push({
        count: 1,
        name,
        title: command.title ?? name,
        run: command.run,
        hold: !!command.hold,
        wire: {
          name,
          title: command.title ?? name,
          group: command.group ?? null,
          slash: command.slash?.name ?? null,
          keybind: typeof command.bind === "string" ? command.bind : null,
          palette: !!command.palette,
          ...(command.description ? { description: command.description } : {}),
          ...(command.slash?.arguments || command.arguments ? { arguments: true } : {}),
          ...(command.scope ? { scope: command.scope } : {}),
        },
      })
    }
  }
  const carrier = {
    version: VERSION,
    surface(
      name: string,
      place: Json,
      view: Surface["view"],
      options?: {
        palette?: boolean
        notify?: Json[]
        on?: (event: Json) => unknown
        layers?: Json[]
        mounts?: boolean
        unmount?: (mount: Json) => void
      },
    ) {
      plugin.surfaces.push({
        name,
        place,
        view,
        palette: !!options?.palette,
        notify: options?.notify ?? [],
        on: options?.on,
        layers: options?.layers ?? [],
        mounts: !!options?.mounts,
        unmount: options?.unmount,
      })
      changed(plugin)
    },
    // A key layer of the activation, as contract 2.0's `Setup::layer`. What the handler returns is advisory: the host
    // answers a key from the layer's declaration, as it cannot wait.
    layer(layer: Json, handler: (event: Json) => unknown) {
      plugin.layers.push({ layer, handler })
    },
    command(command: Json, run: (input?: string) => unknown) {
      const slash = command.slash ? { name: command.slash, arguments: command.arguments } : undefined
      commands({ commands: [{ ...command, id: command.name, run, bind: command.keybind, slash }] })
      changed(plugin)
    },
    // P8: a command of the plugin's goes, as a V2 keymap layer made in a component ends with it.
    // The host remounts a component after a reload in a later message than the one that ends the last mount: a command
    // goes only if nothing registered it again meanwhile, so a remount changes nothing.
    uncommand(name: string) {
      setTimeout(() => {
        const index = plugin.commands.findIndex((command) => command.name === name)
        if (index === -1) return
        const command = plugin.commands[index]!
        command.count -= 1
        if (command.count === 0) plugin.commands.splice(index, 1)
        changed(plugin)
      }, UNCOMMAND)
    },
    // The storage keys the plugin reads and writes, as a manifest declares them.
    storage(keys: string[]) {
      plugin.storage.push(...keys.filter((key) => !plugin.storage.includes(key)))
      changed(plugin)
    },
    // P8: `listener` hears the key of each snapshot that comes; the page theme's colors.
    listen(listener: (key: string) => void) {
      plugin.listeners.push(listener)
    },
    palette: () => palette,
    // P8: the registrations may have changed after setup: the host is told, once they settle.
    changed: () => changed(plugin),
    on(types: string[], handler: (event: Json) => unknown) {
      plugin.events.push({ types, handler })
    },
    effect: (request: Request) => effect(plugin, request),
    watch(key: string, request: Request) {
      const watch = { type: "watch", id: plugin.id, key, request }
      if (plugin.setting) plugin.setupWatches.push(watch)
      else send(watch)
    },
    unwatch(key: string) {
      plugin.snapshots.delete(key)
      send({ type: "unwatch", id: plugin.id, key })
    },
    read: (key: string) => plugin.snapshots.get(key),
    // Why the read `key` watches is nothing: over the host's bound.
    readError: (key: string) => plugin.readErrors.get(key),
    // The plugin's state changed outside a call: its surfaces view again.
    invalidate: () => viewAll(plugin),
    fetch(request: Json): Promise<Json> {
      return effect(plugin, { type: "fetch", ...request }).then(
        (id) => new Promise((resolve) => plugin.replies.set(id, resolve)),
      )
    },
  }
  const base = {
    id: plugin.id,
    options: plugin.options ?? {},
    // What the client said as it started the JS host, and the theme's mode as it changes.
    app: { version: process.env.OPENCODE_VERSION ?? "", channel: process.env.OPENCODE_CHANNEL ?? "" },
    get themeMode() {
      return themeMode
    },
    data: {
      on(type: string, handler: (event: Json) => unknown) {
        // One subscription a type, which every handler of it hears: a type the plugin hears first after setup, as a
        // component's `data.on` does, is a new subscription the host is told of.
        if (!plugin.events.some((events) => events.listens === type)) {
          plugin.events.push({ types: [type], handler: () => undefined, listens: type })
          changed(plugin)
        }
        const listeners = (plugin.listening[type] ??= [])
        listeners.push(handler)
        // The host keeps routing the type; the handler hears no more of it.
        return () => {
          const index = listeners.indexOf(handler)
          if (index !== -1) listeners.splice(index, 1)
        }
      },
    },
  }
  const v2 = compat(base, carrier as never) as Json
  v2[Symbol.for("opencode.carrier")] = carrier
  return v2
}

// Tells the host plugin `plugin`'s registrations once they settle, after setup, when they changed since it was told:
// it takes them as a reload (P8: a V2 plugin registers in an async setup, and in its components). They settle once the
// messages that came are handled: a mount that ends and one that begins with the same layer change nothing.
const unsettled = new Set<Plugin>()
let settling = false
function changed(plugin: Plugin) {
  if (plugin.setting || !plugin.active || plugin.failed) return
  unsettled.add(plugin)
  if (settling) return
  settling = true
  setTimeout(settle, 0)
}

function settle() {
  settling = false
  if (running) return
  for (const plugin of unsettled) {
    if (!plugin.active || plugin.failed) continue
    const manifest = manifestOf(plugin)
    const holds = plugin.commands.filter((command) => command.hold).map((command) => command.name)
    const told = JSON.stringify([manifest, holds])
    if (told === plugin.told) continue
    plugin.told = told
    sendFor(plugin, { type: "manifest", id: plugin.id, manifest, holds })
  }
  unsettled.clear()
}

function manifestOf(plugin: Plugin) {
  return {
    id: plugin.id,
    commands: plugin.commands.map((command) => command.wire),
    fences: [],
    slots: [],
    routes: [],
    storage: plugin.storage,
    events: plugin.events.map((event) => event.types),
    ...(plugin.layers.length ? { layers: plugin.layers.map((layer) => layer.layer) } : {}),
    surfaces: plugin.surfaces.map((surface) => ({
      name: surface.name,
      place: surface.place,
      ...(surface.palette ? { palette: true } : {}),
      ...(surface.notify.length ? { notify: surface.notify } : {}),
      ...(surface.on ? { handler: true } : {}),
      ...(surface.layers.length ? { layers: surface.layers } : {}),
      ...(surface.mounts ? { mounts: true } : {}),
    })),
  }
}

function resolveEntry(dir: string): string | undefined {
  let name: string | undefined
  const file = path.join(dir, "package.json")
  if (existsSync(file)) {
    try {
      const json = JSON.parse(readFileSync(file, "utf8"))
      if (typeof json?.name === "string" && json.exports !== undefined) name = json.name
    } catch {}
  }
  const specifier = name ? `${name}/tui` : path.resolve(dir, "tui")
  try {
    return Bun.resolveSync(specifier, dir)
  } catch {
    return undefined
  }
}

// Sets up `plugin`, a candidate activation. The running activation of its ID, if any, keeps answering what the host
// routes to it until the host deactivates it, once it registered the candidate. A candidate whose setup throws is
// dropped, and the running one stays (a reload that fails keeps the previous version).
//
// An async setup that waits on the host (a fetch, a read it syncs) cannot finish before the host has the plugin: the
// host answers the plugin it registered. So once such a setup waits with requests outstanding, the host gets the plugin
// as it stands, and the rest of setup goes on as the plugin's own: what it registers then the host takes as a reload,
// and a throw then fails the plugin (P8). A setup that waits on anything else is waited for, as before.
async function setup(seq: number, plugin: Plugin) {
  plugin.setting = true
  plugin.activation = seq
  const state: { settled: boolean; cleanup?: unknown; error?: unknown; threw: boolean } = {
    settled: false,
    threw: false,
  }
  try {
    const result = plugin.definition.setup(context(plugin))
    const done = Promise.resolve(result).then(
      (cleanup) => Object.assign(state, { settled: true, cleanup }),
      (error) => Object.assign(state, { settled: true, error, threw: true }),
    )
    while (!state.settled) {
      await Promise.race([done, new Promise((next) => setTimeout(next, 0))])
      if (!state.settled && (plugin.setupEffects.length || plugin.setupWatches.length)) break
    }
    if (!state.settled)
      void done.then(() => {
        if (state.threw) return fail(plugin, `setup threw: ${message(state.error)}`)
        if (typeof state.cleanup === "function") plugin.cleanups.push(state.cleanup as () => unknown)
        changed(plugin)
      })
  } catch (error) {
    Object.assign(state, { settled: true, error, threw: true })
  }
  if (state.threw) {
    plugin.setting = false
    plugin.failed = true
    send({ type: "done", seq, error: `setup threw: ${message(state.error)}` })
    return
  }
  if (typeof state.cleanup === "function") plugin.cleanups.push(state.cleanup as () => unknown)
  plugin.setting = false
  plugin.active = true
  generations.set(seq, plugin)
  plugins.set(plugin.id, plugin)
  const effects = plugin.setupEffects
  plugin.setupEffects = []
  if (effects.length) plugin.answers.set("setup", plugin.resolvers)
  plugin.resolvers = []
  const holds = plugin.commands.filter((command) => command.hold).map((command) => command.name)
  const registered = manifestOf(plugin)
  plugin.told = JSON.stringify([registered, holds])
  sendFor(plugin, { type: "loaded", seq, id: plugin.id, manifest: registered, holds, effects }, seq)
  for (const watch of plugin.setupWatches.splice(0)) sendFor(plugin, watch)
}

function candidate(definition: Plugin["definition"], target: string, dir: string, options: Json): Plugin {
  return {
    id: definition.id,
    target,
    dir,
    options,
    definition,
    active: false,
    failed: false,
    setting: false,
    activation: 0,
    setupEffects: [],
    setupWatches: [],
    resolvers: [],
    commands: [],
    storage: [],
    events: [],
    layers: [],
    surfaces: [],
    cleanups: [],
    mounts: new Map(),
    snapshots: new Map(),
    readErrors: new Map(),
    answers: new Map(),
    replies: new Map(),
    batch: 0,
    listening: {},
    listeners: [],
  }
}

// The modules loads imported without their setup, by load: the client sets one up once it knows its plugin is enabled.
const described = new Map<number, Plugin>()

// Loads the plugin of `target`. With `setup`, runs its setup; without, says its ID and keeps it for a `setup` message:
// a disabled plugin's setup never runs (review carbon-8).
async function load(seq: number, target: string, dir: string, options: Json, withSetup: boolean) {
  const entry = resolveEntry(dir)
  if (!entry) return send({ type: "unsupported", seq })
  // Each load imports the plugin's modules afresh, as a generation of its own: its helpers as much as its entry, so a
  // changed module's new code runs. The running generation keeps the modules it has.
  const roots = [dir, realpathSync(dir)].map((root) => root + path.sep)
  for (const key of Object.keys(require.cache)) if (roots.some((root) => key.startsWith(root))) delete require.cache[key]
  let module: Json
  try {
    // A URL, so a drive letter, `#` or `%` in the path is not read as one.
    module = await import(`${pathToFileURL(entry).href}?generation=${seq}`)
  } catch (error) {
    return send({ type: "done", seq, error: `cannot load ${target}: ${message(error)}` })
  }
  const definition = module?.default
  if (!definition || typeof definition.id !== "string" || !definition.id || typeof definition.setup !== "function")
    return send({ type: "done", seq, error: `Invalid V2 TUI plugin module: ${target}` })
  const known = plugins.get(definition.id)
  if (known && known.target !== target)
    return send({ type: "done", seq, error: `plugin ID ${definition.id} is already registered` })
  const plugin = candidate(definition, target, dir, options)
  if (withSetup) return setup(seq, plugin)
  described.set(seq, plugin)
  send({ type: "described", seq, id: definition.id })
}

// The client forgot `target`: its plugin goes, and its ID is free for another target.
function forget(target: string) {
  for (const [seq, plugin] of described) if (plugin.target === target) described.delete(seq)
  for (const [id, plugin] of plugins) {
    if (plugin.target !== target) continue
    if (plugin.active) within(plugin, () => deactivate(plugin))
    plugins.delete(id)
  }
}

function deactivate(plugin: Plugin) {
  generations.delete(plugin.activation)
  plugin.active = false
  for (const mount of plugin.mounts.values()) {
    try {
      plugin.surfaces[mount.surface]?.unmount?.(mount.id)
    } catch {}
  }
  plugin.mounts.clear()
  for (const cleanup of plugin.cleanups.splice(0).reverse()) {
    try {
      const done = cleanup()
      if (done instanceof Promise) done.catch(() => undefined)
    } catch {}
  }
}

// Runs one handler as a call: its effects are its own, and a throw has none and fails the plugin.
function call(seq: number, plugin: Plugin, request: Json) {
  if (!plugin.active || plugin.failed) return send({ type: "done", seq })
  plugin.callEffects = []
  plugin.resolvers = []
  let error: string | undefined
  try {
    let result: unknown
    if (request.type === "command") {
      const command = plugin.commands.find((command) => command.name === request.name)
      result = command?.run(request.input ?? undefined)
    } else if (request.type === "event") {
      const events = plugin.events[request.handler]
      result = events?.handler(request.event)
      for (const listener of events?.listens ? [...(plugin.listening[events.listens] ?? [])] : []) listener(request.event)
    } else if (request.type === "input") {
      const to = request.to
      const handler = to.type === "layer" ? plugin.layers[to.layer]?.handler : plugin.surfaces[to.surface]?.on
      result = handler?.(request.event)
    } else if (request.type === "reply") {
      const reply = plugin.replies.get(request.id)
      plugin.replies.delete(request.id)
      reply?.(request.result)
    }
    if (result instanceof Promise) result.catch((error) => fail(plugin, `${request.type} rejected: ${message(error)}`))
  } catch (thrown) {
    const call = { command: "run-command", input: "handle" }[request.type as string] ?? `on-${request.type}`
    error = `${call} threw: ${message(thrown)}`
  }
  const effects = plugin.callEffects
  const resolvers = plugin.resolvers
  plugin.callEffects = undefined
  plugin.resolvers = []
  if (error) {
    plugin.failed = true
    plugin.active = false
    return send({ type: "done", seq, error })
  }
  if (effects.length) plugin.answers.set(`c${seq}`, resolvers)
  // The answer comes once the views the call made due were sent: it is the call's completion, which the host times.
  viewAll(plugin)
  sendFor(plugin, { type: "done", seq, effects }, seq)
}

const work: Json[] = []
let running = false

// The work whose start the host times: a load's setup, a handler, a mount's or an input's view.
const STARTED = new Set(["load", "setup", "call", "mount", "input"])

async function handle(message: Json) {
  const plugin = typeof message.activation === "number" ? generations.get(message.activation) : message.id ? plugins.get(message.id) : undefined
  if (STARTED.has(message.type)) send({ type: "started", seq: message.seq })
  switch (message.type) {
    case "skipped":
    case "hello":
      return
    case "load":
      return load(message.seq, message.target, message.dir, message.options, message.setup)
    case "setup": {
      const plugin = described.get(message.load)
      described.delete(message.load)
      if (!plugin) return send({ type: "done", seq: message.seq, error: "its module is gone" })
      return setup(message.seq, plugin)
    }
    case "forget":
      return forget(message.target)
    case "theme":
      themeMode = message.mode
      if (message.palette) palette = message.palette
      return
    case "deactivate":
      if (plugin) within(plugin, () => deactivate(plugin))
      return
    // A call for an activation that is gone answers with nothing: the host routed it before it ended.
    case "call":
      if (!plugin) return send({ type: "done", seq: message.seq })
      return call(message.seq, plugin, message.call)
    case "mount": {
      if (!plugin || !plugin.active) return send({ type: "done", seq: message.seq })
      const mount: Mount = {
        id: message.mount,
        key: mountKey(message.mount),
        surface: message.surface,
        input: message.input,
        epoch: message.seq,
        rev: 0,
        adopted: 0,
        inflight: false,
        dirty: false,
        whole: true,
        memo: new Map(),
        nested: new Map(),
        next: 1,
        given: [],
        released: [],
      }
      plugin.mounts.set(mount.key, mount)
      view(plugin, mount)
      return send({ type: "done", seq: message.seq })
    }
    case "input": {
      const mount = plugin?.mounts.get(mountKey(message.mount))
      if (plugin && mount) {
        mount.input = message.input
        mount.epoch = message.seq
        view(plugin, mount)
      }
      return send({ type: "done", seq: message.seq })
    }
    case "unmount": {
      const mount = plugin?.mounts.get(mountKey(message.mount))
      plugin?.mounts.delete(mountKey(message.mount))
      if (plugin && mount) within(plugin, () => plugin.surfaces[mount.surface]?.unmount?.(mount.id))
      return
    }
    case "adopted": {
      const mount = plugin?.mounts.get(mountKey(message.mount))
      if (!plugin || !mount || message.rev !== mount.rev || !mount.inflight) return
      mount.adopted = message.rev
      mount.inflight = false
      mount.whole = false
      mount.memo = mount.staged ?? new Map()
      mount.nested = mount.stagedNested ?? new Map()
      mount.staged = undefined
      mount.stagedNested = undefined
      if (mount.dirty) within(plugin, () => view(plugin, mount))
      return
    }
    case "refused": {
      const mount = plugin?.mounts.get(mountKey(message.mount))
      if (!plugin || !mount || message.rev !== mount.rev) return
      mount.adopted = message.adopted
      mount.inflight = false
      mount.whole = true
      mount.memo = new Map()
      mount.nested = new Map()
      mount.staged = undefined
      mount.stagedNested = undefined
      mount.last = undefined
      return within(plugin, () => view(plugin, mount))
    }
    case "snapshot":
      if (!plugin) return
      // A read over the host's bound is nothing, and says why.
      if (message.error) plugin.snapshots.delete(message.key)
      else plugin.snapshots.set(message.key, message.value)
      if (message.error) plugin.readErrors.set(message.key, message.error)
      else plugin.readErrors.delete(message.key)
      if (plugin.active && !plugin.failed)
        within(plugin, () => {
          for (const listener of [...plugin.listeners]) listener(message.key)
          if (plugin.mounts.size) viewAll(plugin)
        })
      return
    case "answered": {
      const waiting = plugin?.answers.get(message.key)
      plugin?.answers.delete(message.key)
      if (plugin && waiting) within(plugin, () => waiting.forEach((resolve, index) => resolve(message.results[index])))
      return
    }
    case "ping": {
      const waiting = [...plugins.values()].some((plugin) =>
        [...plugin.mounts.values()].some((mount) => mount.inflight || mount.dirty),
      )
      return send({ type: "pong", seq: message.seq, waiting })
    }
  }
}

async function drain() {
  if (running) return
  running = true
  while (work.length) {
    const next = work.shift()
    try {
      await handle(next)
    } catch (error) {
      stderr(`js host: ${message(error)}`)
    }
  }
  running = false
  if (unsettled.size) settle()
}

send({ type: "hello", magic: MAGIC, version: VERSION, pid: process.pid })

let pending = Buffer.alloc(0)
for await (const chunk of Bun.stdin.stream()) {
  pending = pending.length ? Buffer.concat([pending, chunk]) : Buffer.from(chunk)
  let acked = 0
  while (pending.length >= 5) {
    const len = pending.readUInt32LE(0)
    if (pending.length < 5 + len) break
    const kind = pending[4]
    const body = pending.subarray(5, 5 + len)
    pending = pending.subarray(5 + len)
    if (kind !== CONTROL) continue
    const message = JSON.parse(body.toString())
    trace(`down ${body.toString()}`)
    if (message.type === "hello") {
      last = message.after ?? 0
      themeMode = message.theme_mode ?? themeMode
      palette = message.palette ?? palette
    }
    if (typeof message.seq === "number") {
      if (message.seq <= last) continue
      if (message.seq !== last + 1) {
        stderr(`js host: the stream skipped from ${last} to ${message.seq}`)
        process.exit(3)
      }
      last = message.seq
      acked = last
    }
    work.push(message)
  }
  if (acked) send({ type: "ack", seq: acked })
  drain()
}
// The input ended: the client is done with it, or gone.
killAll(process.pid)
