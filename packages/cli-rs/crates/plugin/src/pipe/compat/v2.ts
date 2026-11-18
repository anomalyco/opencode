// The V2 TUI plugin context (`@opencode/plugin/tui`'s `Context`) on the JS host (P8, O-128): what a `{ id, setup }`
// module of today's TS client gets, built on the pipe carrier. Slots, routes and the session panel are contract 2.0
// surfaces whose views read a Solid tree (`render.ts`); `data` and the small reads are snapshots the host pushes for
// what the plugin watches; the verbs are the carrier's effects; `client` is the generated client over the host's fetch.
//
// TS reads its store synchronously. Here a read the host has not pushed yet is empty, so a mount whose first render
// read one renders again once it came (at most a few times): a plugin installed from npm, whose JSX Bun compiles
// without Solid's compiler, reads its data once, as it mounts.
//
// What does not map is reported as TS reports what is unavailable: an API that answers whether it did returns false,
// an intrinsic or a hook the contract has no place for throws in the render and the plugin's boundary reports it, and
// the rest warns once in the client's log, by the plugin's name, and does nothing. Each is listed by `reported`. A
// warning is no toast: one covered the plugin's own surface for as long as it showed (`P.8/file-browser`'s field focus).
import {
  batch,
  createComponent,
  createContext,
  createComputed,
  createEffect,
  createRoot,
  createSignal,
  getListener,
  getOwner,
  onCleanup,
  runWithOwner,
  untrack,
} from "solid-js"
import { createStore, produce, reconcile, unwrap } from "solid-js/store"
import { EventEmitter } from "node:events"
import { homedir } from "node:os"
import { OpenCode } from "../../../../../../client/src/promise/generated/index"
import { RGBA, hexToRgb, infoStringToFiletype } from "./core"
import { eventTypes } from "./events.gen"
import { rendererMethods, rendererPromises } from "./opentui.gen"
import { FenceRenderable } from "./renderables"
import {
  claimTree,
  idOf,
  missing,
  mount,
  rootOf,
  serialize,
  type Focus,
  type Mounted,
  type Screen,
  type Scrolls,
  VNode,
} from "./render"

type Json = any

// The methods of an event emitter, which return it.
const EMITTER = new Set<string | symbol>([
  "on",
  "off",
  "once",
  "addListener",
  "removeListener",
  "prependListener",
  "prependOnceListener",
  "removeAllListeners",
  "setMaxListeners",
])

// A hue's steps, and an action's states in the order TS's `state` asks them (`@opencode/theme`'s `HueStep`, `ActionState`).
const STEPS = [100, 200, 300, 400, 500, 600, 700, 800, 900]
const STATES = ["disabled", "pressed", "focused", "selected", "hovered"]
// The fields whose events the layer maps, and the bytes OpenTUI's key event carries for a named key.
const FIELDS = new Set(["input", "textarea"])
const SEQUENCES: Record<string, string> = { return: "\r", escape: "\x1b", tab: "\t", backspace: "\x7f", space: " " }

// How long a mount that ended waits for the mount that begins it again after a reload of the registrations, as long
// as the JS host keeps a command a component's end retired (`host.ts` `UNCOMMAND`).
const REMOUNT = 250

// The footer actions a select maps (TS `actions`); each is a command the plugin registers once, so a select with more
// keeps the first and the rest are reported.
const SELECT_ACTIONS = 4

// A keymap layer's commands as the layer last registered them, its `target`, and whether its component ended.
interface Registration {
  retired: boolean
  // The layer's own `enabled`, a value or a function: a disabled layer's commands are disabled (contract ergonomics
  // 2.5).
  enabled?: unknown
  commands: Map<string, Json>
  // What the host is to hold each of its commands: its `enabled` as the layer follows it, or enabled where the layer
  // cannot follow it, as the command's run asks it then (carbon ce-2).
  states: Map<string, boolean>
  target?: () => unknown
  mode?: string
}

// Whether `node` is `target` or inside it.
function within(target: unknown, node: VNode | undefined): boolean {
  for (let at = node; at; at = at.parent) if (at === target) return true
  return false
}

// The carrier the JS host gives each plugin (`host.ts`).
export interface Carrier {
  // Its index in the manifest.
  surface(name: string, place: Json, view: (cx: Json) => Json, options?: Json): number | void
  // A key layer of the activation, contract 2.0's `Setup::layer`, whose handler hears its events; its index.
  layer?(layer: Json, handler: (event: Json) => unknown): number | void
  // cg2-1: whether a listener of every key can take a key now, which the host holds for the answer only then.
  taking?(listener: Json, on: boolean): void
  command(command: Json, run: (input?: string) => unknown): void
  // Contract ergonomics 2.5: the host holds command `name` enabled or not (`set-enabled`).
  enable?(name: string, enabled: boolean): void
  // Runs `run` at the end of each call into the plugin, inside it: what it asks for is the call's.
  afterCall?(run: () => void): void
  uncommand(name: string): void
  storage(keys: string[]): void
  on(types: string[], handler: (event: Json) => unknown): void
  // A request of `mount` (a field's focus, of the mount whose tree holds it) goes as that mount's.
  effect(request: Json, mount?: Json): Promise<Json>
  watch(key: string, request: Json): void
  unwatch(key: string): void
  read(key: string): Json
  // Why the read `key` watches is nothing, when the host could not answer it.
  readError?(key: string): string | undefined
  // Runs `cleanup` as the plugin's activation ends.
  cleanup?(cleanup: () => unknown): void
  listen(listener: (key: string) => void): void
  invalidate(): void
  fetch(request: Json): Promise<Json>
  palette(): { mode: string; colors: Record<string, string> }
  changed(): void
  // A renderer claim (contract 2.x, step D): `view` draws a part of `target`, a whole tree each time, or declines
  // (`null`); a throw falls the part back. The returned function ends the claim.
  claim?(target: Json, view: (part: Json) => Json): () => void
}

export interface Base {
  id: string
  options: Json
  app: { version: string; channel: string }
  readonly themeMode: string
  data: { on(type: string, handler: (event: Json) => unknown): () => void }
}

// Every feature a plugin used that does not map, by plugin.
export const reported = new Map<string, Set<string>>()

// What `usePlugin()` reads in a plugin's components: its context, as TS provides it around each render.
export const PluginContext = createContext<unknown>()

export function context(base: Base, carrier: Carrier) {
  const id = base.id
  const unsupported = (feature: string, message = `${id}: ${feature} is not supported by opencode-native yet`) => {
    const seen = reported.get(id) ?? new Set()
    reported.set(id, seen)
    if (seen.has(feature)) return
    seen.add(feature)
    void carrier.effect({ type: "log", level: "warn", message })
  }

  // Contract 2.x, step D: the code blocks the plugin renders, by filetype, and one part's tree. The renderer gets the
  // fence as OpenTUI's Markdown gives it (`token`: `lang`, `text`, `raw`) and a context whose `defaultRender()` is the
  // host's own code view of it. It returns a renderable the layer built (`renderables.ts`), or nothing to decline. What
  // the layer reports, and a throw's toast, go once its view returned: a claim's view asks the host for nothing.
  const codeBlocks = new Set<string>()
  const codeBlock = (language: string, render: (token: Json, context: Json) => unknown, part: Json) => {
    const info = String(part.info ?? "")
    const raw = "```" + info + "\n" + String(part.code ?? "") + (part.closed ? "\n```" : "")
    const token = { type: "code", raw, lang: info.trim() || undefined, text: String(part.code ?? "") }
    const context = { conceal: true, concealCode: false, defaultRender: () => new FenceRenderable() }
    let drawn: unknown
    try {
      drawn = render(token, context)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      queueMicrotask(() => {
        void carrier.effect({ type: "toast", variant: "error", title: "Plugin", message: `${id} crashed in code block ${language}: ${message}` })
      })
      throw error
    }
    if (drawn === undefined || drawn === null) return null
    if (!(drawn instanceof VNode)) {
      queueMicrotask(() => unsupported("a code block's renderable built outside @opentui/core's classes"))
      return null
    }
    const dropped = new Set<string>()
    const tree = claimTree(drawn, {
      press: () => {
        dropped.add("a click in a code block")
        return undefined
      },
      dropped,
    })
    if (dropped.size) queueMicrotask(() => dropped.forEach((feature) => unsupported(feature)))
    return tree
  }

  // Reads: a watch per key, a signal per key that a snapshot bumps, and whether the render that runs read one the host
  // has not pushed yet. The host watches at most 128 reads a plugin (bigboi P8-2, FT-9): a read a live mount made is
  // held while the mount lives, and a store's while the store does; the rest are idle, and the least recently used of
  // them goes when a new read needs its place, or when more than 16 are idle. A store's read let go came back at its
  // next snapshot and let another go: 80 stores sent 13,000 messages (FT-9). A read the host could not answer is an
  // error, not empty data: `sync` rejects with it, and the plugin's first such error is reported once.
  const WATCHES = 128
  const IDLE = 16
  const versions = new Map<string, ReturnType<typeof createSignal<number>>>()
  const watched = new Map<string, Json>()
  const pushed = new Set<string>()
  const waiters = new Map<string, Array<{ resolve: () => void; reject: (error: Error) => void }>>()
  // The reads of the mount that renders now, or whose input changes.
  let rendering: { pending: boolean; keys: Set<string> } | undefined
  // What each live key layer's `enabled` reads, which stays watched as a mount's reads do: the layer follows it.
  const layered = new Set<{ keys: Set<string> }>()
  const failed = (key: string) => carrier.readError?.(key)
  // Bumped as the theme changes, which the JS host tells as the listened key `theme`.
  const themed = createRoot(() => createSignal(0))
  carrier.listen((key) => {
    if (key === "theme") return themed[1]((count) => count + 1)
    pushed.add(key)
    const version = versions.get(key)
    version?.[1]((value) => value + 1)
    const error = failed(key)
    if (error) unsupported(`read ${error}`, `${id}: a read failed: ${error}`)
    for (const waiter of waiters.get(key)?.splice(0) ?? []) {
      if (error) waiter.reject(new Error(`${key}: ${error}`))
      else waiter.resolve()
    }
  })
  const idle = () => {
    const live = new Set([...rendered.values(), ...layered].flatMap((at) => [...at.keys]))
    return [...watched.keys()].filter(
      (key) => !live.has(key) && !key.startsWith("storage:") && !waiters.get(key)?.length,
    )
  }
  const release = (key: string) => {
    watched.delete(key)
    pushed.delete(key)
    carrier.unwatch(key)
  }
  const read = (key: string, request: Json) => {
    let version = versions.get(key)
    if (!version) {
      version = createRoot(() => createSignal(0))
      versions.set(key, version)
    }
    version[0]()
    rendering?.keys.add(key)
    if (watched.has(key)) {
      // Most recently used last.
      watched.delete(key)
      watched.set(key, request)
    } else {
      const free = idle()
      if (watched.size >= WATCHES && free.length) release(free[0]!)
      watched.set(key, request)
      carrier.watch(key, request)
      for (const key of idle().slice(0, Math.max(0, idle().length - IDLE))) release(key)
    }
    if (!pushed.has(key) && rendering) rendering.pending = true
    return carrier.read(key)
  }
  const synced = (key: string, request: Json) =>
    new Promise<void>((resolve, reject) => {
      untrack(() => read(key, request))
      const error = failed(key)
      if (pushed.has(key) && error) return reject(new Error(`${key}: ${error}`))
      if (pushed.has(key)) return resolve()
      waiters.set(key, [...(waiters.get(key) ?? []), { resolve, reject }])
    })

  const sessions = (): Json[] => read("sessions", { type: "sessions" }) ?? []
  // A session and whether it runs, from the one read of every session the host has loaded: the host answers a
  // session's own read from the same store and loads nothing for it (`Read::session`), so a read a session would only
  // churn the bounded watches, a watch and a release for each ID past them. opencode-sesh asks the status of each of
  // 900 listed sessions in one pass: 1,800 messages, which flooded the host (CT-36). Indexed once a snapshot.
  // A session missing from it is read from its own read where there is one: the route's session seeded at setup, and
  // one `sync(id)` watches, so what `sync` loaded `get` answers (big-boi's `cg4-9`); one with neither starts none.
  let indexed: { list: Json[]; byID: Map<string, Json> } | undefined
  const session = (sessionID: string): Json => {
    const list = sessions()
    if (indexed?.list !== list) indexed = { list, byID: new Map(list.map((item) => [item.info.id, item])) }
    const own = `session:${sessionID}`
    return (
      indexed.byID.get(sessionID) ??
      (watched.has(own) ? read(own, { type: "session", id: sessionID }) : carrier.read(own)) ??
      undefined
    )
  }
  const info = (): Json => read("info", { type: "info" })
  const locationOf = (location: Json) =>
    location ? { directory: location.directory, workspace: location.workspaceID ?? undefined } : null
  const locationKey = (location: Json) => JSON.stringify(locationOf(location))
  const toRef = (location: Json) =>
    location && { directory: location.directory, ...(location.workspace ? { workspaceID: location.workspace } : {}) }
  const collection = (type: string) => ({
    list: (location?: Json) =>
      read(`${type}:${locationKey(location)}`, { type, location: locationOf(location) }) ?? undefined,
    sync: (location?: Json) => synced(`${type}:${locationKey(location)}`, { type, location: locationOf(location) }),
    invalidate() {},
  })
  const none = (name: string) => ({
    // Reported, and an empty list rather than none, which a plugin would not expect of a list (carbon-4).
    list: () => {
      unsupported(`data.${name}`)
      return []
    },
    sync: async () => unsupported(`data.${name}`),
    invalidate() {},
  })
  const route = (): Json => {
    const value = read("route", { type: "route" })
    if (value?.type === "session") return { type: "session", sessionID: value.id }
    if (value?.type === "plugin") return { type: "plugin", id: value.id, name: value.name, data: routeData.get(value.name) }
    return { type: "home" }
  }
  const routeData = new Map<string, Json>()

  // A collection the contract has no read of, loaded through the plugin's `client` over the host's fetch: as the plugin
  // first lists or syncs it, again on `invalidate`, and again on each event `events` names, which it subscribes to with
  // its first load. A list answers `undefined` until its load came, and its reader follows it.
  // At most 4 loads of a collection run at once, and the others wait their turn, each key once: a load asked for while
  // its key waits is that wait, and one asked for while it loads runs once more after it, so two of a key never overlap
  // and an older answer never comes after a newer one (big-boi's `cg4-11`: a form cancelled came back). A load whose key
  // is asked for again meanwhile publishes nothing, the next does. At most 256 keys wait: past them the oldest waiting
  // gives up its turn, and loads again when it is next listed (`cg4-10`). A plugin that lists the permissions or forms
  // of each of 900 sessions asked 1,800 fetches in one pass, each an effect, past the host's bound on what it has not
  // taken (CT-36: agents-view, op1/threads). Each collection has its own turns: one whose loads hang holds no other.
  const LOADS = 4
  const WAITING = 256
  // `concerns`: whether an event of `events` changes what the entry of `args` holds; an event reloads only those.
  const fetched = (
    events: string[],
    load: (...args: Json[]) => Promise<Json>,
    key = (...args: Json[]) => JSON.stringify(args),
    concerns = (_event: Json, _args: Json[]) => true,
  ) => {
    type Entry = {
      args: Json[]
      value?: Json
      version: ReturnType<typeof createSignal<number>>
      state: "idle" | "waiting" | "loading"
      again: boolean
      settled: Array<() => void>
    }
    const entries = new Map<string, Entry>()
    const waiting: Entry[] = []
    let loading = 0
    let heard = false
    const entry = (args: Json[]) => {
      const at = key(...args)
      const known = entries.get(at)
      if (known) return known
      const made: Entry = { args, version: createRoot(() => createSignal(0)), state: "idle", again: false, settled: [] }
      entries.set(at, made)
      return made
    }
    const settle = (at: Entry) => {
      at.state = "idle"
      for (const done of at.settled.splice(0)) done()
    }
    const next = () => {
      while (loading < LOADS && waiting.length) start(waiting.shift()!)
    }
    const start = (at: Entry) => {
      at.state = "loading"
      at.again = false
      loading++
      load(...at.args)
        .then(
          (value) => {
            if (at.again) return
            at.value = value
            at.version[1]((count) => count + 1)
            invalidate()
          },
          (error) => console.warn(`plugin ${id}: a load of data failed: ${error instanceof Error ? error.message : error}`),
        )
        .finally(() => {
          loading--
          if (at.again) queue(at)
          else settle(at)
          next()
        })
    }
    const queue = (at: Entry) => {
      at.state = "waiting"
      waiting.push(at)
      if (waiting.length > WAITING) settle(waiting.shift()!)
      next()
    }
    const reload = (at: Entry): Promise<void> => {
      if (!heard) {
        heard = true
        for (const type of events)
          base.data.on(type, (event: Json) =>
            entries.forEach((known) => {
              if (concerns(event, known.args)) void reload(known)
            }),
          )
      }
      const done = new Promise<void>((resolve) => at.settled.push(resolve))
      if (at.state === "loading") at.again = true
      else if (at.state === "idle") queue(at)
      return done
    }
    return {
      list(...args: Json[]) {
        const at = entry(args)
        at.version[0]()
        if (at.value === undefined && at.state === "idle") void reload(at)
        return at.value
      },
      sync: (...args: Json[]) => reload(entry(args)),
      invalidate: (...args: Json[]) => void reload(entry(args)),
    }
  }
  const directoryOf = (location?: Json) => (location?.directory ? { directory: location.directory } : undefined)
  const listed = (name: string, events: string[]) =>
    fetched(events, (location?: Json) => (raw as Json)[name].list({ location: directoryOf(location) }).then((out: Json) => out.data), (location?: Json) =>
      locationKey(location),
    )
  // One list of a location's forms, which each session's are of: a list a session refetched the location's whole list
  // for each session (CT-36).
  const locationForms = fetched(
    ["form.created", "form.replied", "form.cancelled"],
    (location?: Json) => raw.form.list({ location: directoryOf(location) }).then((out: Json) => out.data),
    (location?: Json) => locationKey(location),
  )
  // Each location's forms by session, of its list as it is now: one kept for each session pinned a list the location
  // had refreshed (big-boi's `cg4-12`).
  const formIndex = new Map<string, { of: Json[]; bySession: Map<string, Json[]>; none: Json[] }>()
  const forms = {
    list(sessionID: string, location?: Json) {
      const of = locationForms.list(location)
      if (of === undefined) return undefined
      const at = locationKey(location)
      let index = formIndex.get(at)
      if (index?.of !== of) {
        const bySession = new Map<string, Json[]>()
        for (const form of of) bySession.set(form.sessionID, [...(bySession.get(form.sessionID) ?? []), form])
        index = { of, bySession, none: [] }
        formIndex.set(at, index)
      }
      return index.bySession.get(sessionID) ?? index.none
    },
    sync: (_sessionID: string, location?: Json) => locationForms.sync(location),
    invalidate: (_sessionID: string, location?: Json) => locationForms.invalidate(location),
  }
  const shells = listed("shell", ["shell.created", "shell.exited", "shell.deleted"])
  const projects = fetched(["project.updated"], () => raw.project.list())

  // `data.listen`: every event, as `{ details }`, through one subscription of the plugin to every type the client names,
  // made with its first listener.
  const everything = new Set<(event: Json) => unknown>()
  let subscribed = false
  const data = {
    on: base.data.on,
    listen(handler: (event: Json) => unknown) {
      everything.add(handler)
      if (!subscribed) {
        subscribed = true
        carrier.on(eventTypes, (event) => {
          for (const listener of [...everything]) listener({ details: event })
        })
        carrier.changed()
      }
      return () => void everything.delete(handler)
    },
    session: {
      list: () => sessions().map((item) => item.info),
      get: (sessionID: string) => session(sessionID)?.info,
      root(sessionID: string) {
        let at = sessionID
        for (let depth = 0; depth < 64; depth++) {
          const parent = session(at)?.info?.parentID
          if (!parent) return at
          at = parent
        }
        return at
      },
      family: (sessionID: string): string[] =>
        (read(`family:${sessionID}`, { type: "family", id: sessionID })?.members ?? []).map((member: Json) => member.id),
      cost: (sessionID: string): number => read(`family:${sessionID}`, { type: "family", id: sessionID })?.cost ?? 0,
      status: (sessionID: string) => (session(sessionID)?.status === "running" ? "running" : "idle"),
      // The session's inbox items not delivered yet, as the host holds them (bigboi P8-6).
      pending: {
        list: (sessionID: string) => read(`pending:${sessionID}`, { type: "pending", id: sessionID }) ?? [],
        sync: (sessionID: string) => synced(`pending:${sessionID}`, { type: "pending", id: sessionID }),
        invalidate() {},
      },
      sync: (sessionID: string) => synced(`session:${sessionID}`, { type: "session", id: sessionID }),
      invalidate() {},
      message: {
        list: (sessionID: string) => read(`messages:${sessionID}`, { type: "messages", id: sessionID }) ?? [],
        get: (sessionID: string, messageID: string) =>
          (read(`messages:${sessionID}`, { type: "messages", id: sessionID }) ?? []).find(
            (message: Json) => message.id === messageID,
          ),
        sync: (sessionID: string) => synced(`messages:${sessionID}`, { type: "messages", id: sessionID }),
        invalidate() {},
      },
      permission: fetched(
        ["permission.asked", "permission.replied"],
        (sessionID: string) => raw.permission.list({ sessionID }),
        undefined,
        (event: Json, [sessionID]: Json[]) => event?.data?.sessionID === undefined || event.data.sessionID === sessionID,
      ),
      form: {
        ...forms,
        reply: async (input: Json, location?: Json) => {
          await raw.session.form.reply(input)
          forms.invalidate(input.sessionID, location)
        },
        cancel: async (input: Json, location?: Json) => {
          await raw.session.form.cancel(input)
          forms.invalidate(input.sessionID, location)
        },
      },
    },
    project: {
      ...projects,
      list: () => projects.list() ?? [],
      get: (projectID: string) => (projects.list() ?? []).find((project: Json) => project.id === projectID),
      permission: none("project.permission"),
    },
    shell: {
      ...shells,
      list: (location?: Json) => shells.list(location) ?? [],
      get: (shellID: string) => (shells.list() ?? []).find((shell: Json) => shell.id === shellID),
    },
    location: {
      // The directory the client works in, which the JS host does not start in (carbon-1).
      default: () => toRef(info()?.location) ?? { directory: process.env.OPENCODE_DIRECTORY ?? process.cwd() },
      sync: async () => {},
      invalidate() {},
      vcs: {
        info: (location?: Json) =>
          read(`vcs:${locationKey(location)}`, { type: "vcs", location: locationOf(location) }) ?? undefined,
        sync: (location?: Json) => synced(`vcs:${locationKey(location)}`, { type: "vcs", location: locationOf(location) }),
        invalidate() {},
      },
      agent: listed("agent", ["agent.updated"]),
      command: listed("command", ["command.updated"]),
      integration: collection("integrations"),
      mcp: { server: collection("mcp-servers"), resource: none("location.mcp.resource") },
      model: collection("models"),
      provider: {
        list: () => read("providers", { type: "providers" }) ?? undefined,
        sync: () => synced("providers", { type: "providers" }),
        invalidate() {},
      },
      reference: listed("reference", ["reference.updated"]),
      skill: listed("skill", ["skill.updated"]),
    },
  }

  // The theme, from the host's palette: each leaf a color that carries its token, so the host restyles it. A hue's step
  // carries the contract's name of it (`accent.500`, `categorical.3.300`), as the palette's `hue.accent.500` is not one.
  // A raised surface's view (`surface`, CT-22) takes the colors the palette lists for it (`@dialog.<token>`,
  // `@dialog.footer.<token>`) where they differ from the page's: such a leaf carries its color, as the contract names
  // no token of a raised surface, and the others their page token.
  const theme = (surface?: string): Json => {
    const palette = carrier.palette()
    const raised: Record<string, Record<string, string>> = {}
    const page: Array<[string, string]> = []
    for (const [token, hex] of Object.entries(palette.colors)) {
      const on = token.startsWith("@dialog.footer.") ? "dialog.footer" : token.startsWith("@dialog.") ? "dialog" : undefined
      if (on) (raised[on] ??= {})[token.slice(on.length + 2)] = hex
      else page.push([token, hex])
    }
    const tree: Json = {}
    for (const [token, hex] of page.sort(([a], [b]) => a.length - b.length)) {
      const parts = token.split(".")
      let at = tree
      for (const part of parts.slice(0, -1)) {
        if (!(part in at)) at[part] = {}
        at = at[part]
      }
      const last = parts[parts.length - 1]!
      const own = surface === undefined ? undefined : raised[surface]?.[token]
      const value = hexToRgb(own ?? hex)
      const named = own !== undefined ? undefined : parts[0] === "hue" ? parts.slice(1).join(".") : token
      const rgba = new RGBA(value.r, value.g, value.b, value.a, named)
      at[last] = Object.assign(rgba, typeof at[last] === "object" ? at[last] : {})
    }
    // CT-9: the raw scales and the state functions of TS's `ResolvedTheme`. The categorical scales are a list, and a
    // stateful color (an action's or a field's) answers the first state set in TS's order.
    tree.hue ??= {}
    tree.categorical = Object.entries(tree.categorical ?? {})
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([, scale]) => scale)
    const stateful = (color: Json) => {
      if (!color || typeof color !== "object") return
      if ("base" in color && "hovered" in color)
        color.state = (states: Json) => color[STATES.find((state) => states?.[state]) ?? "base"]
      else for (const value of Object.values(color)) if (!(value instanceof RGBA)) stateful(value)
    }
    for (const side of [tree.text, tree.background]) {
      stateful(side?.action)
      stateful(side?.formfield)
    }
    // Where a color sits on a hue: by its step's token, else by its value among the named hues, as TS's matches a
    // token read from a step (the Rust theme's `source` does the same by value).
    const scales = Object.entries(tree.hue as Record<string, Json>)
    const source = (color: Json) => {
      if (!(color instanceof RGBA)) return undefined
      for (const [hue, scale] of scales)
        for (const step of STEPS) {
          const at = scale[step]
          if (at && (at.token === color.token || (at.r === color.r && at.g === color.g && at.b === color.b && at.a === color.a)))
            return { hue, step }
        }
      return undefined
    }
    const shift = (color: Json, amount: number) => {
      const at = source(color)
      if (!at) return color
      const offset = Number.isFinite(amount) ? Math.trunc(amount) : 0
      const position = Math.max(0, Math.min(STEPS.length - 1, STEPS.indexOf(at.step) + offset))
      return tree.hue[at.hue][STEPS[position]!]
    }
    tree.source = source
    tree.increase = (color: Json, amount = 1) => shift(color, amount)
    tree.decrease = (color: Json, amount = 1) => shift(color, -amount)
    // A raised surface's theme (`ResolvedTheme.surface`, CT-8, CT-22): `dialog` and `dialog.footer` as the host
    // resolves them; another name is the page's, which the JS host's log says once, where a toast covered the plugin's
    // page (the joe-broadhead status dialogs).
    tree.surface = (name: string) => {
      if (name === "dialog" || name === "dialog.footer") return theme(name)
      if (!surfaces.has(name)) console.warn(`plugin ${id}: theme.surface("${name}") is the page theme`)
      surfaces.add(name)
      return tree
    }
    return tree
  }
  const surfaces = new Set<string>()

  // Internal commands: a click on a node, a dialog's answer, and its close. The host runs a dialog's action with the
  // answer as its input, and one dialog shows at a time. A click's handler is its mount's (`presses`, by the mount, then
  // by the node): a view replaces its mount's, and an unmount or a close drops them (bigboi P8-8).
  const presses = new Map<string, Map<string, { handler: (event: unknown) => unknown; kind: string }>>()
  let answering: ((value: string | undefined) => void) | undefined
  let asked = 0
  const PRESS = `${id}.compat.press`
  const ANSWER = `${id}.compat.answer`
  const DISMISS = `${id}.compat.dismiss`
  // The host closed a showing of `ui.dialog.show`, or did not open it (input: its key).
  const UNSHOWN = `${id}.compat.unshown`
  const QUERY = `${id}.compat.query`
  // The search of the select on screen, which the host tells each query.
  let searching: ((query: string) => void) | undefined
  carrier.command({ name: PRESS, title: PRESS }, (input) => {
    const [mount, node] = (input ?? "").split("\u0001")
    const pressed = presses.get(mount ?? "")?.get(node ?? "")
    const event = { type: pressed?.kind, button: 0, modifiers: { shift: false, alt: false, ctrl: false } }
    pressed?.handler({ ...event, stopPropagation() {}, preventDefault() {} })
  })
  carrier.command({ name: QUERY, title: QUERY }, (input) => searching?.(input ?? ""))
  // A select's footer actions (TS `actions`): the host runs an action's command with the selected row's value, so each
  // action of the select on screen is a command of its own. `triggers` are their handlers, by slot.
  let triggers: ((input: string | undefined) => void)[] = []
  const ACTIONS = Array.from({ length: SELECT_ACTIONS }, (_, slot) => `${id}.compat.action.${slot}`)
  ACTIONS.forEach((name, slot) => carrier.command({ name, title: name }, (input) => triggers[slot]?.(input)))
  carrier.command({ name: ANSWER, title: ANSWER }, (input) => {
    const resolve = answering
    answering = undefined
    resolve?.(input ?? "")
  })
  // The host closed dialog `input` without its answer (escape, the backdrop, another plugin's dialog, an unload): it
  // answers nothing, as TS resolves it with undefined (bigboi P8-7). A close after its answer finds nothing to settle.
  carrier.command({ name: DISMISS, title: DISMISS }, (input) => {
    if (input === String(asked)) settle()
  })
  carrier.command({ name: UNSHOWN, title: UNSHOWN }, (input) => {
    if (shown && input === shown.key) unshow()
  })
  const settle = () => {
    const resolve = answering
    answering = undefined
    resolve?.(undefined)
  }
  // The dialog this one replaces answers nothing, as TS resolves it with undefined. A dialog given as a function is
  // built a microtask later, so a `dialog.set` the plugin calls right after sizes it, as TS's sizes the dialog shown.
  const ask = (dialog: Json | (() => Json)) =>
    new Promise<string | undefined>((resolve) => {
      settle()
      unshow()
      answering = resolve
      asked++
      const dismissed = { type: "command", name: DISMISS, input: String(asked) }
      const mine = asked
      const send = () => {
        // Another dialog came first, or a `clear()` or a `show()` settled this one before it was built: it never shows
        // (carbon c2b-3).
        if (asked !== mine || answering !== resolve) return
        sent = mine
        const asking = { ...(typeof dialog === "function" ? dialog() : dialog), action: { type: "command", name: ANSWER } }
        void carrier.effect({ type: "dialog", dialog: { type: "dismissable", dialog: asking, dismissed } })
      }
      if (typeof dialog === "function") queueMicrotask(send)
      else send()
    })

  // `ui.dialog.show`: the plugin's own JSX as the body of the host's dialog (contract ergonomics 2.7): a mount of the
  // plugin's dialog surface, which renders it with the full tree, so its `<scrollbox>` scrolls and its `<input>` is a
  // field that takes the focus. The host draws only the dialog's frame around it, as TS does; a close of it (escape,
  // the backdrop, another dialog) calls `onClose`, as TS's `dialog.replace` does.
  // Each `show` is a key of its own (carbon-3), which its mount's ID names, so the host tells its open and its close
  // apart from the one it replaced, and the mount renders that show's JSX; a `dialog.set` changes its frame in place.
  const DIALOG = "compat.dialog"
  let shows = 0
  let shown: { key: string; onClose?: () => void; opened: boolean } | undefined
  // The renders of the shows, by their key, until each closes.
  const dialogs = new Map<string, () => unknown>()
  let presentation = { size: "medium", centered: false }
  // The dialog of `ask` the host shows, which a `dialog.set` after it no longer sizes.
  let sent = 0
  // A dialog's size and centering as the contract has them, left out while they are the host's own.
  const presented = () => ({
    ...(["large", "xlarge"].includes(presentation.size) ? { size: presentation.size } : {}),
    ...(presentation.centered ? { centered: true } : {}),
  })
  const unshow = () => {
    const was = shown
    shown = undefined
    if (!was) return
    dialogs.delete(was.key)
    was.onClose?.()
  }
  // Each send waits for its close: one the host did not open (as while its plugin manager shows) retires the showing at
  // once, so a later `dialog.set` does not open it (big-boi ds-11).
  const sendShown = () => {
    if (!shown) return
    const dialog = { type: "surface", surface: DIALOG, key: shown.key, ...presented() }
    const dismissed = { type: "command", name: UNSHOWN, input: shown.key }
    void carrier.effect({ type: "dialog", dialog: { type: "dismissable", dialog, dismissed } })
  }
  // A dialog of the plugin's own ends with its activation, and a dialog it asked answers nothing (carbon-5).
  carrier.cleanup?.(() => {
    settle()
    unshow()
  })
  carrier.listen((key) => {
    if (!shown || key !== `dialog-open:${shown.key}`) return
    const open = carrier.read(key) === true
    if (open) shown.opened = true
    else if (shown.opened) unshow()
  })

  // Surfaces: each mount renders its claim's JSX under a Solid root; its view reads that tree.
  type Rendered = Mounted & { pending: number; input: Json; setInput: (input: Json) => void }
  const rendered = new Map<string, Rendered>()
  const size = createRoot(() => createSignal({ width: 0, height: 0 }))
  // What `useTerminalDimensions` reads: the terminal's size, as the host says it.
  const screen: Screen = {
    width: () => info()?.size?.[0] || size[0]().width,
    height: () => info()?.size?.[1] || size[0]().height,
    renderer: {},
  }
  let claims = 0
  // A change of a tree asks for one view of the plugin's mounts once the code that changed it returned; a change of the
  // mount whose view reads its tree is in that view already, but one of another mount is not (carbon-4).
  let drawing: string | undefined
  let scheduled = false
  const invalidate = (at?: string) => {
    if ((at !== undefined && at === drawing) || scheduled) return
    scheduled = true
    queueMicrotask(() => {
      scheduled = false
      carrier.invalidate()
    })
  }
  // CT-2: the plugin's node that has the focus, as it asked: a field or a scroll is the host's to focus (the contract's
  // `focus` of the node's id); any node emits `focused` and `blurred`, as OpenTUI's renderables do.
  let focusedNode: VNode | undefined
  const FOCUSABLE = new Set(["input", "textarea", "scrollbox"])
  // cg2-1: whether a key handler can take a key, which the host holds a key for the answer for: one whose source
  // calls `preventDefault` says so up front, as TS's runs synchronously and the host cannot wait; one that took a key
  // all the same (through a helper) says so from then on. Any other only hears keys, which go on at once.
  const takers = new WeakSet<object>()
  const mayTake = (handler: unknown) =>
    typeof handler === "function" &&
    (takers.has(handler) || Function.prototype.toString.call(handler).includes("preventDefault"))
  let globalTaking: (() => void) | undefined
  const took = (handler: unknown) => {
    if (typeof handler !== "function" || takers.has(handler)) return
    takers.add(handler)
    taking()
    globalTaking?.()
  }
  // cg2-1: a route's, a panel's or a dialog's listener of every key (by surface name, its index) takes a key only while the field the
  // plugin focused is in its tree and has an `onKeyDown`; the host holds a key for the answer only then, and otherwise
  // the key goes on at once.
  const fieldListeners = new Map<string, number>()
  const taking = () => {
    for (const [surface, index] of fieldListeners) {
      const roots = [...rendered.entries()].filter(([at]) => at.startsWith(`${surface}\u0000`)).map(([, at]) => at.root)
      const on = mayTake(focusedNode?.props.onKeyDown) && roots.some((root) => within(root, focusedNode))
      carrier.taking?.({ surface: index }, on)
    }
  }
  // The mount whose render holds `node`, by its root, as the host names it; none for a node in no mount's tree (one not
  // added yet, or in a dialog of the plugin's own).
  const mountOf = (node: VNode) => {
    const root = rootOf(node)
    for (const [at, entry] of rendered) {
      if (entry.root !== root) continue
      const [surface, key, generation] = at.split("\u0000")
      return { surface, key, generation: Number(generation) }
    }
    return undefined
  }
  const focus: Focus = {
    focus(node) {
      if (focusedNode !== node) focusedNode?.focusChanged(false)
      focusedNode = node
      node.focusChanged(true)
      taking()
      if (!FOCUSABLE.has(node.tag)) return
      // The contract's focus of a field (`focus-input`) or a scroll, as the request of the mount whose tree holds it,
      // whichever call the plugin runs: the host gives it the focus, so what the user types goes into a field, and one
      // its revision has not shown yet takes it once it does. Its keys still come as `onKeyDown`. A node in no mount
      // has no focus on the host.
      const mount = mountOf(node)
      if (mount) void carrier.effect({ type: "focus", node: idOf(node) }, mount)
      else unsupported(`focus() of an <${node.tag}> in no mount`)
    },
    blur(node) {
      if (focusedNode !== node) return
      focusedNode = undefined
      node.focusChanged(false)
      taking()
      const mount = FOCUSABLE.has(node.tag) ? mountOf(node) : undefined
      if (mount) void carrier.effect({ type: "blur" }, mount)
    },
    // A focused node the plugin removed has the focus no more, as OpenTUI's destroyed renderable has not: a target
    // layer no longer holds for it, and it emits `blurred`. The host's field went with its tree.
    detached(node) {
      if (!focusedNode || !within(node, focusedNode)) return
      const was = focusedNode
      focusedNode = undefined
      was.focusChanged(false)
      taking()
    },
  }
  // A field's events (CT-11): its edits and its submit are the contract's `change` and `submit` of its node, which its
  // `onInput`, `onChange` and `onSubmit` hear, and a key while the plugin's focused field is in the surface is its
  // `onKeyDown`, which takes the key with `preventDefault` (contract gaps 2): else the host's field and keys have it.
  const fieldEvent = (surface: string, event: Json) => {
    const roots = [...rendered.entries()].filter(([at]) => at.startsWith(`${surface}\u0000`)).map(([, at]) => at.root)
    const find = (id: string) => {
      const walk = (node: VNode): VNode | undefined =>
        idOf(node) === id && FIELDS.has(node.tag) ? node : node.children.reduce<VNode | undefined>((found, child) => found ?? walk(child), undefined)
      return roots.reduce<VNode | undefined>((found, root) => found ?? walk(root), undefined)
    }
    if (event.type === "key") {
      const node = focusedNode && find(idOf(focusedNode))
      if (node !== focusedNode || !node?.props.onKeyDown) return "pass"
      const key = keyEvent(event)
      const handler = node.props.onKeyDown
      handler(key)
      if (!key.defaultPrevented) return "pass"
      took(handler)
      return "consume"
    }
    const node = (event.type === "change" || event.type === "submit") && find(event.node)
    if (!node) return
    // The user edits it in the host's field, which has the focus then.
    if (focusedNode !== node) {
      focusedNode?.focusChanged(false)
      focusedNode = node
      node.focusChanged(true)
      taking()
    }
    node.typed = event.text
    if (event.type === "change") {
      // Heard once its handler ran: a tree made inside it, before the plugin's value follows, answers the edit before.
      // By the field's id in its mount: a render that reads the value as it makes the field makes a new one each edit,
      // in the handler, which takes the old one out of the mount.
      const root = rootOf(node)
      const answered = node.props.onInput?.(event.text)
      ;(root.seen ??= new Map()).set(event.node, event.seq)
      return answered
    }
    node.props.onChange?.(event.text)
    node.props.onSubmit?.(event.text)
  }
  // An OpenTUI key event of the host's key (`ctrl+shift+a`, `enter`, `space`). A listener takes the key with
  // `preventDefault`, as OpenTUI's renderer then gives it to nothing else (contract gaps 2).
  const keyEvent = (event: Json) => {
    let rest = String(event.key ?? "")
    const held = { ctrl: false, shift: false, meta: false, super: false, hyper: false } as Record<string, boolean>
    for (let at = /^(ctrl|shift|meta|super|hyper)\+(.+)$/.exec(rest); at; at = /^(ctrl|shift|meta|super|hyper)\+(.+)$/.exec(rest)) {
      held[at[1]!] = true
      rest = at[2]!
    }
    const name = rest === "enter" ? "return" : rest
    const sequence = event.text ?? SEQUENCES[name] ?? ""
    let prevented = false
    let stopped = false
    return {
      name,
      ...held,
      option: held.meta,
      sequence,
      raw: sequence,
      number: /^[0-9]$/.test(name),
      eventType: "press",
      source: "raw",
      get defaultPrevented() {
        return prevented
      },
      get propagationStopped() {
        return stopped
      },
      preventDefault() {
        prevented = true
      },
      stopPropagation() {
        stopped = true
      },
    }
  }
  // OpenTUI's key handler (CT-11): an emitter whose `keypress` listeners hear each key, through a global listener layer
  // the plugin registers with its first one, as most plugins never listen. A listener's `preventDefault` takes the key.
  const keyInput = new EventEmitter()
  let listening = false
  keyInput.on("newListener", (name, first) => {
    if (name !== "keypress" || listening || !carrier.layer) return
    listening = true
    const layer = carrier.layer({ scope: "global", any: true }, (event: Json) => {
      if (event.type !== "key") return "pass"
      const key = keyEvent(event)
      const heard = keyInput.listeners("keypress")
      keyInput.emit("keypress", key)
      if (!key.defaultPrevented) return "pass"
      heard.forEach(took)
      return "consume"
    })
    carrier.changed()
    // cg2-1: it takes a key only while a `keypress` listener can ([`mayTake`]); otherwise it only hears the key, which
    // the host lets go on at once.
    if (typeof layer !== "number") return
    const listeners = (added?: unknown) => {
      const on = [...keyInput.listeners("keypress"), added].some(mayTake)
      carrier.taking?.({ layer }, on)
    }
    globalTaking = () => listeners()
    listeners(first)
    keyInput.on("removeListener", (removed) => {
      if (removed === "keypress") listeners()
    })
    keyInput.on("newListener", (added, handler) => {
      if (added === "keypress") listeners(handler)
    })
  })
  // A surface's scrolls (CT-2): a scroll box's state is the host's read of it, which follows it as it moves, and a move
  // is the contract's verb on the scroll of the surface's live mount, by its id.
  const scrollsOf = (surface: string): Scrolls => {
    const target = (node: VNode) => ({ type: "node", surface, id: idOf(node) })
    return {
      state: (node) => read(`scroll:${surface}:${idOf(node)}`, { type: "scroll-state", target: target(node) }) ?? undefined,
      to: (node, offset) => void carrier.effect({ type: "scroll", target: target(node), verb: { type: "offset", offset } }),
      into: (node, child) =>
        void carrier.effect({ type: "scroll", target: target(node), verb: { type: "to", node: child, align: { type: "nearest" } } }),
      rect(node) {
        const key = `rect:${surface}:${idOf(node)}`
        measuring.set(key, node)
        return read(key, { type: "rect", node: idOf(node) }) ?? undefined
      },
    }
  }
  // The nodes whose layout the plugin asked for, by their read: one with `onSizeChange` hears each new layout (CT-24).
  const measuring = new Map<string, VNode>()
  const sizes = new WeakMap<VNode, string>()
  carrier.listen((key) => {
    const node = measuring.get(key)
    if (!node) return
    if (!node.parent) return void measuring.delete(key)
    // As OpenTUI calls it: as the laid-out size changes, on the renderable, whose `width` it may read as `this.width`.
    const rect = node.measure()
    const size = rect && `${rect.width}x${rect.height}`
    if (!size || sizes.get(node) === size) return
    sizes.set(node, size)
    // A plugin may set it on the renderable by its ref rather than as a prop (CT-26: opencode-voice's panel title).
    const handler = node.props.onSizeChange ?? (node as Json).onSizeChange
    if (typeof handler === "function") handler.call(node)
  })
  const surface = (name: string, place: Json, input: (cx: Json) => Json, render: (input: Json) => unknown, where: string) => {
    let removed = false
    const key = (cx: Json) => `${cx.mount.surface}\u0000${cx.mount.key}\u0000${cx.mount.generation}`
    // The mount of a surface and key that ended last, kept for [`REMOUNT`] ms for the mount that begins it again.
    const parked = new Map<string, { entry: Rendered; timer: ReturnType<typeof setTimeout>; focused?: string }>()
    const adopt = (cx: Json) => {
      const slot = `${cx.mount.surface}\u0000${cx.mount.key}`
      const kept = parked.get(slot)
      if (!kept) return undefined
      clearTimeout(kept.timer)
      parked.delete(slot)
      rendered.set(key(cx), kept.entry)
      // The host's focus was the ended mount's: the field the plugin focused in the tree it adopts takes it again in the
      // new one, as TS's renderable never lost it (`P.8/session-manager`'s search, whose keybinds reload as it shows).
      // A focus the user moved off the field before the mount ended stays where the user put it.
      const field = focusedNode
      if (field && kept.focused === idOf(field) && FOCUSABLE.has(field.tag) && rootOf(field) === kept.entry.root)
        void carrier.effect({ type: "focus", node: idOf(field) }, cx.mount)
      return kept.entry
    }
    // As TS's plugin boundary: the render shows nothing from now on, and one toast says why.
    const crashed = (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      void carrier.effect({ type: "toast", variant: "error", title: "Plugin", message: `${id} crashed in ${where}: ${message}` })
    }
    const view = (cx: Json) => {
      if (removed) return { type: "box" }
      const before = drawing
      drawing = key(cx)
      try {
        return draw(cx)
      } finally {
        drawing = before
        // As TS's boundary around a dialog, which clears it: a dialog whose render threw closes (carbon-3).
        if (place.type === "dialog" && rendered.get(key(cx))?.crashed !== undefined) closeCrashed(cx.mount.key)
      }
    }
    const draw = (cx: Json) => {
      if (cx.input.width || cx.input.height) size[1]({ width: cx.input.width, height: cx.input.height })
      missing.clear()
      let entry = rendered.get(key(cx)) ?? adopt(cx)
      if (entry && entry.crashed === undefined && JSON.stringify(entry.input) !== JSON.stringify(input(cx))) {
        entry.input = input(cx)
        const before = rendering
        rendering = { pending: false, keys: entry.keys }
        try {
          entry.setInput(entry.input)
        } finally {
          rendering = before
        }
      }
      // A first render that read what the host has not pushed yet renders again once its own reads came, a few times
      // at most.
      const retry = (at: typeof entry) => !!at && at.pending > 0 && at.pending < 4 && at.crashed === undefined
      if (!entry || (retry(entry) && [...entry.keys].every((key) => pushed.has(key)))) {
        entry?.dispose()
        const tries = entry ? entry.pending : 0
        const value = input(cx)
        const [props, setProps] = createStore(copied(value))
        const reading = { pending: false, keys: new Set<string>() }
        const before = rendering
        rendering = reading
        let mounted: Mounted
        try {
          const provided = () =>
            createComponent(PluginContext.Provider, {
              value: ctx,
              get children() {
                return render(props)
              },
            })
          const at = key(cx)
          mounted = mount(provided, screen, () => invalidate(at), crashed, focus, scrollsOf(name), (feature) => unsupported(feature))
        } finally {
          rendering = before
        }
        mounted.keys = reading.keys
        entry = Object.assign(mounted, {
          pending: reading.pending ? tries + 1 : 0,
          input: value,
          setInput: (next: Json) => setProps(reconcile(copied(next))),
        })
        rendered.set(key(cx), entry)
      }
      if (retry(entry)) return undefined
      entry.root.room = { width: cx.input?.width ?? 0, height: cx.input?.height ?? 0 }
      const reading = pressing(key(cx))
      // What reading the tree reads (where a node is) the mount keeps watching.
      const before = rendering
      rendering = { pending: false, keys: entry.keys }
      try {
        const tree = serialize(entry.root, reading)
        for (const dropped of [...reading.dropped, ...missing]) unsupported(dropped)
        missing.clear()
        // TS renders a route into a column that fills the page, so a `flexGrow` box in it fills the page's height, and
        // a scrollbox in that its rest (ports trio: opencode-session-manager drew no rows). The root fills it here too.
        if (place.type === "route") tree.layout = { ...tree.layout, grow: true }
        taking()
        return tree
      } catch (error) {
        crashed(error)
        entry.crashed = String(error)
        entry.dispose()
        entry.root.children = []
        return { type: "box" }
      } finally {
        rendering = before
      }
    }
    // No palette input: the colors carry their tokens, so a theme change restyles the last tree in place, and the
    // context's `theme` follows `Down::Theme`. A surface that read the palette would be viewed again instead, and keep
    // its old colors, as its tree did not change.
    const index = carrier.surface(name, place, view, {
      // A mount a reload of the registrations ends (`handover`) is kept a moment: the reload begins it again in a later
      // message, and the new mount of the same surface and key adopts it, so its components do not run again. TS takes
      // a registration without a remount; a component that registers anew as it mounts (opencode-navigator names each
      // binding by a count) reloaded without end (CT-21). Any other end ends its components at once.
      unmount(mount: Json, handover?: boolean, focused?: string) {
        // The panel closed: it is no longer the plugin's current one.
        if (place.type === "panel" && !handover) setPanelName("")
        const at = `${mount.surface}\u0000${mount.key}\u0000${mount.generation}`
        const entry = rendered.get(at)
        rendered.delete(at)
        presses.delete(at)
        taking()
        const slot = `${mount.surface}\u0000${mount.key}`
        if (!handover && panelHandles.get(slot)?.mount.generation === mount.generation) panelHandles.delete(slot)
        if (!entry || entry.crashed !== undefined || !handover) return entry?.dispose()
        const before = parked.get(slot)
        if (before) {
          clearTimeout(before.timer)
          before.entry.dispose()
        }
        const timer = setTimeout(() => {
          if (parked.get(slot)?.entry !== entry) return
          parked.delete(slot)
          entry.dispose()
        }, REMOUNT)
        parked.set(slot, { entry, timer, focused })
      },
      on: (event: Json) => fieldEvent(name, event),
      // A route, a panel or a dialog holds the focus, and a field in it: each key while it does comes to the field the
      // plugin focused, as its `onKeyDown`, which takes it or lets it go on.
      ...(["route", "panel", "dialog"].includes(place.type) ? { layers: [{ scope: "surface", any: true }] } : {}),
    })
    if (["route", "panel", "dialog"].includes(place.type) && typeof index === "number") fieldListeners.set(name, index)
    return () => {
      removed = true
      carrier.invalidate()
    }
  }
  const pressIds = new WeakMap<VNode, number>()
  let pressCount = 0
  const pressIndex = (node: VNode) => {
    if (!pressIds.has(node)) pressIds.set(node, ++pressCount)
    return pressIds.get(node)!
  }
  // What a view of `mount` reads its tree with: its click handlers replace the ones its last view gave.
  const pressing = (mount: string) => {
    const handlers = new Map<string, { handler: (event: unknown) => unknown; kind: string }>()
    presses.set(mount, handlers)
    return {
      dropped: new Set<string>(),
      press(node: VNode, handler: (event: unknown) => unknown, kind: string) {
        const at = String(pressIndex(node))
        handlers.set(at, { handler, kind })
        return { type: "command", name: PRESS, input: `${mount}\u0001${at}` }
      },
    }
  }

  // The plugin's dialog surface, which each `ui.dialog.show` mounts under its own key: the mount renders that show's
  // JSX, and nothing once the show closed.
  const closeCrashed = (key: string) => {
    if (shown?.key !== key) return
    void carrier.effect({ type: "dialog", dialog: { type: "close", key } })
    unshow()
  }
  surface(DIALOG, { type: "dialog", name: DIALOG }, (cx) => ({ key: cx.mount.key }), (props: Json) => dialogs.get(props.key)?.(), "dialog")

  const slotInput = (path: string, surface = "") => (cx: Json) => {
    const slot = cx.input.slot ?? {}
    if (path.startsWith("prompt.footer"))
      return {
        ...(slot.session_id ? { sessionID: slot.session_id } : {}),
        mode: slot.prompt?.shell ? "shell" : "normal",
        showDetails: !!slot.prompt?.show_details,
      }
    if (path === "session.panel") {
      const panel = cx.input.panel ?? {}
      return {
        name: panelName(),
        sessionID: slot.session_id ?? "",
        width: panel.width ?? cx.input.width,
        presentation: panel.fullscreen ? "fullscreen" : "panel",
        focused: !!panel.focused,
        ...panelHandle(surface, cx.mount, !!panel.fullscreen).methods,
      }
    }
    if (path.startsWith("sidebar.") || path === "session.composer.top") return { sessionID: slot.session_id ?? "" }
    return {}
  }
  // The panel the plugin opened, until its mount ends: a signal, so what reads `ui.panel.current()` (a key layer's
  // `enabled`, @cleocode/goal's) follows it (carbon ce-2).
  const [panelName, setPanelName] = createRoot(() => createSignal(""))
  const panels: string[] = []
  // CT-38: a session panel's `focus`, `close` and `toggleFullscreen`, as TS's `PanelInput` has them. One handle a panel
  // mount, which each draw tells its mount as it is now and whether it shows full screen: its methods stay the same
  // functions, so a mount adopted after a reload keeps them with its new generation (big-boi's `cg4-14`), and they act
  // only while that mount lives, as its requests, so a handle kept past its panel moves no other (`cg4-13`).
  const panelHandles = new Map<string, { mount: Json; fullscreen: boolean; methods: Json }>()
  const panelHandle = (surface: string, mount: Json, fullscreen: boolean) => {
    const at = `${mount.surface}\u0000${mount.key}`
    let handle = panelHandles.get(at)
    if (!handle) {
      const live = () => {
        const now = panelHandles.get(at)
        const key = now && `${now.mount.surface}\u0000${now.mount.key}\u0000${now.mount.generation}`
        return key && rendered.has(key) ? now : undefined
      }
      handle = {
        mount,
        fullscreen,
        methods: {
          // The contract has no focus of a pane: the panel's first field or scroll that shows takes the focus
          // (`cg4-15`: a hidden one did), which moves the input to the panel as a click in it does.
          focus() {
            const now = live()
            const root = now && rendered.get(`${now.mount.surface}\u0000${now.mount.key}\u0000${now.mount.generation}`)?.root
            if (!root) return
            const first = (node: VNode): VNode | undefined =>
              node.props.visible === false
                ? undefined
                : FOCUSABLE.has(node.tag)
                  ? node
                  : node.children.reduce<VNode | undefined>((found, child) => found ?? first(child), undefined)
            const node = first(root)
            if (node) focus.focus(node)
            else unsupported("panel.focus() of a panel with no field or scroll")
          },
          close() {
            const now = live()
            if (now) void carrier.effect({ type: "close-panel", surface }, now.mount)
          },
          // A toggle of what it asked for last, which the next draw corrects to what shows: two at once go full
          // screen and back, where each asked for full screen (`cg4-16`).
          toggleFullscreen() {
            const now = live()
            if (!now) return
            now.fullscreen = !now.fullscreen
            void carrier.effect({ type: "open-panel", surface, ...(now.fullscreen ? { fullscreen: true } : {}) }, now.mount)
          },
        },
      }
      panelHandles.set(at, handle)
    }
    handle.mount = mount
    handle.fullscreen = fullscreen
    return handle
  }
  // An input as the plugin's props hold it: a copy, but for its functions (a panel's `focus`, CT-38), which are kept.
  const copied = (value: Json): Json =>
    typeof value === "function" || value === null || typeof value !== "object"
      ? value
      : Array.isArray(value)
        ? value.map(copied)
        : Object.fromEntries(Object.entries(value).map(([field, item]) => [field, copied(item)]))

  const raw = OpenCode.make({
    baseUrl: "http://opencode.internal/",
    fetch: (async (url: URL, init?: RequestInit) => {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined
      const result = await carrier.fetch({
        method: init?.method ?? "GET",
        path: url.pathname,
        query: [...url.searchParams],
        ...(body === undefined ? {} : { body }),
      })
      if (result && "Ok" in result)
        return result.Ok === null
          ? new Response(null, { status: 204 })
          : new Response(JSON.stringify(result.Ok), { status: 200, headers: { "content-type": "application/json" } })
      const error = String(result?.Err ?? "Transport")
      const status = /^UnexpectedStatus: (\d+)/.exec(error)?.[1]
      if (error.startsWith("Transport")) throw new Error(error)
      return new Response(JSON.stringify({ _tag: "Error", message: error }), {
        status: status ? Number(status) : 500,
        headers: { "content-type": "application/json" },
      })
    }) as typeof fetch,
  })
  // `client.rpc(definition)`, a plugin's own server RPC (CT-4), as TS's client makes it (`client/src/promise/rpc.ts`):
  // each method calls `/api/rpc/<id>/<method>` and answers its output; an event `name` is the host's event of type
  // `rpc.<id>.<name>`, which `data.on` hears. An error the server gives an RPC is not typed here: the host's fetch
  // answers it as text, so the plugin gets the client's error, not `{ type, message, data }`.
  const rpc = Object.assign(
    (definition: Json) => {
      const on = (name: string, handler: (event: Json) => unknown, options?: { signal?: AbortSignal }) => {
        if (!Object.hasOwn(definition.events ?? {}, name)) throw new Error(`Unknown RPC event: ${definition.id}.${name}`)
        const off = base.data.on(`rpc.${definition.id}.${name}`, handler)
        options?.signal?.addEventListener("abort", off)
        return off
      }
      // The events as they come, from when it is iterated.
      const subscribe = (name: string, options?: { signal?: AbortSignal }) => ({
        [Symbol.asyncIterator]() {
          const queue: Json[] = []
          let wake: (() => void) | undefined
          const off = on(name, (event) => {
            queue.push(event)
            wake?.()
          })
          let done = false
          const end = () => {
            done = true
            off()
            wake?.()
          }
          options?.signal?.addEventListener("abort", end)
          return {
            async next(): Promise<IteratorResult<Json>> {
              while (!queue.length && !done) await new Promise<void>((resolve) => (wake = resolve))
              if (queue.length) return { value: queue.shift(), done: false }
              return { value: undefined, done: true }
            },
            async return(): Promise<IteratorResult<Json>> {
              end()
              return { value: undefined, done: true }
            },
          }
        },
      })
      const methods = Object.keys(definition.methods ?? {}).map((method) => [
        method,
        async (input: Json, options?: Json) =>
          (
            await raw.rpc.call(
              { rpcID: definition.id, method, input, location: options?.location },
              { signal: options?.signal, headers: options?.headers },
            )
          ).output,
      ])
      return { ...Object.fromEntries(methods), events: { on, subscribe } }
    },
    raw.rpc,
  )
  const client = { ...raw, rpc }

  // Each command name runs the newest live registration of it that is enabled. A layer of a component that ended, or a
  // command whose `enabled` says no, runs nothing and answers `false`, as a command that declines: the key that ran it
  // goes on to the host, as TS binds no disabled command (CT-8) and lets a declined key fall through (CT-19).
  // A layer's `target` (CT-20): its commands run only while the plugin's focus is in that node, as TS's layer holds
  // only while the target has the focus; elsewhere they decline. The focus is the layer's own record: what the plugin
  // focused, or a field the user edits.
  const registrations = new Map<string, Registration[]>()
  // The modes the plugin pushed (`keymap.mode.push`), latest last. The host answers `input-mode` for the running call's
  // owner, and a mode a component pushes as it mounts is its mount's: a command, which runs as the plugin, reads `base`
  // there (oc-context-grid's escape never left its page). TS has one input mode.
  const modes: string[] = []
  const living = (name: string) => (registrations.get(name) ?? []).filter((at) => !at.retired && at.commands.has(name))
  // The newest live layer that holds `name` and takes the key now runs it, as the topmost such layer does in TS; one
  // disabled, out of its target or its mode, or whose command's `enabled` says no as the key comes, is passed over
  // (carbon ce-1). None: the command declines.
  const dispatch = (name: string, input?: string) => {
    const live = living(name)
    for (let index = live.length - 1; index >= 0; index--) {
      const at = live[index]!
      const command = at.commands.get(name)
      if (!allows(at.enabled)) continue
      if (at.target && !within(at.target(), focusedNode)) continue
      const mode = at.mode
      const current = () => read("input-mode", { type: "input-mode" }) ?? "base"
      if (mode !== undefined && modes.at(-1) !== mode && current() !== mode) continue
      if (!enabledNow(command)) continue
      return command.run(input)
    }
    return false
  }
  // What the host was told of each command name: enabled while any live layer that holds it holds it enabled, so a
  // disabled layer leaves the same command of an enabled one bound, and a layer that drops it or ends disables it at
  // once (carbon ce-1).
  const told = new Map<string, boolean>()
  const resync = (name: string) => {
    const on = living(name).some((at) => at.states.get(name) !== false)
    if (told.get(name) === on) return
    told.set(name, on)
    carrier.enable?.(name, on)
  }
  // Each call into the plugin asks every command's `enabled` again as it ends: one that also reads what the layer does
  // not follow (a variable a handler sets) is told the host then (carbon ce-2).
  const [rechecked, recheck] = createRoot(() => createSignal(0))
  // A microtask later too, for what a promise it resolved goes on to set.
  carrier.afterCall?.(() => {
    recheck((count) => count + 1)
    queueMicrotask(() => recheck((count) => count + 1))
  })
  // Follows the `enabled` of `registration`'s command `name`. One that read something the layer follows is the
  // command's state; one that read nothing followed (a plain field, a constant function) leaves it enabled on the host,
  // which then sends the key to the command, whose run asks it, as TS asks it as the key comes: it never latches off
  // (carbon ce-2). Its reads stay watched while it is followed, and no longer.
  const track = (registration: Registration, name: string, command: Json) =>
    createComputed(() => {
      rechecked()
      const reads = { keys: new Set<string>() }
      layered.add(reads)
      onCleanup(() => layered.delete(reads))
      const asks = [registration.enabled, command.enabled].filter((enabled) => typeof enabled === "function")
      let state = registration.enabled !== false && command.enabled !== false
      if (asks.length) {
        const before = rendering
        rendering = { pending: false, keys: reads.keys }
        try {
          const value = asks.every((enabled) => !!(enabled as () => unknown)())
          // `rechecked` is one of its sources.
          state = ((getListener() as Json)?.sources?.length ?? 0) > 1 ? value && state : true
        } catch {
          state = true
        } finally {
          rendering = before
        }
      }
      registration.states.set(name, state)
      resync(name)
    })
  // An `enabled`, a value or a function of what the plugin reads, as it says now; one that throws counts as enabled,
  // and the command's run asks it again.
  const allows = (enabled: unknown) => {
    if (typeof enabled !== "function") return enabled !== false
    try {
      return !!enabled()
    } catch {
      return true
    }
  }
  const enabledNow = (command: Json) => allows(command.enabled)
  const commands = (registration: Registration, scope?: string) => {
    const names = [...registration.commands.keys()]
    for (const name of names) {
      const known = registrations.get(name) ?? []
      if (!known.includes(registration)) registrations.set(name, [...known.filter((at) => !at.retired), registration])
    }
    for (const [name, command] of registration.commands) track(registration, name, command)
    for (const [name, command] of registration.commands) {
      carrier.command(
        {
          name,
          // Contract ergonomics 2.5: its state as every live layer that holds it says now, which the layer follows as
          // it changes (`set-enabled`), so the host binds no key of a disabled command and lists it nowhere.
          enabled: told.get(name) ?? true,
          title: command.title ?? name,
          group: command.group,
          slash: command.slash?.name,
          // Contract ergonomics 2.6: the slash name's other names (TS `slash.aliases`).
          ...(Array.isArray(command.slash?.aliases) && command.slash.aliases.length
            ? { aliases: command.slash.aliases.map(String) }
            : {}),
          keybind: typeof command.bind === "string" ? command.bind : undefined,
          palette: !!command.palette,
          description: command.description,
          arguments: !!(command.slash?.arguments || command.arguments),
          ...(command.hold ? { hold: true } : {}),
          ...(command.scope ?? scope ? { scope: command.scope ?? scope } : {}),
        },
        (input) => dispatch(name, input),
      )
    }
    return names
  }
  // A command without an `id` is named by what the host lists of it (its layer's mode, its keys, its title, its slash
  // name and the rest of what goes to the host) and its place among the layer's commands of the same, so a component
  // that mounts again names it as it did. A new name each mount is a new manifest, which reloads the plugin and mounts
  // the component again, without end (CT-1: tokscope's page). Commands that differ in any of it stay apart, also in two
  // layers (big-boi's catalog review: a global and a base layer with the same keys and title were one command); two
  // the same in every listed part are one, the newest live one running, as the topmost of two such layers runs in TS.
  const named = (list: Json[], scope: string | undefined) => {
    const seen = new Map<string, number>()
    return list.map((command: Json): [string, Json] => {
      if (command.id) return [command.id, command]
      const listed = [command.scope ?? scope, command.bind, command.title, command.slash?.name, command.slash?.aliases]
      listed.push(command.group, command.description, !!command.palette, !!command.hold, !!(command.slash?.arguments || command.arguments))
      const shape = JSON.stringify(listed.map((part) => part ?? null))
      const nth = (seen.get(shape) ?? 0) + 1
      seen.set(shape, nth)
      return [`${id}.inline-${Bun.hash(`${shape}${nth}`).toString(36)}`, command]
    })
  }

  const toasts = (options: Json) => ({
    type: "toast",
    variant: options.variant ?? "info",
    message: options.message,
    ...(options.title ? { title: options.title } : {}),
    ...(options.sessionID ? { session: options.sessionID } : {}),
  })

  const root = { add() {}, remove() {}, insertBefore() {}, getChildren: () => [], requestRender: () => invalidate() }
  const renderer = new Proxy(
    {
      requestRender: () => invalidate(),
      keyInput,
      // CT-17: OpenTUI's root renderable and focused editor, which a plugin probes for before it registers
      // (opencode-dollar-skills): the root takes nothing, as a renderable the plugin builds draws nothing, and nothing
      // has the focus. Each says so once.
      get root() {
        unsupported("renderer.root")
        return root
      },
      get currentFocusedEditor() {
        unsupported("renderer.currentFocusedEditor")
        return undefined
      },
      get currentFocusedRenderable() {
        unsupported("renderer.currentFocusedRenderable")
        return undefined
      },
      // The terminal's, as `useTerminalDimensions` (carbon-4): a surface's own box is not the renderer's.
      get width() {
        return info()?.size?.[0] || size[0]().width || 0
      },
      get height() {
        return info()?.size?.[1] || size[0]().height || 0
      },
    } as Json,
    {
      // A method of OpenTUI's `CliRenderer` the layer lacks warns once and does nothing (FT-6): an emitter's returns
      // the renderer, as Node's does, so its calls chain; one declared async a resolved promise; any other nothing.
      // Another member is undefined.
      get(target, name) {
        if (name in target || typeof name === "symbol") return target[name]
        unsupported(`renderer.${String(name)}`)
        if (!rendererMethods.includes(String(name))) return undefined
        if (EMITTER.has(name)) return () => renderer
        return rendererPromises.includes(String(name)) ? async () => undefined : () => undefined
      },
    },
  )
  screen.renderer = renderer

  const stores = new Map<string, Json>()

  const ctx = {
    options: base.options ?? {},
    get location() {
      return toRef(info()?.location)
    },
    app: base.app,
    renderer,
    client,
    data,
    attention: {
      async notify(options: Json) {
        // TS's defaults (carbon-4): a notification while the terminal is not focused, and a sound, unless `false`.
        const notification = typeof options.notification === "object" ? options.notification : {}
        const sound = typeof options.sound === "object" ? options.sound : {}
        await carrier.effect({
          type: "attention",
          ...(options.title ? { title: options.title } : {}),
          message: options.message,
          ...(options.notification === false ? {} : { notify: notification.when ?? "blurred" }),
          ...(options.sound === false
            ? {}
            : {
                sound: {
                  name: sound.name ?? "default",
                  when: sound.when ?? "always",
                  ...(sound.volume === undefined ? {} : { volume: sound.volume }),
                },
              }),
        })
        return { ok: true, notification: !!options.notification, sound: !!options.sound }
      },
    },
    get theme() {
      return theme()
    },
    // A signal's read, so what reads it (a key layer's `enabled`) follows a theme change (carbon ce-2).
    get themeMode() {
      themed[0]()
      return base.themeMode
    },
    // Contract 2.x, step D: a renderer of the fences whose info string resolves to `language`, as TS's, a fence claim
    // of the host's. A language registered twice by the plugin throws, as in TS; across plugins the last wins.
    markdown: {
      registerCodeBlockRenderer(language: string, render: (token: Json, context: Json) => unknown) {
        const name = infoStringToFiletype(language)
        if (!name) throw new Error("Markdown code-block language is required")
        if (codeBlocks.has(name)) throw new Error(`Markdown code-block renderer already registered: ${name}`)
        if (!carrier.claim) {
          unsupported("markdown.registerCodeBlockRenderer")
          return () => {}
        }
        codeBlocks.add(name)
        const end = carrier.claim({ type: "fence", name }, (part) => codeBlock(name, render, part))
        return () => {
          if (codeBlocks.delete(name)) end()
        }
      },
    },
    keymap: {
      // As TS's (bigboi P8-4): the factory is followed, so its `enabled` and its commands may change. A disabled layer's
      // commands, and a command whose `enabled` says no, stay registered and disabled: the host binds no key of theirs
      // and lists them nowhere, as TS binds no disabled command, and a change of either goes to the host as
      // `set-enabled`, with no reload (contract ergonomics 2.5). The factory and each command's `enabled` are followed
      // by what they read; a command's `enabled` is asked again as it runs, for one that reads what is not followed.
      // A layer keeps to the base mode unless its `mode` is `global`, or a mode of the plugin's own, whose commands
      // decline unless it is the input mode. A layer a component made ends with it: from then on its commands run
      // nothing, though the host lists them a little longer (`uncommand`). Its `target` makes its commands decline
      // while that node lacks the plugin's focus. Its `priority` and `bindings` are not mapped.
      layer(factory: () => Json) {
        const registration: Registration = { retired: false, commands: new Map<string, Json>(), states: new Map() }
        let names: string[] = []
        const apply = () => {
          // What the factory reads this run, which stays watched until it runs again (carbon ce-2: kept for good, the
          // reads of a layer whose `enabled` named one session after another filled the host's 128).
          const reads = { keys: new Set<string>() }
          layered.add(reads)
          onCleanup(() => layered.delete(reads))
          const before = rendering
          rendering = { pending: false, keys: reads.keys }
          let layer: Json
          try {
            layer = factory()
          } finally {
            rendering = before
          }
          registration.enabled = layer?.enabled
          // A mode of the plugin's own (`modal`, one it pushes) is active only while it is the input mode (CT-31): its
          // commands are bound everywhere and decline elsewhere, so the key goes on.
          const own = typeof layer?.mode === "string" && layer.mode !== "global" && layer.mode !== "base"
          const scope = layer?.mode === "global" || own ? undefined : "base"
          registration.mode = own ? layer.mode : undefined
          registration.target = typeof layer?.target === "function" ? layer.target : undefined
          registration.commands = new Map(named(layer?.commands ?? [], scope))
          for (const name of [...registration.states.keys()])
            if (!registration.commands.has(name)) registration.states.delete(name)
          const next = commands(registration, scope)
          // A command the layer no longer lists is disabled now, unless another live layer holds it, where it went
          // only with `uncommand`'s delay (carbon ce-1: file-browser's `commands: []` held its keys 250 ms on).
          for (const name of names) if (!registration.commands.has(name)) resync(name)
          names.forEach((name) => carrier.uncommand(name))
          names = next
          carrier.changed()
        }
        const owner = getOwner()
        createRoot((dispose) => {
          createEffect(apply)
          if (owner)
            runWithOwner(owner, () =>
              onCleanup(() => {
                registration.retired = true
                dispose()
                // Its commands are disabled at once, unless another live layer holds them (carbon ce-1).
                names.forEach(resync)
                names.forEach((name) => carrier.uncommand(name))
                names = []
                carrier.changed()
              }),
            )
        })
      },
      dispatch(name: string, input?: string) {
        void carrier.effect({ type: "dispatch", name, ...(input === undefined ? {} : { input }) })
      },
      shortcuts: (name: string) => read(`shortcuts:${name}`, { type: "shortcuts", name }) ?? [],
      commands: () =>
        (read("keymap-commands", { type: "keymap-commands" }) ?? [])
          // The layer's own commands (a click, a dialog's answer) are not the plugin's to list (carbon-5).
          .filter((command: Json) => !String(command.name ?? command.id ?? "").includes(".compat."))
          .map((command: Json) => ({
            ...command,
            slash: command.slash,
            // As TS's: running one dispatches it (carbon-4).
            run: () => void carrier.effect({ type: "dispatch", name: command.name ?? command.id }),
          })),
      pending: () => read("keymap-pending", { type: "keymap-pending" }) ?? [],
      active: () => read("keymap-active", { type: "keymap-active" }) ?? [],
      mode: {
        current: () => read("input-mode", { type: "input-mode" }) ?? "base",
        push(mode: string) {
          modes.push(mode)
          void carrier.effect({ type: "set-mode", mode })
          return () => {
            const at = modes.lastIndexOf(mode)
            if (at >= 0) modes.splice(at, 1)
            void carrier.effect({ type: "set-mode" })
          }
        },
      },
    },
    storage: {
      store(key: string, options: { initial: Json }) {
        const known = stores.get(key)
        if (known) return known
        // Declared to the host at once, so its reads and writes work before the manifest that lists it (carbon-2).
        void carrier.effect({ type: "storage-key", key })
        carrier.storage([key])
        carrier.changed()
        // The stored value: its JSON, as a watched read carries it (big-boi's `cg4-2`), or its text.
        const persisted = () => {
          const stored = read(`storage:${key}`, { type: "storage-get", key })
          if (stored !== null && typeof stored === "object") return stored
          try {
            return typeof stored === "string" ? JSON.parse(stored) : undefined
          } catch {
            return undefined
          }
        }
        const [store, setStore] = createRoot(() => createStore(structuredClone(persisted() ?? options.initial)))
        carrier.listen((pushedKey) => {
          if (pushedKey !== `storage:${key}`) return
          // A refresh that failed leaves the store as it was, and says so in the log by the store's key.
          const error = failed(pushedKey)
          if (error) return unsupported(`store ${key}`, `${id}: the store ${key} keeps its last value: ${error}`)
          const value = untrack(persisted)
          if (value !== undefined) setStore(reconcile(value))
        })
        // As TS's, under its lock (bigboi P8-3): one update of the key at a time, each made from what the host holds
        // then, which the last update wrote; what it changed is merged into what is stored as it is written, so a field
        // another client wrote meanwhile stays. One that removes a field writes the whole value.
        let queue: Promise<unknown> = Promise.resolve()
        // A stored value that did not come (too large for the JS host, or the plugin failed) fails the update: read as
        // an empty key, the update overwrote what was stored with the initial value (big-boi's `cg4-1`). A write the
        // host refused fails it too, and the store keeps what is stored.
        const once = async (mutation: (draft: Json) => void) => {
          const stored = await carrier.effect({ type: "storage-get", key })
          if (stored === undefined) throw new Error(`the stored value of ${key} did not come`)
          let base: Json
          try {
            base = typeof stored === "string" ? JSON.parse(stored) : structuredClone(options.initial)
          } catch {
            base = structuredClone(options.initial)
          }
          const written = (answer: Json) => {
            if (answer !== true) throw new Error(`${key} was not stored: ${answer?.error ?? "no answer"}`)
          }
          const draft = structuredClone(base)
          mutation(draft)
          const plain = (value: Json) => !!value && typeof value === "object" && !Array.isArray(value)
          if (plain(base) && plain(draft) && Object.keys(base).every((field) => field in draft)) {
            const fields = Object.fromEntries(
              Object.entries(draft).filter(([field, value]) => JSON.stringify(value) !== JSON.stringify(base[field])),
            )
            if (Object.keys(fields).length) written(await carrier.effect({ type: "storage-merge", key, fields }))
          } else written(await carrier.effect({ type: "storage-set", key, value: JSON.stringify(draft) }))
          batch(() => setStore(reconcile(draft)))
        }
        const update = (mutation: (draft: Json) => void) => {
          const done = queue.then(() => once(mutation))
          queue = done.catch(() => {})
          return done
        }
        const entry = [store, update] as const
        stores.set(key, entry)
        return entry
      },
      memory(key: string, options: { initial: Json }) {
        const known = stores.get(`memory:${key}`)
        if (known) return known
        const [store, setStore] = createRoot(() => createStore(structuredClone(options.initial)))
        const entry = [store, (mutation: (draft: Json) => void) => setStore(produce(mutation))] as const
        stores.set(`memory:${key}`, entry)
        return entry
      },
    },
    ui: {
      dialog: {
        show(render: () => unknown, onClose?: () => void) {
          const asking = !!answering
          settle()
          unshow()
          if (asking) void carrier.effect({ type: "dialog", dialog: { type: "close", key: "" } })
          presentation = { size: "medium", centered: false }
          const key = `compat.dialog.${++shows}`
          dialogs.set(key, render)
          shown = { key, onClose, opened: false }
          untrack(() => read(`dialog-open:${key}`, { type: "dialog-open", key }))
          // Sent at once, also from a plugin's code after an `await`, which runs in no call of the host's; a `dialog.set`
          // right after sends it again under its key, which the host changes in place.
          sendShown()
        },
        set(options: Json) {
          presentation = { size: options?.size ?? "medium", centered: !!options?.centered }
          // A dialog of the plugin's own changes its frame in place.
          if (shown) sendShown()
          // A select's, an alert's and a confirm's size and centering are the contract's (contract 2.x, addition 4): a
          // `dialog.set` right after them sizes the dialog, which is built a microtask later. One after the host showed
          // it is not carried: the contract's dialogs are whole values, and sent again it would answer nothing.
          else if (answering && sent === asked && (presentation.size !== "medium" || presentation.centered))
            unsupported("dialog.set after its dialog showed")
        },
        clear() {
          const asking = !!answering
          settle()
          presentation = { size: "medium", centered: false }
          if (asking) void carrier.effect({ type: "dialog", dialog: { type: "close", key: "" } })
          if (!shown) return
          void carrier.effect({ type: "dialog", dialog: { type: "close", key: shown.key } })
          unshow()
        },
        // An alert and a confirm are medium until the plugin's `dialog.set` right after says otherwise, as a select.
        alert: (options: Json) => {
          presentation = { size: "medium", centered: false }
          return ask(() => ({ type: "alert", title: options.title, message: options.message, ...presented() })).then(
            () => undefined,
          )
        },
        confirm: (options: Json) => {
          presentation = { size: "medium", centered: false }
          return ask(() => ({
            type: "confirm",
            title: options.title,
            message: options.message,
            label: { confirm: options.label?.confirm, cancel: options.label?.cancel },
            ...presented(),
          })).then((answer) => (answer === undefined ? undefined : answer === "true"))
        },
        // Contract ergonomics 2.6: the field's starting text and the line above it, as TS's. Built a microtask later, as
        // the other dialogs, so a `dialog.set` right after it is not one after it showed; the contract's prompt has no
        // size, which the log says.
        prompt: (options: Json) => {
          presentation = { size: "medium", centered: false }
          return ask(() => {
            if (presentation.size !== "medium" || presentation.centered) unsupported("ui.dialog.set of a prompt")
            return {
              type: "prompt",
              title: options.title,
              placeholder: options.placeholder,
              ...(options.value === undefined || options.value === null ? {} : { value: String(options.value) }),
              ...(options.description === undefined || options.description === null
                ? {}
                : { description: String(options.description) }),
            }
          })
        },
        async select(options: Json) {
          if ((options.actions?.length ?? 0) > SELECT_ACTIONS) unsupported(`ui.dialog.select over ${SELECT_ACTIONS} actions`)
          const search = options.search
          const enabled = options.options.filter((option: Json) => !option.disabled)
          // The rows listed now, which an answer's index names: a plugin's search lists its own, flat and in its order,
          // with the category as the footer, as TS's does (FT-12).
          let listed: Json[] = search ? (search("", enabled) ?? []).filter((option: Json) => !option.disabled) : options.options
          // A row's value names this select and the row itself, not its place: a search lists rows anew while the
          // select stays open, and an action of a select a newer one replaced reaches nothing (bigboi cg2-7, cg2-8).
          const mine = asked + 1
          const tokens = new Map<Json, string>()
          const named: Json[] = []
          const token = (option: Json) => {
            if (!tokens.has(option)) tokens.set(option, `${mine}.${named.push(option) - 1}`)
            return tokens.get(option)!
          }
          const row = (value: string | undefined) => {
            const [select, at] = (value ?? "").split(".")
            return select === String(mine) ? named[Number(at)] : undefined
          }
          const rows = () =>
            listed.map((option: Json) => ({
              title: option.title,
              value: token(option),
              description: option.description,
              footer: search ? (option.category ?? option.footer) : option.footer,
              category: search ? undefined : option.category,
              disabled: !!option.disabled,
            }))
          const current = () => {
            const at = listed.find((option: Json) => option.value === options.current)
            return at === undefined ? {} : { current: token(at) }
          }
          // The host tells a plugin's search each query (P6c's `query`): it lists the rows the search returns, in place
          // under the select's key.
          const key = `search.${asked + 1}`
          // A new dialog is medium until the plugin's `dialog.set` says otherwise, as TS's.
          presentation = { size: "medium", centered: false }
          // Its footer actions, in the footer with their keys: one on the selected row gets its value, one of
          // `selection: "none"` none. Triggering one leaves the select open, as TS's. A rowless one's input is this
          // select's, so it too reaches only this select.
          const actions: Json[] = (options.actions ?? []).slice(0, SELECT_ACTIONS)
          const triggered = actions.map((action) => (input: string | undefined) => {
            if (asked !== mine || !answering) return
            if (action.selection === "none") return input === String(mine) ? action.onTrigger() : undefined
            const picked = row(input)
            if (picked) action.onTrigger(picked.value)
          })
          triggers = triggered
          const footer = actions.map((action, slot) => ({
            title: String(action.title),
            key: String(action.bind),
            action: { type: "command", name: ACTIONS[slot], ...(action.selection === "none" ? { input: String(mine) } : {}) },
            ...(action.side === "left" ? { primary: true } : action.side === "right" ? { primary: false } : {}),
            ...(action.selection === "none" ? { rowless: true } : {}),
          }))
          const dialog = () => ({
            type: "select",
            title: options.title,
            placeholder: options.placeholder,
            options: rows(),
            ...current(),
            ...(search ? { key, query: { type: "command", name: QUERY } } : {}),
            ...(footer.length ? { actions: footer } : {}),
            ...presented(),
          })
          const run = search
            ? (query: string) => {
                listed = (search(query, enabled) ?? []).filter((option: Json) => !option.disabled)
                const select = { ...dialog(), action: { type: "command", name: ANSWER } }
                void carrier.effect({ type: "dialog", dialog: select })
              }
            : undefined
          searching = run
          const answer = await ask(dialog)
          // A select that replaced this one searches on, and an answered or closed one keeps no actions (cg2-10).
          if (searching === run) searching = undefined
          if (triggers === triggered) triggers = []
          // A keyed select stays open as a row is picked.
          if (search && answer !== undefined) void carrier.effect({ type: "dialog", dialog: { type: "close", key } })
          return row(answer)?.value
        },
      },
      toast: {
        show(options: Json) {
          void carrier.effect(toasts(options))
        },
      },
      format: {
        path: (value: string) => {
          const home = homedir()
          return home && (value === home || value.startsWith(home + "/")) ? "~" + value.slice(home.length) : value
        },
      },
      router: {
        register(page: Json) {
          return surface(page.name, { type: "route", name: page.name }, () => ({ data: routeData.get(page.name) }), page.render, "route")
        },
        navigate(destination: Json) {
          const route =
            destination.type === "session"
              ? { type: "session", id: destination.sessionID }
              : destination.type === "plugin"
                ? { type: "plugin", id: destination.id ?? id, name: destination.name }
                : { type: "home" }
          if (destination.type === "plugin") routeData.set(destination.name, destination.data)
          void carrier.effect({ type: "navigate", route })
        },
        current: () => route(),
      },
      panel: {
        open(name: string, options?: Json) {
          if (route().type !== "session" || !panels.length) return false
          setPanelName(name)
          void carrier.effect({
            type: "open-panel",
            surface: panels[0],
            ...(options?.presentation === "fullscreen" ? { fullscreen: true } : {}),
          })
          return true
        },
        close() {
          for (const name of panels) void carrier.effect({ type: "close-panel", surface: name })
        },
        current: () => (panelName() ? { name: panelName(), sessionID: route().sessionID ?? "" } : undefined),
      },
      tabs: {
        enabled: () => !!read("tabs-enabled", { type: "tabs-enabled" }),
        list: () =>
          (read("tabs", { type: "tabs" }) ?? []).map((tab: Json) => ({
            sessionID: tab.session_id,
            title: tab.title,
            active: !!tab.active,
            busy: !!tab.busy,
            attention: !!tab.attention,
            ...(tab.unread ? { unread: tab.unread } : {}),
          })),
        open: (sessionID: string) => tab({ type: "open", session: sessionID }),
        focus: (sessionID: string) => tab({ type: "focus", session: sessionID }),
        move: (sessionID: string, index: number) => tab({ type: "move", session: sessionID, index }),
        close: (sessionID?: string) => tab({ type: "close", ...(sessionID ? { session: sessionID } : {}) }),
      },
      model: {
        current() {
          const model = read("model", { type: "model" })
          return model ? { providerID: model.providerID, modelID: model.id ?? model.modelID, variant: model.variant } : undefined
        },
        variant: {
          list: () => read("variants", { type: "variants" }) ?? [],
          set(variant?: string) {
            const list = read("variants", { type: "variants" }) ?? []
            if (!read("model", { type: "model" })) return false
            if (variant !== undefined && !list.includes(variant)) return false
            void carrier.effect({ type: "set-variant", ...(variant === undefined ? {} : { variant }) })
            return true
          },
        },
      },
      slot(claim: Json) {
        const kinds = ["prepend", "append", "before", "after", "replace"].filter((kind) => claim[kind] !== undefined)
        if (kinds.length !== 1) throw new Error("Slot claim requires exactly one placement key")
        const kind = kinds[0]!
        const path = String(claim[kind])
        const name = `slot#${claims++}`
        if (path === "session.panel") {
          panels.push(name)
          return surface(name, { type: "panel", name }, slotInput(path, name), claim.render, `slot ${path}`)
        }
        // As it is: the host degrades a path it does not publish as TS does (carbon-4): a `replace` of one never
        // degrades, an `append` goes to the nearest published ancestor, and a plugin's own `<Slot>` is a path too.
        return surface(name, { type: "slot", kind, path }, slotInput(path), claim.render, `slot ${path}`)
      },
    },
  }
  const tab = (edit: Json) => {
    if (!read("tabs-enabled", { type: "tabs-enabled" })) return false
    void carrier.effect({ type: "tab", edit })
    return true
  }
  return ctx
}
