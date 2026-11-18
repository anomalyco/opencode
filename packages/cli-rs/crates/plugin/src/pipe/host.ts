// The JS host of opencode-native's pipe carrier (rich-plugins synthesis 3.7 and 4.3, phase P7). One Bun process runs
// every TypeScript TUI plugin and speaks contract 2.0 with the client over its standard input, which carries both
// directions (a socket pair, or a duplex named pipe on Windows; js-stdio): frames of a length (u32, little-endian), a
// kind byte (0 control, 1 tree) and JSON. The client embeds this file and runs it; it is not a module plugins import.
//
// What it gives a plugin is a `{ id, setup }` module's setup context: the V2 TUI context of the compatibility layer
// (P8, `compat/`, bundled as `compat.js`), whose slots, routes and dialogs render the plugin's JSX into contract trees,
// and under `Symbol.for("opencode.carrier")` the carrier that layer is built on: surfaces whose views return contract
// trees, effects, and reads the host pushes as snapshots. The modules a plugin imports from the TS client
// (`@opencode/plugin/tui`, Solid, `@opentui/solid`, `@opentui/core`) are the layer's.
//
// The rules it keeps:
// - Standard input is the protocol, both ways. Standard output and standard error are the plugins': `console` and
//   `process.stdout` write to standard error, and what a plugin writes to the descriptor itself (`writeSync(1, …)`)
//   the client logs, by the plugin whose code ran then, which this host marks on standard output (`own`).
// - Every host message with a sequence is acknowledged on receipt, apart from the work it asks for. A sequence seen
//   again is dropped; one that skips or goes back breaks the stream, and the process exits.
// - A handler's effects are its call's: a handler that throws has none, and its plugin is called no more.
// - A mount has at most one tree in flight: the next waits until the host adopted or refused the last.
// - The process exits when its input ends, or when the client that started it is gone, even while a plugin spins.

import path from "node:path"
import { Console } from "node:console"
import { existsSync, readFileSync, writeSync } from "node:fs"
import { pathToFileURL } from "node:url"
import { isBuiltin } from "node:module"
import { plugin as runtime } from "bun"
import { context as compat, inside, modules, real, reported } from "./compat.js"

const MAGIC = "opencode-js-host"
const VERSION = 1
const CONTROL = 0
const TREE = 1

// Prints are logged a line at a time (review F4): every method of `console` (`dir` and `table` too, which Bun's own
// console writes to standard output directly) and the whole `process.stdout` stream, also for a library that holds on
// to it or waits for its callback, write to standard error.
const stderr = (text: string) => process.stderr.write(text.endsWith("\n") ? text : text + "\n")
globalThis.console = new Console(process.stderr, process.stderr)
process.stdout.write = ((chunk: unknown, encoding?: unknown, callback?: unknown) =>
  (process.stderr.write as Function)(chunk, encoding, callback)) as typeof process.stdout.write

// The modules a V2 plugin imports from the TS client are the compatibility layer's, also from a package's own
// `node_modules`, as the TS client's runtime plugin support gives its own (P8). Virtual modules, since Bun resolves the
// JSX runtime a `@jsxImportSource` pragma names without a plugin's `onResolve`.
// The approved copies of project plugins (P8), each a root its own files may import from alone: a module of the
// layer and the runtime's own aside, an import that resolves outside it is refused (bigboi P8-1). Each is kept by its
// real path, and paths are compared by `inside` (carbon recheck-3: a verbatim prefix, a drive letter's case or an 8.3
// name on Windows).
const confined = new Set<string>()
// `Bun.resolveSync` calls this `onResolve` again, with the importer's directory and then each parent as the importer,
// and resolving from those fails a relative import (FT-3): the call made inside answers Bun's own resolution.
let resolving = false
const OUTSIDE = "is outside the plugin's approved files"
const RUNTIME = "opentui:runtime-module:"

runtime({
  name: "opencode-compat",
  setup(build) {
    // Each also as OpenTUI's runtime registry names it, `opentui:runtime-module:<encoded specifier>`, which TS's runtime
    // serves and a plugin may import or probe (CT-3), and with the specifier left as it is.
    for (const [name, exports] of Object.entries(modules)) {
      const ids = new Set([name, RUNTIME + encodeURIComponent(name), RUNTIME + name])
      for (const id of ids) build.module(id, () => ({ exports, loader: "object" }))
    }
    build.onResolve({ filter: /.*/ }, (args) => {
      const importer = args.importer?.split("?")[0]
      const layer = args.path in modules || args.path.startsWith(RUNTIME)
      if (!importer || resolving || confined.size === 0 || layer || builtin(args.path)) return undefined
      // The root itself is an importer too, as `resolveEntry` resolves from it (carbon jsnpm-3), and resolves from
      // itself rather than from its parent.
      const within = (file: string) => [...confined].find((root) => inside(root, file))
      const root = within(importer) ?? within(real(importer))
      if (!root) return undefined
      const at = path.relative(root, importer) === "" || path.relative(root, real(importer)) === ""
      resolving = true
      const resolved = (() => {
        try {
          return Bun.resolveSync(args.path, at ? importer : path.dirname(importer))
        } finally {
          resolving = false
        }
      })()
      if (inside(root, resolved) || inside(root, real(resolved)) || builtin(resolved)) return undefined
      throw new Error(`${args.path} ${OUTSIDE}`)
    })
  },
})

function builtin(specifier: string) {
  return isBuiltin(specifier) || specifier === "bun" || specifier.startsWith("bun:")
}

// Frames go out on standard input, the protocol's both ways, with blocking writes (review carbon-5): a client that
// reads nothing stops the JS host in its write, which is the channel's back-pressure, rather than letting it buffer
// without bound; and no frame is cut at exit.
function write(bytes: Buffer, fd = 0) {
  let at = 0
  while (at < bytes.length) {
    try {
      at += writeSync(fd, bytes, at)
    } catch (error) {
      if ((error as { code?: string }).code !== "EAGAIN") throw error
    }
  }
}

// Whose code runs, marked on standard output as it changes: what a plugin writes there with `writeSync(1, …)` while
// its code runs comes after its mark, so the client's log names it; bytes written outside any plugin's code (a timer, a
// child process) come after a `null` mark and name nobody. The mark is the client's `OWNER` in `child.rs`.
const OWNER = "\0OPENCODE_JS_HOST_OWNER "
let owner: string | undefined
function own(id: string | undefined) {
  if (id === owner) return
  owner = id
  try {
    write(Buffer.from(`${OWNER}${JSON.stringify(id ?? null)}\0`), 1)
  } catch {}
}
async function owning<T>(id: string | undefined, run: () => T | Promise<T>): Promise<T> {
  const before = owner
  own(id)
  try {
    return await run()
  } finally {
    own(before)
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
      for (const pid of children.get(queue.shift()!) ?? []) (found.push(pid), queue.push(pid))
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
  // The host was told of it in a manifest: a change of its state goes as `set-enabled` from then on.
  announced?: boolean
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
  unmount?: (mount: Json, handover?: boolean) => void
}

// A renderer claim (contract 2.x, step D): a code block's renderer of the layer, which draws a part of the claim's
// target, or declines (`null`), or throws.
interface Claim {
  target: Json
  view: (part: Json) => Json
}

// A part a claim draws: its newest revision, and the revision in flight, one at a time.
interface ClaimMount {
  id: Json
  claim: number
  // The newest part, until the host adopted the tree drawn for it: the next one comes with its own (carbon c2d-3).
  part: Json
  rev: number
  inflight: boolean
  dirty: boolean
  // A hash of the last tree sent, which an unchanged one is not sent again for.
  last?: string
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
  // Its activation ended (a reload or a disable): what it still does fails no other one (carbon-5).
  deactivated?: boolean
  setting: boolean
  activation: number
  setupEffects: Request[]
  // What setup watches, told after it was answered, as the host knows the plugin from then on.
  setupWatches: Json[]
  callEffects?: Request[]
  // The mount each of `callEffects` is of, where it is another mount's than the call's own (carbon c2b-1).
  callMounts?: Array<Json | null>
  // The mount the call that runs is of, when it is a surface's input: an effect of that mount is the call's.
  callMount?: Json
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
  claims: Claim[]
  // A claim's view runs: what it asks of the host is dropped (contract 2.x, step D), which the log says once.
  claiming?: boolean
  claimEffects?: boolean
  cleanups: Array<() => unknown>
  mounts: Map<string, Mount>
  claimMounts: Map<string, ClaimMount>
  snapshots: Map<string, Json>
  readErrors: Map<string, string>
  answers: Map<string, Array<(value: Json) => void>>
  replies: Map<number, { resolve: (result: Json) => void; reject: (error: Error) => void }>
  // CT-5: the parts of each reply too large for one frame, until its call joins them.
  parts: Map<number, Buffer[]>
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
// The failed reply of a fetch the host did not take, as `REFUSED` in `lib.rs` says it.
const REFUSED = "the host takes no request now: the effects that wait fill its queue"
// What a fetch rejects with when the host cancels it, as the mount that asked for it closed.
function cancelled() {
  return Object.assign(new Error("the fetch was cancelled: the mount that asked for it closed"), { name: "AbortError" })
}
let last = 0
let themeMode = "dark"
// The page theme's colors by token, `#rrggbbaa`, which the V2 context's `theme` reads (P8).
let palette: { mode: string; colors: Record<string, string> } = { mode: "dark", colors: {} }

function mountKey(id: Json) {
  return `${id.surface}\u0000${id.key}\u0000${id.generation}`
}

function fail(plugin: Plugin, error: string) {
  if (plugin.failed || plugin.deactivated) return
  plugin.failed = true
  plugin.active = false
  send({ type: "fail", id: plugin.id, activation: plugin.activation, error })
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

// The message of what a plugin threw, for its failure, which the error view shows. Its stack goes to standard error,
// which the client logs, so the author finds the line that threw in the log.
function thrown(error: unknown) {
  if (error instanceof Error && error.stack) stderr(error.stack)
  return message(error)
}

// Queues `request` for the call that runs, the setup that runs, or a batch of its own; resolves with its answer. A
// call ends at its handler's first `await`: what it asks for after that is a batch's, the activation's, not the mount's.
// A request of `mount` (the layer's focus of a field in that mount's tree, contract 2.x, step B) is that mount's: in a
// call, one of the call's effects that names the mount unless it is the call's own, so it keeps its place among them
// and goes with them if the call throws (carbon c2b-1); outside one, a batch that names the mount. The host applies it
// to the mount, or nowhere once it closed.
function effect(plugin: Plugin, request: Request, mount?: Json): Promise<Json> {
  return new Promise((resolve) => {
    if (plugin.failed) return resolve(undefined)
    // A claim's view reads only, on every carrier (contract 2.x, step D).
    if (plugin.claiming) {
      if (!plugin.claimEffects) {
        plugin.claimEffects = true
        send({ type: "log", id: plugin.id, level: "warn", message: "a code block's renderer asked the host for something as it drew; it is dropped" })
      }
      return resolve(undefined)
    }
    if (plugin.setting) {
      plugin.setupEffects.push(request)
      plugin.resolvers.push(resolve)
      return
    }
    if (plugin.callEffects) {
      plugin.callEffects.push(request)
      plugin.callMounts?.push(mount && !sameMount(plugin.callMount, mount) ? mount : null)
      plugin.resolvers.push(resolve)
      return
    }
    const seq = ++plugin.batch
    plugin.answers.set(`b${seq}`, [resolve])
    const batch = { type: "effects", id: plugin.id, activation: plugin.activation, seq, effects: [request] }
    sendFor(plugin, mount ? { ...batch, mount } : batch)
  })
}

function sameMount(a: Json, b: Json) {
  return !!a && !!b && a.surface === b.surface && a.key === b.key && a.generation === b.generation
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
      return node && typeof node === "object" && node.type !== "keep" && node.type !== "slot"
        ? { ...node, id: key }
        : node
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
    fail(plugin, `view threw: ${thrown(error)}`)
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
  // The registrations this view made go first. The reload they take mounts the surface again: a tree sent before them
  // would show, then give way to the new mount's placeholder until its first tree.
  if (unsettled.has(plugin)) tell(plugin)
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

// Draws the newest part of a claimed part's mount, a whole tree each time, unless one is in flight: then once the host
// adopted it. A renderer that throws sends its error, and the host falls the part back; the plugin goes on.
function viewClaim(plugin: Plugin, mount: ClaimMount) {
  if (plugin.failed || !plugin.active) return
  if (mount.inflight) {
    mount.dirty = true
    return
  }
  mount.dirty = false
  const claim = plugin.claims[mount.claim]
  if (!claim) return
  let node: Json = null
  let error: string | undefined
  let text = "null"
  plugin.claiming = true
  try {
    node = claim.view(mount.part) ?? null
    text = JSON.stringify(node)
  } catch (caught) {
    error = thrown(caught)
  } finally {
    plugin.claiming = false
  }
  const hash = String(Bun.hash(text))
  if (error === undefined && hash === mount.last) return
  mount.rev += 1
  mount.inflight = true
  mount.last = hash
  frame(TREE, {
    id: plugin.id,
    mount: mount.id,
    rev: mount.rev,
    base: 0,
    epoch: 0,
    whole: true,
    node: error === undefined ? node : null,
    ...(error === undefined ? {} : { error }),
  })
}

// Runs plugin code for a message without a sequence (a view after an adoption or a snapshot, an answer's resolvers, a
// cleanup): the host is told whose it is, so an end within it names that plugin (review carbon-3).
function within(plugin: Plugin, run: () => void) {
  send({ type: "entered", id: plugin.id })
  const before = owner
  own(plugin.id)
  try {
    run()
  } finally {
    own(before)
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
        enable(plugin, known, command.enabled !== false)
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
          ...(command.slash?.aliases?.length ? { aliases: command.slash.aliases } : {}),
          ...(command.enabled === false ? { enabled: false } : {}),
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
        unmount?: (mount: Json, handover?: boolean) => void
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
    // A renderer claim (contract 2.x, step D), as contract 2.0's `Setup::claim`: `view` draws a part of `target`. It
    // goes as the returned function runs.
    claim(target: Json, view: Claim["view"]) {
      const claim: Claim = { target, view }
      plugin.claims.push(claim)
      changed(plugin)
      return () => {
        const index = plugin.claims.indexOf(claim)
        if (index === -1) return
        plugin.claims.splice(index, 1)
        changed(plugin)
      }
    },
    // A key layer of the activation, as contract 2.0's `Setup::layer`. What the handler returns is advisory: the host
    // answers a key from the layer's declaration, as it cannot wait.
    layer(layer: Json, handler: (event: Json) => unknown) {
      plugin.layers.push({ layer, handler })
    },
    command(command: Json, run: (input?: string) => unknown) {
      const slash = command.slash ? { name: command.slash, arguments: command.arguments, aliases: command.aliases } : undefined
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
    effect: (request: Request, mount?: Json) => effect(plugin, request, mount),
    watch(key: string, request: Request) {
      const watch = { type: "watch", id: plugin.id, activation: plugin.activation, key, request }
      if (plugin.setting) plugin.setupWatches.push(watch)
      else send(watch)
    },
    unwatch(key: string) {
      plugin.snapshots.delete(key)
      send({ type: "unwatch", id: plugin.id, activation: plugin.activation, key })
    },
    read: (key: string) => plugin.snapshots.get(key),
    // Why the read `key` watches is nothing: over the host's bound.
    readError: (key: string) => plugin.readErrors.get(key),
    // The plugin's state changed outside a call: its surfaces view again.
    invalidate: () => viewAll(plugin),
    // P8: what runs as the activation ends, such as the layer closing a dialog of the plugin's own.
    cleanup: (cleanup: () => unknown) => cleanUp(plugin, cleanup),
    fetch(request: Json): Promise<Json> {
      // A fetch the host did not take answers no ID, and no reply comes: it ends as a failed reply does. One the host
      // cancels, as the mount that asked for it closed, rejects with an `AbortError`, as a web fetch that is aborted.
      return effect(plugin, { type: "fetch", ...request }).then((id) => {
        if (typeof id !== "number") return { Err: REFUSED }
        return new Promise((resolve, reject) => plugin.replies.set(id, { resolve, reject }))
      })
    },
    // What waits on the host: the answers of calls and batches, which carry a fetch's ID, and the fetches' replies. None
    // once each settled (bigboi's ownership pass).
    // With the parts kept of replies too large for one frame (CT-5).
    pendingFetches: () => plugin.answers.size + plugin.replies.size + plugin.parts.size,
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
// messages that came are handled: a mount that ends and one that begins with the same layer change nothing. What a
// view registered goes before its tree (`view`).
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
  for (const plugin of unsettled) tell(plugin)
  unsettled.clear()
}

function tell(plugin: Plugin) {
  if (!plugin.active || plugin.failed) return
  const manifest = manifestOf(plugin)
  const holds = plugin.commands.filter((command) => command.hold).map((command) => command.name)
  const told = announce(plugin, manifest, holds)
  if (told === plugin.told) return
  plugin.told = told
  sendFor(plugin, { type: "manifest", id: plugin.id, activation: plugin.activation, manifest, holds })
}

// What the host is told of `plugin`'s registrations in `manifest`, to tell a change of them apart: a command's state
// is none, whose change goes as `set-enabled` and reloads nothing. Its commands are announced from then on.
function announce(plugin: Plugin, manifest: Json, holds: string[]) {
  for (const command of plugin.commands) command.announced = true
  const commands = manifest.commands.map(({ enabled: _, ...command }: Json) => command)
  return JSON.stringify([{ ...manifest, commands }, holds])
}

// Contract ergonomics 2.5: `command` is enabled or not, as the plugin says now. The host it was announced to is told
// with `set-enabled`, in the call that changed it, so its key goes on to whatever else takes it from the next key on;
// a manifest carries it to a host that reloads, or one not told of the command yet.
function enable(plugin: Plugin, command: Command, enabled: boolean) {
  if ((command.wire.enabled !== false) === enabled) return
  if (enabled) delete command.wire.enabled
  else command.wire.enabled = false
  if (command.announced && !plugin.setting) void effect(plugin, { type: "set-enabled", name: command.name, enabled })
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
    ...(plugin.claims.length ? { claims: plugin.claims.map((claim) => ({ target: claim.target })) } : {}),
  }
}

// The plugin's TUI module, as TS's `Host.resolve` finds it: `<name>/tui` by its `package.json`, else `tui` at its root.
// It must be one of the plugin's own files (carbon jsnpm-3): a `name` such as `../../x` or an absolute path resolves
// anywhere, and the module it names would run outside what was approved. A package's `<name>/tui` resolves to the
// package itself, by self-reference or from the `node_modules` it sits in.
function resolveEntry(dir: string): { entry: string } | { error: string } | { missing: string } {
  let name: string | undefined
  const file = path.join(dir, "package.json")
  if (existsSync(file)) {
    try {
      const json = JSON.parse(readFileSync(file, "utf8"))
      if (typeof json?.name === "string" && json.exports !== undefined) name = json.name
    } catch {}
  }
  const specifier = name ? `${name}/tui` : path.resolve(dir, "tui")
  const entry = (() => {
    try {
      return Bun.resolveSync(specifier, dir)
    } catch (error) {
      // A confined plugin's resolution the hook refused is its failure; one that finds nothing has no TUI module.
      if (message(error).includes(OUTSIDE)) return { error: message(error) }
      return { missing: message(error) }
    }
  })()
  if (typeof entry !== "string") return entry
  const own = existsSync(entry) && inside(real(dir), real(entry)) && path.relative(real(dir), real(entry)) !== ""
  return own ? { entry } : { error: `its TUI module ${entry} is outside the plugin's directory` }
}

// The package a plugin imports that its directory does not hold, said so (js-no-install): Bun runs with auto-install off
// (`--no-install`, and `install.auto = "disable"` in the JS host's bunfig), so nothing is fetched from npm, and the
// plugin fails rather than running code nobody installed. Other errors, and a missing relative file, read as Bun says.
function notInstalled(error: unknown) {
  const found = /Cannot find (?:package|module) '([^']+)'/.exec(message(error))
  const name = found?.[1]
  if (!name || name.startsWith(".") || path.isAbsolute(name) || name.startsWith("file:")) return undefined
  const pkg = name.startsWith("@") ? name.split("/").slice(0, 2).join("/") : name.split("/")[0]
  return `it imports the package '${pkg}', which is not installed with the plugin, and opencode-native installs nothing: install the plugin's dependencies in its directory`
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
        if (state.threw) return fail(plugin, `setup threw: ${thrown(state.error)}`)
        if (typeof state.cleanup === "function") cleanUp(plugin, state.cleanup as () => unknown)
        changed(plugin)
      })
  } catch (error) {
    Object.assign(state, { settled: true, error, threw: true })
  }
  if (state.threw) {
    plugin.setting = false
    plugin.failed = true
    send({ type: "done", seq, error: `setup threw: ${thrown(state.error)}` })
    return
  }
  if (typeof state.cleanup === "function") cleanUp(plugin, state.cleanup as () => unknown)
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
  plugin.told = announce(plugin, registered, holds)
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
    claims: [],
    cleanups: [],
    mounts: new Map(),
    claimMounts: new Map(),
    snapshots: new Map(),
    readErrors: new Map(),
    answers: new Map(),
    replies: new Map(),
    parts: new Map(),
    batch: 0,
    listening: {},
    listeners: [],
  }
}

// The modules loads imported without their setup, by load: the client sets one up once it knows its plugin is enabled.
const described = new Map<number, Plugin>()

// Loads the plugin of `target`. With `setup`, runs its setup; without, says its ID and keeps it for a `setup` message:
// a disabled plugin's setup never runs (review carbon-8).
async function load(seq: number, target: string, dir: string, options: Json, withSetup: boolean, seed?: Json) {
  const resolved = resolveEntry(dir)
  if ("missing" in resolved) return send({ type: "unsupported", seq, reason: resolved.missing })
  if ("error" in resolved) return send({ type: "done", seq, error: `cannot load ${target}: ${resolved.error}` })
  const entry = resolved.entry
  // Each load imports the plugin's modules afresh, as a generation of its own: its helpers as much as its entry, so a
  // changed module's new code runs. The running generation keeps the modules it has.
  const root = real(dir)
  for (const key of Object.keys(require.cache)) if (inside(root, key) || inside(dir, key)) delete require.cache[key]
  let module: Json
  try {
    // A URL, so a drive letter, `#` or `%` in the path is not read as one.
    module = await import(`${pathToFileURL(entry).href}?generation=${seq}`)
  } catch (error) {
    return send({ type: "done", seq, error: `cannot load ${target}: ${notInstalled(error) ?? thrown(error)}` })
  }
  const definition = module?.default
  if (!definition || typeof definition.id !== "string" || !definition.id || typeof definition.setup !== "function")
    return send({ type: "done", seq, error: `Invalid V2 TUI plugin module: ${target}` })
  const known = plugins.get(definition.id)
  if (known && known.target !== target)
    return send({ type: "done", seq, error: `plugin ID ${definition.id} is already registered` })
  const plugin = candidate(definition, target, dir, options)
  // Its setup's writes name its ID; its module's own code ran as its target.
  own(definition.id)
  if (withSetup) return setup(seq, seeded(plugin, seed))
  described.set(seq, plugin)
  send({ type: "described", seq, id: definition.id })
}

// The reads the client sent with a setup (P8): the route and `info` as they are now, which setup may read at once.
function seeded(plugin: Plugin, seed?: Json) {
  for (const [key, value] of Object.entries(seed ?? {})) plugin.snapshots.set(key, value)
  return plugin
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

// Keeps `cleanup` for the plugin's deactivation, or runs it now when its activation already ended, as an async setup
// that settles after it does (carbon-5).
function cleanUp(plugin: Plugin, cleanup: () => unknown) {
  if (!plugin.deactivated) return void plugin.cleanups.push(cleanup)
  try {
    const done = cleanup()
    if (done instanceof Promise) done.catch(() => undefined)
  } catch {}
}

function deactivate(plugin: Plugin) {
  generations.delete(plugin.activation)
  plugin.active = false
  plugin.deactivated = true
  // What it still waits on the host for settles once, as refused: no answer or reply reaches an activation that
  // ended, whose generation is gone (big-boi's catalog review).
  for (const resolvers of plugin.answers.values()) for (const resolve of resolvers) resolve(undefined)
  plugin.answers.clear()
  for (const reply of plugin.replies.values()) reply.resolve({ Err: "the plugin's activation ended" })
  plugin.replies.clear()
  plugin.parts.clear()
  for (const mount of plugin.mounts.values()) {
    try {
      plugin.surfaces[mount.surface]?.unmount?.(mount.id)
    } catch {}
  }
  plugin.mounts.clear()
  plugin.claimMounts.clear()
  for (const cleanup of plugin.cleanups.splice(0).reverse()) {
    try {
      const done = cleanup()
      if (done instanceof Promise) done.catch(() => undefined)
    } catch {}
  }
}

// Runs one handler as a call: its effects are its own, and a throw has none and fails the plugin.
function call(seq: number, plugin: Plugin, request: Json) {
  if (!plugin.active || plugin.failed)
    return send({ type: "done", seq, ...(request.type === "command" ? { declined: true } : {}) })
  plugin.callEffects = []
  plugin.callMounts = []
  plugin.callMount = request.type === "input" && request.to?.type === "surface" ? request.to.mount : undefined
  plugin.resolvers = []
  let error: string | undefined
  let result: unknown
  try {
    if (request.type === "command") {
      // A command that is gone answers `false`, as one that declines: its key goes on to the host (CT-19).
      const command = plugin.commands.find((command) => command.name === request.name)
      result = command ? command.run(request.input ?? undefined) : false
    } else if (request.type === "event") {
      const events = plugin.events[request.handler]
      result = events?.handler(request.event)
      for (const listener of events?.listens ? [...(plugin.listening[events.listens] ?? [])] : [])
        listener(request.event)
    } else if (request.type === "input") {
      const to = request.to
      const handler = to.type === "layer" ? plugin.layers[to.layer]?.handler : plugin.surfaces[to.surface]?.on
      result = handler?.(request.event)
    } else if (request.type === "reply") {
      const reply = plugin.replies.get(request.id)
      plugin.replies.delete(request.id)
      reply?.resolve(request.result)
    }
    if (result instanceof Promise) result.catch((error) => fail(plugin, `${request.type} rejected: ${thrown(error)}`))
  } catch (caught) {
    const call = { command: "run-command", input: "handle" }[request.type as string] ?? `on-${request.type}`
    error = `${call} threw: ${thrown(caught)}`
  }
  const effects = plugin.callEffects
  const mounts = plugin.callMounts ?? []
  const resolvers = plugin.resolvers
  plugin.callEffects = undefined
  plugin.callMounts = undefined
  plugin.callMount = undefined
  plugin.resolvers = []
  if (error) {
    plugin.failed = true
    plugin.active = false
    return send({ type: "done", seq, error })
  }
  if (effects.length) plugin.answers.set(`c${seq}`, resolvers)
  // The answer comes once the views the call made due were sent: it is the call's completion, which the host times. A
  // command that returned `false` declined (TS's "return false to continue"): the host routes the key that ran it on.
  viewAll(plugin)
  const declined = request.type === "command" && result === false
  const named = mounts.some((mount) => mount !== null) ? { mounts } : {}
  sendFor(plugin, { type: "done", seq, effects, ...named, ...(declined ? { declined: true } : {}) }, seq)
}

const work: Json[] = []
let running = false

// The work whose start the host times: a load's setup, a handler, a mount's or an input's view.
const STARTED = new Set(["load", "setup", "call", "mount", "input", "claim"])

async function handle(message: Json) {
  const plugin =
    typeof message.activation === "number"
      ? generations.get(message.activation)
      : message.id
        ? plugins.get(message.id)
        : undefined
  if (STARTED.has(message.type)) send({ type: "started", seq: message.seq })
  switch (message.type) {
    case "skipped":
    case "hello":
      return
    case "load":
      if (message.confined) confined.add(real(message.dir))
      return load(message.seq, message.target, message.dir, message.options, message.setup, message.seed)
    case "setup": {
      const plugin = described.get(message.load)
      described.delete(message.load)
      if (!plugin) return send({ type: "done", seq: message.seq, error: "its module is gone" })
      return setup(message.seq, seeded(plugin, message.seed))
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
      // The route as the call starts, which the host sends while the plugin does not watch it (P8).
      if (message.route !== undefined) plugin.snapshots.set("route", message.route)
      // A reply too large for one frame: its result is the JSON of the parts that came before it (CT-5).
      if (message.parted) {
        const parts = plugin.parts.get(message.call.id)
        plugin.parts.delete(message.call.id)
        // None kept: no fetch waits for the reply, which then reaches nothing.
        message.call.result = parts ? JSON.parse(Buffer.concat(parts).toString()) : { Err: "the reply's parts are gone" }
      }
      return call(message.seq, plugin, message.call)
    case "part": {
      // Kept only for a request a fetch waits on, whose size the host admitted: a part of one settled or cancelled (a
      // repeat the fault model sends) is dropped, where it would wait for no call.
      if (!plugin || !plugin.replies.has(message.request)) return
      const parts = plugin.parts.get(message.request) ?? []
      parts.push(Buffer.from(message.data, "base64"))
      plugin.parts.set(message.request, parts)
      return
    }
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
    // A part a claim draws: its first sight begins its mount; a newer revision is drawn now, or once the one in flight
    // was adopted (contract 2.x, step D).
    case "claim": {
      if (!plugin || !plugin.active) return send({ type: "done", seq: message.seq })
      const key = mountKey(message.mount)
      const mount = plugin.claimMounts.get(key) ?? { id: message.mount, claim: message.claim, part: message.part, rev: 0, inflight: false, dirty: false }
      mount.part = message.part
      plugin.claimMounts.set(key, mount)
      viewClaim(plugin, mount)
      return send({ type: "done", seq: message.seq })
    }
    case "unmount": {
      if (plugin?.claimMounts.delete(mountKey(message.mount))) return
      const mount = plugin?.mounts.get(mountKey(message.mount))
      plugin?.mounts.delete(mountKey(message.mount))
      // A reload's end of a mount it begins again (`handover`), which the layer may take the state of (CT-21).
      if (plugin && mount) within(plugin, () => plugin.surfaces[mount.surface]?.unmount?.(mount.id, !!message.handover))
      return
    }
    case "adopted": {
      const claimed = plugin?.claimMounts.get(mountKey(message.mount))
      if (plugin && claimed) {
        if (message.rev !== claimed.rev || !claimed.inflight) return
        claimed.inflight = false
        if (claimed.dirty) within(plugin, () => viewClaim(plugin, claimed))
        else claimed.part = null
        return
      }
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
      const claimed = plugin?.claimMounts.get(mountKey(message.mount))
      if (plugin && claimed) {
        if (message.rev !== claimed.rev) return
        claimed.inflight = false
        claimed.last = undefined
        return within(plugin, () => viewClaim(plugin, claimed))
      }
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
    case "cancelled": {
      if (!plugin) return
      const reply = plugin.replies.get(message.request)
      plugin.replies.delete(message.request)
      plugin.parts.delete(message.request)
      // The fetch waits for it by now: the `answered` that gave it its ID ran first, and `drain` awaits each message,
      // so the fetch's `then` ran before this one.
      if (reply) within(plugin, () => reply.reject(cancelled()))
      return
    }
    case "answered": {
      const waiting = plugin?.answers.get(message.key)
      plugin?.answers.delete(message.key)
      if (plugin && waiting) within(plugin, () => waiting.forEach((resolve, index) => resolve(message.results[index])))
      return
    }
    case "ping": {
      const waiting = [...plugins.values()].some(
        (plugin) =>
          [...plugin.mounts.values()].some((mount) => mount.inflight || mount.dirty) ||
          [...plugin.claimMounts.values()].some((mount) => mount.inflight || mount.dirty),
      )
      return send({ type: "pong", seq: message.seq, waiting })
    }
  }
}

// The plugin whose code `message` runs, if one does: a load runs its module's own code, named by its target until it
// says its ID.
function runs(message: Json): string | undefined {
  if (message.type === "load") return message.target
  if (message.type === "setup") return described.get(message.load)?.id
  if (typeof message.activation === "number") return generations.get(message.activation)?.id
  return typeof message.id === "string" ? message.id : undefined
}

async function drain() {
  if (running) return
  running = true
  while (work.length) {
    const next = work.shift()
    try {
      await owning(runs(next), () => handle(next))
    } catch (error) {
      stderr(`js host: ${message(error)}`)
    }
  }
  running = false
  if (unsettled.size) settle()
}

send({ type: "hello", magic: MAGIC, version: VERSION, pid: process.pid })

let pending = Buffer.alloc(0)
try {
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
} catch {
  // A read that fails is the end of input too: on Windows the client's end of the named pipe ends it so (EPIPE).
}
// The input ended: the client is done with it, or gone.
killAll(process.pid)
