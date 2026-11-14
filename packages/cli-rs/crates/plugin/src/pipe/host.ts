// The JS host of opencode-native's pipe carrier (rich-plugins synthesis 3.7 and 4.3, phase P7). One Bun process runs
// every TypeScript TUI plugin and speaks contract 2.0 with the client over its standard streams: frames of a length
// (u32, little-endian), a kind byte (0 control, 1 tree) and JSON. The client embeds this file and runs it; it is not a
// module plugins import.
//
// What it gives a plugin is a `{ id, setup }` module's setup context: the part of the V2 TUI context that maps onto
// the contract without Solid (options, app, theme mode, `keymap.layer` commands, `ui.toast`, `data.on`), and under
// `Symbol.for("opencode.carrier")` the carrier itself, which the V2 compatibility layer (P8) builds the rest on:
// surfaces whose views return contract trees, effects, and reads the host pushes as snapshots.
//
// The rules it keeps:
// - Standard output is the protocol. Before any plugin loads, `console` and `process.stdout` write to standard error.
// - Every host message with a sequence is acknowledged on receipt, apart from the work it asks for. A sequence seen
//   again is dropped; one that skips or goes back breaks the stream, and the process exits.
// - A handler's effects are its call's: a handler that throws has none, and its plugin is called no more.
// - A mount has at most one tree in flight: the next waits until the host adopted or refused the last.
// - The process exits when its input ends.

import path from "node:path"
import { existsSync, readFileSync } from "node:fs"

const MAGIC = "opencode-js-host"
const VERSION = 1
const CONTROL = 0
const TREE = 1

// Standard output is the protocol's alone (review F4).
const sink = Bun.stdout.writer({ highWaterMark: 1 << 20 })
const stderr = (text: string) => process.stderr.write(text.endsWith("\n") ? text : text + "\n")
for (const level of ["log", "info", "warn", "error", "debug", "trace"] as const) {
  console[level] = (...args: unknown[]) => stderr(args.map((arg) => (typeof arg === "string" ? arg : Bun.inspect(arg))).join(" "))
}
process.stdout.write = ((chunk: unknown) => {
  stderr(typeof chunk === "string" ? chunk : Buffer.from(chunk as Uint8Array).toString())
  return true
}) as typeof process.stdout.write

function frame(kind: number, message: unknown) {
  const body = Buffer.from(JSON.stringify(message))
  const head = Buffer.alloc(5)
  head.writeUInt32LE(body.length, 0)
  head[4] = kind
  sink.write(head)
  sink.write(body)
  sink.flush()
}
const send = (message: unknown) => frame(CONTROL, message)

type Json = any
type Request = { type: string; [field: string]: Json }

interface Command {
  name: string
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
  onScroll?: (event: Json) => unknown
  view: (cx: ViewContext) => Json
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
  events: Array<{ types: string[]; handler: (event: Json) => unknown }>
  surfaces: Surface[]
  cleanups: Array<() => unknown>
  mounts: Map<string, Mount>
  snapshots: Map<string, Json>
  answers: Map<string, Array<(value: Json) => void>>
  replies: Map<number, (result: Json) => void>
  batch: number
}

const plugins = new Map<string, Plugin>()
let last = 0

function mountKey(id: Json) {
  return `${id.surface}\u0000${id.key}\u0000${id.generation}`
}

function fail(plugin: Plugin, error: string) {
  if (plugin.failed) return
  plugin.failed = true
  plugin.active = false
  send({ type: "fail", id: plugin.id, error })
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
    send({ type: "effects", id: plugin.id, seq, effects: [request] })
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
  const given: Array<[number, Json]> = []
  const released: number[] = []
  const cx: ViewContext = {
    input: { ...mount.input, full: mount.whole },
    mount: mount.id,
    memo(key, value, build) {
      const text = JSON.stringify(value) ?? "undefined"
      used.set(key, text)
      if (!mount.whole && mount.memo.get(key) === text) return { type: "keep", key }
      // The subtree takes the key as its id, as the Rust SDK's memo gives it.
      const node = build()
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
  try {
    node = surface.view(cx)
  } catch (error) {
    fail(plugin, `view threw: ${message(error)}`)
    return
  }
  const text = JSON.stringify(node)
  if (!mount.whole && text === mount.last && given.length === 0 && released.length === 0) return
  mount.rev += 1
  mount.inflight = true
  mount.staged = used
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
    memo: used.size,
  })
}

function viewAll(plugin: Plugin) {
  for (const mount of plugin.mounts.values()) view(plugin, mount)
}

function context(plugin: Plugin) {
  const commands = (layer: Json) => {
    for (const command of layer?.commands ?? []) {
      const name = command.id ?? `${plugin.id}.inline-${plugin.commands.length}`
      plugin.commands.push({
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
          ...(command.slash?.arguments ? { arguments: true } : {}),
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
      options?: { palette?: boolean; notify?: Json[]; onScroll?: (event: Json) => unknown },
    ) {
      plugin.surfaces.push({
        name,
        place,
        view,
        palette: !!options?.palette,
        notify: options?.notify ?? [],
        onScroll: options?.onScroll,
      })
    },
    command(command: Json, run: (input?: string) => unknown) {
      commands({ commands: [{ ...command, id: command.name, run, bind: command.keybind, slash: command.slash ? { name: command.slash } : undefined }] })
    },
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
    // The plugin's state changed outside a call: its surfaces view again.
    invalidate: () => viewAll(plugin),
    fetch(request: Json): Promise<Json> {
      return effect(plugin, { type: "fetch", ...request }).then(
        (id) => new Promise((resolve) => plugin.replies.set(id, resolve)),
      )
    },
  }
  return {
    options: plugin.options ?? {},
    app: { version: process.env.OPENCODE_VERSION ?? "", channel: process.env.OPENCODE_CHANNEL ?? "" },
    themeMode: "dark",
    keymap: {
      layer(factory: () => Json) {
        commands(factory())
      },
      dispatch(id: string, input?: string) {
        effect(plugin, { type: "dispatch", name: id, input: input ?? null })
      },
    },
    ui: {
      toast: {
        show(options: Json) {
          effect(plugin, {
            type: "toast",
            variant: options.variant ?? "info",
            message: options.message,
            ...(options.title ? { title: options.title } : {}),
          })
        },
      },
    },
    data: {
      on(type: string, handler: (event: Json) => unknown) {
        carrier.on([type], handler)
        return () => {}
      },
    },
    [Symbol.for("opencode.carrier")]: carrier,
  }
}

function manifest(plugin: Plugin) {
  return {
    id: plugin.id,
    commands: plugin.commands.map((command) => command.wire),
    fences: [],
    slots: [],
    routes: [],
    storage: [],
    events: plugin.events.map((event) => event.types),
    surfaces: plugin.surfaces.map((surface) => ({
      name: surface.name,
      place: surface.place,
      ...(surface.palette ? { palette: true } : {}),
      ...(surface.notify.length ? { notify: surface.notify } : {}),
      ...(surface.onScroll ? { on_scroll: true } : {}),
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

async function setup(seq: number, plugin: Plugin) {
  // A setup again (an activation, a changed module, a new JS host) starts from nothing: the last one's cleanups run.
  if (plugin.active) deactivate(plugin)
  plugin.mounts.clear()
  plugin.commands = []
  plugin.events = []
  plugin.surfaces = []
  plugin.cleanups = []
  plugin.setupEffects = []
  plugin.setupWatches = []
  plugin.resolvers = []
  plugin.setting = true
  plugin.failed = false
  plugin.activation = seq
  try {
    const cleanup = await plugin.definition.setup(context(plugin))
    if (typeof cleanup === "function") plugin.cleanups.push(cleanup as () => unknown)
  } catch (error) {
    plugin.setting = false
    plugin.setupEffects = []
    plugin.failed = true
    send({ type: "done", seq, error: `setup threw: ${message(error)}` })
    return
  }
  plugin.setting = false
  plugin.active = true
  const effects = plugin.setupEffects
  plugin.setupEffects = []
  if (effects.length) plugin.answers.set("setup", plugin.resolvers)
  plugin.resolvers = []
  const holds = plugin.commands.filter((command) => command.hold).map((command) => command.name)
  send({ type: "loaded", seq, id: plugin.id, manifest: manifest(plugin), holds, effects })
  for (const watch of plugin.setupWatches.splice(0)) send(watch)
}

async function load(seq: number, target: string, dir: string, options: Json) {
  const entry = resolveEntry(dir)
  if (!entry) return send({ type: "unsupported", seq })
  let module: Json
  try {
    module = await import(entry)
  } catch (error) {
    return send({ type: "done", seq, error: `cannot load ${target}: ${message(error)}` })
  }
  const definition = module?.default
  if (!definition || typeof definition.id !== "string" || !definition.id || typeof definition.setup !== "function")
    return send({ type: "done", seq, error: `Invalid V2 TUI plugin module: ${target}` })
  const known = plugins.get(definition.id)
  if (known && known.target !== target)
    return send({ type: "done", seq, error: `plugin ID ${definition.id} is already registered` })
  const plugin: Plugin = known ?? {
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
    events: [],
    surfaces: [],
    cleanups: [],
    mounts: new Map(),
    snapshots: new Map(),
    answers: new Map(),
    replies: new Map(),
    batch: 0,
  }
  Object.assign(plugin, { definition, options, dir })
  plugins.set(plugin.id, plugin)
  await setup(seq, plugin)
}

function deactivate(plugin: Plugin) {
  plugin.active = false
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
      result = plugin.events[request.handler]?.handler(request.event)
    } else if (request.type === "scrolled") {
      result = plugin.surfaces[request.surface]?.onScroll?.(request.event)
    } else if (request.type === "reply") {
      const reply = plugin.replies.get(request.id)
      plugin.replies.delete(request.id)
      reply?.(request.result)
    }
    if (result instanceof Promise) result.catch((error) => fail(plugin, `${request.type} rejected: ${message(error)}`))
  } catch (thrown) {
    const call = { command: "run-command", scrolled: "on-scroll" }[request.type as string] ?? `on-${request.type}`
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
  send({ type: "done", seq, effects })
  viewAll(plugin)
}

const work: Json[] = []
let running = false

async function handle(message: Json) {
  const plugin = message.id ? plugins.get(message.id) : undefined
  switch (message.type) {
    case "hello":
      return
    case "load":
      return load(message.seq, message.target, message.dir, message.options)
    case "activate":
      if (!plugin) return send({ type: "done", seq: message.seq, error: `no plugin ${message.id}` })
      return setup(message.seq, plugin)
    case "deactivate":
      if (plugin && plugin.activation === message.activation) deactivate(plugin)
      return
    case "call":
      if (!plugin) return send({ type: "done", seq: message.seq, error: `no plugin ${message.id}` })
      return call(message.seq, plugin, message.call)
    case "mount": {
      if (!plugin || !plugin.active) return
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
        next: 1,
        given: [],
        released: [],
      }
      plugin.mounts.set(mount.key, mount)
      return view(plugin, mount)
    }
    case "input": {
      const mount = plugin?.mounts.get(mountKey(message.mount))
      if (!plugin || !mount) return
      mount.input = message.input
      mount.epoch = message.seq
      return view(plugin, mount)
    }
    case "unmount":
      plugin?.mounts.delete(mountKey(message.mount))
      return
    case "adopted": {
      const mount = plugin?.mounts.get(mountKey(message.mount))
      if (!plugin || !mount || message.rev !== mount.rev || !mount.inflight) return
      mount.adopted = message.rev
      mount.inflight = false
      mount.whole = false
      mount.memo = mount.staged ?? new Map()
      mount.staged = undefined
      if (mount.dirty) view(plugin, mount)
      return
    }
    case "refused": {
      const mount = plugin?.mounts.get(mountKey(message.mount))
      if (!plugin || !mount || message.rev !== mount.rev) return
      mount.adopted = message.adopted
      mount.inflight = false
      mount.whole = true
      mount.memo = new Map()
      mount.staged = undefined
      mount.last = undefined
      return view(plugin, mount)
    }
    case "snapshot":
      if (!plugin) return
      plugin.snapshots.set(message.key, message.value)
      if (plugin.active && !plugin.failed) viewAll(plugin)
      return
    case "answered": {
      const waiting = plugin?.answers.get(message.key)
      plugin?.answers.delete(message.key)
      waiting?.forEach((resolve, index) => resolve(message.results[index]))
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
    if (message.type === "hello") last = message.after ?? 0
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
process.exit(0)
