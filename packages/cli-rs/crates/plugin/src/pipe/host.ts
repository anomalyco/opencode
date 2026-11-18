// The JS host runs all TypeScript plugins in one Bun process. Standard input is a duplex protocol channel; stdout
// and stderr belong to plugin logs. Acknowledge sequenced calls on receipt and commit their effects on return.
// Each mount may have only one tree awaiting adoption.

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
const PIECE = 2
const CONTROL_CAP = 256 << 10

// Redirect console and stream writes together: some Bun console methods bypass console.log.
const stderr = (text: string) => process.stderr.write(text.endsWith("\n") ? text : text + "\n")
globalThis.console = new Console(process.stderr, process.stderr)
process.stdout.write = ((chunk: unknown, encoding?: unknown, callback?: unknown) =>
  (process.stderr.write as Function)(chunk, encoding, callback)) as typeof process.stdout.write

// Serve virtual runtime modules even from nested packages. Confined plugins may otherwise import only within
// their approved real-path root.
const confined = new Set<string>()
// Bun.resolveSync reenters onResolve; the nested call must use Bun's resolver.
let resolving = false
const OUTSIDE = "is outside the plugin's approved files"
const RUNTIME = "opentui:runtime-module:"

runtime({
  name: "opencode-compat",
  setup(build) {
    // Register the encoded and literal forms of OpenTUI runtime-module specifiers.
    for (const [name, exports] of Object.entries(modules)) {
      const ids = new Set([name, RUNTIME + encodeURIComponent(name), RUNTIME + name])
      for (const id of ids) build.module(id, () => ({ exports, loader: "object" }))
    }
    build.onResolve({ filter: /.*/ }, (args) => {
      const importer = args.importer?.split("?")[0]
      const layer = args.path in modules || args.path.startsWith(RUNTIME)
      if (!importer || resolving || confined.size === 0 || layer || builtin(args.path)) return undefined
      // The package root itself may resolve relative imports.
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

// Use blocking writes: a slow reader applies backpressure and exit cannot cut a queued frame in half.
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

// Mark the current plugin on stdout so direct descriptor writes can be attributed. A null mark denotes unowned
// output.
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

const TRACE = process.env.OPENCODE_JS_HOST_TRACE
function trace(line: string) {
  if (TRACE) require("node:fs").appendFileSync(TRACE, line.slice(0, 2000) + "\n")
}

function frame(kind: number, message: unknown) {
  const body = Buffer.from(JSON.stringify(message))
  trace(`up ${body.toString()}`)
  // The final control frame terminates the preceding fragments.
  const frames: Buffer[] = []
  for (let at = 0; at === 0 || at < body.length; at += CONTROL_CAP) {
    const piece = kind === CONTROL ? body.subarray(at, at + CONTROL_CAP) : body
    const last = kind !== CONTROL || at + CONTROL_CAP >= body.length
    const head = Buffer.alloc(5)
    head.writeUInt32LE(piece.length, 0)
    head[4] = last ? kind : PIECE
    frames.push(head, piece)
    if (last) break
  }
  write(Buffer.concat(frames))
}
const send = (message: unknown) => frame(CONTROL, message)

// A spinning plugin can block the main thread. The watchdog also checks for parent death and terminates
// descendants; on Linux the client acts as a subreaper.
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
  on?: (event: Json) => unknown
  layers: Json[]
  mounts: boolean
  // An undefined view waits for the next read snapshot.
  view: (cx: ViewContext) => Json
  unmount?: (mount: Json, handover?: boolean, focused?: string) => void
}

interface Claim {
  target: Json
  view: (part: Json) => Json
}

interface ClaimMount {
  id: Json
  claim: number
  // Keep the current part until its tree is adopted.
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
  // Suppress effects from async work that outlives its activation.
  deactivated?: boolean
  setting: boolean
  activation: number
  setupEffects: Request[]
  // What setup watches, told after it was answered, as the host knows the plugin from then on.
  setupWatches: Json[]
  callEffects?: Request[]
  // A call may enqueue an effect owned by another mount.
  callMounts?: Array<Json | null>
  // The mount the call that runs is of, when it is a surface's input: an effect of that mount is the call's.
  callMount?: Json
  resolvers: Array<(value: Json) => void>
  commands: Command[]
  storage: string[]
  events: Array<{ types: string[]; handler: (event: Json) => unknown; listens?: string }>
  listening: Record<string, Array<(event: Json) => unknown>>
  layers: Array<{ layer: Json; handler: (event: Json) => unknown }>
  surfaces: Surface[]
  // Listeners that can consume input, identified by layer or mount.
  taking: Set<string>
  claims: Claim[]
  // Views of claimed parts cannot enqueue effects.
  claiming?: boolean
  claimEffects?: boolean
  cleanups: Array<() => unknown>
  mounts: Map<string, Mount>
  claimMounts: Map<string, ClaimMount>
  snapshots: Map<string, Json>
  readErrors: Map<string, string>
  answers: Map<string, Array<(value: Json) => void>>
  replies: Map<number, { resolve: (result: Json) => void; reject: (error: Error) => void }>
  parts: Map<number, Buffer[]>
  snapshotParts: Map<string, Buffer[]>
  answerParts: Map<string, Buffer[]>
  // Ignore late snapshots for retired watches.
  retired: Set<string>
  batch: number
  listeners: Array<(key: string) => void>
  // Recheck nonreactive command state before returning from a handler.
  afterCall: Array<() => void>
  told?: string
}

const plugins = new Map<string, Plugin>()
const generations = new Map<number, Plugin>()
// Allow the next mount to adopt a component's commands during registration handover.
const UNCOMMAND = 250
let retiring = 0
const REFUSED = "the host takes no request now: the effects that wait fill its queue"
function cancelled() {
  return Object.assign(new Error("the fetch was cancelled: the mount that asked for it closed"), { name: "AbortError" })
}
let last = 0
let themeMode = "dark"
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

// Serialization can throw before the client receives a frame. Fail the owning plugin in that case.
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

function thrown(error: unknown) {
  if (error instanceof Error && error.stack) stderr(error.stack)
  return message(error)
}

// Keep mount-owned requests with the running call so a throw drops all its effects.
function effect(plugin: Plugin, request: Request, mount?: Json): Promise<Json> {
  return new Promise((resolve) => {
    if (plugin.failed) return resolve(undefined)
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
  // Keeping a subtree also keeps its nested memos.
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
    // An undefined view is pending, not an empty tree.
    if (node === undefined) {
      mount.dirty = true
      return
    }
    text = JSON.stringify(node)
  } catch (error) {
    fail(plugin, `view threw: ${thrown(error)}`)
    return
  }
  if (!mount.whole && text === mount.last && given.length === 0 && released.length === 0) return
  mount.rev += 1
  mount.inflight = true
  // Keeping the root preserves the whole adopted memo table.
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

// Only the newest part waits behind an in-flight claim revision.
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
      // Re-registering a command replaces its handler without adding a manifest entry.
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
        unmount?: (mount: Json, handover?: boolean, focused?: string) => void
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
      return plugin.surfaces.length - 1
    },
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
    layer(layer: Json, handler: (event: Json) => unknown) {
      plugin.layers.push({ layer, handler })
      return plugin.layers.length - 1
    },
    // Tell the host when a listener can consume input; the UI cannot synchronously ask JS.
    taking(listener: Json, on: boolean) {
      const key = JSON.stringify(listener)
      if (plugin.taking.has(key) === on) return
      if (on) plugin.taking.add(key)
      else plugin.taking.delete(key)
      send({ type: "taking", id: plugin.id, activation: plugin.activation, listener, on })
    },
    command(command: Json, run: (input?: string) => unknown) {
      const slash = command.slash ? { name: command.slash, arguments: command.arguments, aliases: command.aliases } : undefined
      commands({ commands: [{ ...command, id: command.name, run, bind: command.keybind, slash }] })
      changed(plugin)
    },
    // Delay retirement across a handover so the next mount can take the same command names.
    enable(name: string, enabled: boolean) {
      const command = plugin.commands.find((command) => command.name === name)
      if (command) enable(plugin, command, enabled)
    },
    afterCall(run: () => void) {
      plugin.afterCall.push(run)
    },
    uncommand(name: string) {
      retiring += 1
      setTimeout(() => {
        retiring -= 1
        const index = plugin.commands.findIndex((command) => command.name === name)
        if (index === -1) return
        const command = plugin.commands[index]!
        command.count -= 1
        if (command.count === 0) plugin.commands.splice(index, 1)
        changed(plugin)
      }, UNCOMMAND)
    },
    storage(keys: string[]) {
      plugin.storage.push(...keys.filter((key) => !plugin.storage.includes(key)))
      changed(plugin)
    },
    listen(listener: (key: string) => void) {
      plugin.listeners.push(listener)
    },
    palette: () => palette,
    changed: () => changed(plugin),
    on(types: string[], handler: (event: Json) => unknown) {
      plugin.events.push({ types, handler })
    },
    effect: (request: Request, mount?: Json) => effect(plugin, request, mount),
    watch(key: string, request: Request) {
      plugin.retired.delete(key)
      const watch = { type: "watch", id: plugin.id, activation: plugin.activation, key, request }
      if (plugin.setting) plugin.setupWatches.push(watch)
      else send(watch)
    },
    unwatch(key: string) {
      plugin.snapshots.delete(key)
      plugin.snapshotParts.delete(key)
      plugin.retired.add(key)
      send({ type: "unwatch", id: plugin.id, activation: plugin.activation, key })
    },
    read: (key: string) => plugin.snapshots.get(key),
    readError: (key: string) => plugin.readErrors.get(key),
    invalidate: () => viewAll(plugin),
    cleanup: (cleanup: () => unknown) => cleanUp(plugin, cleanup),
    fetch(request: Json): Promise<Json> {
      // A fetch the host did not take answers no ID, and no reply comes: it ends as a failed reply does. One the host
      // cancels, as the mount that asked for it closed, rejects with an `AbortError`, as a web fetch that is aborted.
      return effect(plugin, { type: "fetch", ...request }).then((id) => {
        if (typeof id !== "number") return { Err: REFUSED }
        return new Promise((resolve, reject) => plugin.replies.set(id, { resolve, reject }))
      })
    },
    pendingFetches: () => plugin.answers.size + plugin.replies.size + plugin.parts.size,
  }
  const base = {
    id: plugin.id,
    options: plugin.options ?? {},
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

// Coalesce changes during setup and render before deciding whether the manifest needs a reload.
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

function announce(plugin: Plugin, manifest: Json, holds: string[]) {
  for (const command of plugin.commands) command.announced = true
  const commands = manifest.commands.map(({ enabled: _, ...command }: Json) => command)
  return JSON.stringify([{ ...manifest, commands }, holds])
}

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

// An async setup may be waiting for a host effect. Flush the pending effects before waiting for setup to
// finish.
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
    taking: new Set(),
    claims: [],
    cleanups: [],
    mounts: new Map(),
    claimMounts: new Map(),
    snapshots: new Map(),
    readErrors: new Map(),
    answers: new Map(),
    replies: new Map(),
    parts: new Map(),
    snapshotParts: new Map(),
    answerParts: new Map(),
    retired: new Set(),
    batch: 0,
    listening: {},
    listeners: [],
    afterCall: [],
  }
}

// Describe can import a module without activating it. Reuse that import for setup.
const described = new Map<number, Plugin>()

// Describe imports without running setup, including for disabled plugins.
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

// Seed reads needed during setup before watches can deliver a snapshot.
function seeded(plugin: Plugin, seed?: Json) {
  for (const [key, value] of Object.entries(seed ?? {})) plugin.snapshots.set(key, value)
  return plugin
}

function forget(target: string) {
  for (const [seq, plugin] of described) if (plugin.target === target) described.delete(seq)
  for (const [id, plugin] of plugins) {
    if (plugin.target !== target) continue
    if (plugin.active) within(plugin, () => deactivate(plugin))
    plugins.delete(id)
  }
}

// Run cleanup immediately if its activation already ended.
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
  // Reject pending work when its activation ends.
  for (const resolvers of plugin.answers.values()) for (const resolve of resolvers) resolve(undefined)
  plugin.answers.clear()
  for (const reply of plugin.replies.values()) reply.resolve({ Err: "the plugin's activation ended" })
  plugin.replies.clear()
  plugin.parts.clear()
  plugin.snapshotParts.clear()
  plugin.answerParts.clear()
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
  // Hand the key back when a command or listener fails.
  const keyed = request.type === "command" || (request.type === "input" && request.event?.type === "key" && !request.event.bind)
  if (!plugin.active || plugin.failed) return send({ type: "done", seq, ...(keyed ? { declined: true } : {}) })
  plugin.callEffects = []
  plugin.callMounts = []
  plugin.callMount = request.type === "input" && request.to?.type === "surface" ? request.to.mount : undefined
  plugin.resolvers = []
  let error: string | undefined
  let result: unknown
  try {
    if (request.type === "command") {
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
    for (const run of plugin.afterCall) run()
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
    return send({ type: "done", seq, error, ...(keyed ? { declined: true } : {}) })
  }
  if (effects.length) plugin.answers.set(`c${seq}`, resolvers)
  // The answer comes once the views the call made due were sent: it is the call's completion, which the host times. A
  // command that returned `false` declined (TS's "return false to continue"), and so did a listener that did not answer
  // "consume" (TS's `preventDefault`, contract gaps 2): the host routes the key on.
  viewAll(plugin)
  const declined = keyed && (request.type === "command" ? result === false : result !== "consume")
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
      for (const known of plugins.values())
        if (known.active) within(known, () => known.listeners.forEach((listener) => listener("theme")))
      return
    case "deactivate":
      if (plugin) within(plugin, () => deactivate(plugin))
      return
    case "call":
      if (!plugin) return send({ type: "done", seq: message.seq })
      if (message.route !== undefined) plugin.snapshots.set("route", message.route)
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
    // Coalesce claim revisions while a tree is in flight.
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
      // Pass focus and mount state to the replacement during registration handover.
      if (plugin && mount)
        within(plugin, () => plugin.surfaces[mount.surface]?.unmount?.(mount.id, !!message.handover, message.focused))
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
    case "snapshot-part": {
      if (!plugin || plugin.retired.has(message.key)) return
      const parts = plugin.snapshotParts.get(message.key) ?? []
      parts.push(Buffer.from(message.data, "base64"))
      plugin.snapshotParts.set(message.key, parts)
      return
    }
    case "snapshot":
      if (!plugin || plugin.retired.has(message.key)) return
      // Join only snapshot fragments that belong to a live watch.
      if (message.parted) {
        const parts = plugin.snapshotParts.get(message.key)
        try {
          message.value = JSON.parse(Buffer.concat(parts ?? []).toString())
        } catch {
          message.error = "the read's parts are not whole"
        }
      }
      plugin.snapshotParts.delete(message.key)
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
      if (reply) within(plugin, () => reply.reject(cancelled()))
      return
    }
    case "answered-part": {
      if (!plugin || !plugin.answers.has(message.key)) return
      const parts = plugin.answerParts.get(message.key) ?? []
      parts.push(Buffer.from(message.data, "base64"))
      plugin.answerParts.set(message.key, parts)
      return
    }
    case "answered": {
      const waiting = plugin?.answers.get(message.key)
      plugin?.answers.delete(message.key)
      const parts = plugin?.answerParts.get(message.key)
      plugin?.answerParts.delete(message.key)
      let results: Json[] = message.results
      let dropped = new Set<number>(message.dropped ?? [])
      if (message.parted) {
        try {
          results = JSON.parse(Buffer.concat(parts ?? []).toString())
        } catch {
          results = []
          dropped = new Set((waiting ?? []).map((_, index) => index))
        }
      }
      if (plugin && waiting)
        within(plugin, () =>
          waiting.forEach((resolve, index) => resolve(dropped.has(index) ? undefined : results[index])),
        )
      return
    }
    case "ping": {
      const waiting = [...plugins.values()].some(
        (plugin) =>
          [...plugin.mounts.values()].some((mount) => mount.inflight || mount.dirty) ||
          [...plugin.claimMounts.values()].some((mount) => mount.inflight || mount.dirty),
      )
      return send({ type: "pong", seq: message.seq, waiting, retiring: retiring > 0 })
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
killAll(process.pid)
