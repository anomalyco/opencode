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
// the rest warns once in a toast and does nothing. Each is listed by `reported`.
import {
  batch,
  createComponent,
  createContext,
  createEffect,
  createRoot,
  createSignal,
  getOwner,
  onCleanup,
  runWithOwner,
  untrack,
} from "solid-js"
import { createStore, produce, reconcile, unwrap } from "solid-js/store"
import { EventEmitter } from "node:events"
import { homedir } from "node:os"
import { OpenCode } from "../../../../../../client/src/promise/generated/index"
import { RGBA, hexToRgb } from "./core"
import { eventTypes } from "./events.gen"
import { rendererMethods, rendererPromises } from "./opentui.gen"
import {
  idOf,
  legacy,
  missing,
  mount,
  serialize,
  type Focus,
  type Mounted,
  type Screen,
  type Scrolls,
  type VNode,
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

// A keymap layer's commands as the layer last registered them, its `target`, and whether its component ended.
interface Registration {
  retired: boolean
  commands: Map<string, Json>
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
  surface(name: string, place: Json, view: (cx: Json) => Json, options?: Json): void
  // A key layer of the activation, contract 2.0's `Setup::layer`, whose handler hears its events.
  layer?(layer: Json, handler: (event: Json) => unknown): void
  command(command: Json, run: (input?: string) => unknown): void
  uncommand(name: string): void
  storage(keys: string[]): void
  on(types: string[], handler: (event: Json) => unknown): void
  effect(request: Json): Promise<Json>
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
    console.warn(`plugin ${message}`)
    void carrier.effect({ type: "toast", variant: "warning", title: "Plugin", message })
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
  const failed = (key: string) => carrier.readError?.(key)
  carrier.listen((key) => {
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
    const live = new Set([...rendered.values(), ...(shown ? [shown.mounted] : [])].flatMap((at) => [...at.keys]))
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
  const session = (sessionID: string): Json =>
    sessions().find((item) => item.info.id === sessionID) ??
    read(`session:${sessionID}`, { type: "session", id: sessionID }) ??
    undefined
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
  const fetched = (events: string[], load: (...args: Json[]) => Promise<Json>, key = (...args: Json[]) => JSON.stringify(args)) => {
    const entries = new Map<string, { args: Json[]; value?: Json; version: ReturnType<typeof createSignal<number>>; loading?: Promise<void> }>()
    let heard = false
    const entry = (args: Json[]) => {
      const at = key(...args)
      const known = entries.get(at)
      if (known) return known
      const made = { args, version: createRoot(() => createSignal(0)) }
      entries.set(at, made)
      return made
    }
    const reload = (at: ReturnType<typeof entry>): Promise<void> => {
      if (!heard) {
        heard = true
        for (const type of events) base.data.on(type, () => entries.forEach((known) => void reload(known)))
      }
      at.loading = load(...at.args).then(
        (value) => {
          at.value = value
          at.version[1]((count) => count + 1)
          invalidate()
        },
        (error) => console.warn(`plugin ${id}: a load of data failed: ${error instanceof Error ? error.message : error}`),
      )
      return at.loading
    }
    return {
      list(...args: Json[]) {
        const at = entry(args)
        at.version[0]()
        if (at.value === undefined && !at.loading) void reload(at)
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
  const forms = fetched(
    ["form.created", "form.replied", "form.cancelled"],
    (sessionID: string, location?: Json) =>
      raw.form.list({ location: directoryOf(location) }).then((out: Json) => out.data.filter((form: Json) => form.sessionID === sessionID)),
  )
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
      permission: fetched(["permission.asked", "permission.replied"], (sessionID: string) => raw.permission.list({ sessionID })),
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
        // Another dialog came first: this one never shows.
        if (asked !== mine) return
        const asking = { ...(typeof dialog === "function" ? dialog() : dialog), action: { type: "command", name: ANSWER } }
        void carrier.effect({ type: "dialog", dialog: { type: "dismissable", dialog: asking, dismissed } })
      }
      if (typeof dialog === "function") queueMicrotask(send)
      else send()
    })

  // `ui.dialog.show`: the plugin's own JSX in the host's live panel dialog (`Dialog::Panel`), the contract's dialog that
  // shows a node, sent again under its key as the JSX changes. A bare panel: the host draws only the dialog's frame
  // around it, as TS does; a close of it (escape, the backdrop, another dialog) calls `onClose`, as TS's
  // `dialog.replace` does.
  // Each `show` is a panel of its own key (carbon-3), so the host tells its open and its close apart from the one it
  // replaced, which it changed in place under the same key.
  let shows = 0
  let shown: { mounted: Mounted; key: string; onClose?: () => void; opened: boolean; keys?: () => void } | undefined
  let presentation = { size: "medium", centered: false }
  let uncarried = false
  let resend = false
  const unshow = () => {
    const was = shown
    shown = undefined
    if (!was) return
    was.mounted.dispose()
    was.keys?.()
    presses.delete(was.key)
    was.onClose?.()
  }
  // A panel's body is a node of ABI 1.x, which has no scroll: a `<scrollbox>` in the dialog is a box that does not
  // scroll (bigboi P8-6). While one shows, the keys that would scroll it say so, once, rather than do nothing.
  const SCROLLS = `${id}.compat.dialog-scroll`
  const scrolls = (node: Json): boolean => node?.type === "scroll" || (node?.children ?? []).some(scrolls)
  const sendShown = () => {
    resend = false
    if (!shown) return
    const key = shown.key
    // As TS's boundary around a dialog, which clears it: a render that threw closes the dialog (carbon-3).
    if (shown.mounted.crashed !== undefined) {
      void carrier.effect({ type: "dialog", dialog: { type: "close", key } })
      unshow()
      return
    }
    missing.clear()
    const reading = pressing(key)
    let body: Json
    try {
      const tree = serialize(shown.mounted.root, reading)
      if (scrolls(tree) && !shown.keys)
        shown.keys = createRoot((dispose) => {
          ctx.keymap.layer(() => ({
            mode: "global",
            commands: [
              {
                id: SCROLLS,
                bind: "up,down,pageup,pagedown",
                run: () => unsupported("scrolling a <scrollbox> in ui.dialog.show"),
              },
            ],
          }))
          return dispose
        })
      body = legacy(tree)
    } catch (error) {
      void carrier.effect({ type: "toast", variant: "error", title: "Plugin", message: `${id} crashed in dialog: ${error instanceof Error ? error.message : String(error)}` })
      unshow()
      return
    }
    for (const dropped of [...reading.dropped, ...missing]) unsupported(dropped)
    missing.clear()
    const size = ["large", "xlarge"].includes(presentation.size) ? presentation.size : "medium"
    void carrier.effect({
      type: "dialog",
      dialog: { type: "panel", key, size, title: [], body, centered: presentation.centered, bare: true },
    })
  }
  const panelChanged = () => {
    if (!shown || resend) return
    resend = true
    queueMicrotask(sendShown)
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
  const focus: Focus = {
    focus(node) {
      if (focusedNode !== node) focusedNode?.focusChanged(false)
      focusedNode = node
      node.focusChanged(true)
      // The contract's focus takes a node with `interact.focusable` alone, so the host refuses a field: the plugin's
      // own focus of it holds, and its keys come as `onKeyDown`, but what the user types goes elsewhere.
      if (FIELDS.has(node.tag)) unsupported(`focus() of an <${node.tag}>`)
      if (FOCUSABLE.has(node.tag)) void carrier.effect({ type: "focus", node: idOf(node) })
    },
    blur(node) {
      if (focusedNode !== node) return
      focusedNode = undefined
      node.focusChanged(false)
      if (FOCUSABLE.has(node.tag)) void carrier.effect({ type: "blur" })
    },
  }
  // A field's events (CT-11): its edits and its submit are the contract's `change` and `submit` of its node, which its
  // `onInput`, `onChange` and `onSubmit` hear, and a key while the plugin's focused field is in the surface is its
  // `onKeyDown`, which cannot take the key: the host's field and its keys have it too.
  const fieldEvent = (surface: string, event: Json) => {
    const roots = [...rendered.entries()].filter(([at]) => at.startsWith(`${surface}\u0000`)).map(([, at]) => at.root)
    const find = (id: string) => {
      const walk = (node: VNode): VNode | undefined =>
        idOf(node) === id && FIELDS.has(node.tag) ? node : node.children.reduce<VNode | undefined>((found, child) => found ?? walk(child), undefined)
      return roots.reduce<VNode | undefined>((found, root) => found ?? walk(root), undefined)
    }
    if (event.type === "key") {
      const node = focusedNode && find(idOf(focusedNode))
      if (node === focusedNode) node?.props.onKeyDown?.(keyEvent(event))
      return
    }
    const node = (event.type === "change" || event.type === "submit") && find(event.node)
    if (!node) return
    // The user edits it in the host's field, which has the focus then.
    if (focusedNode !== node) {
      focusedNode?.focusChanged(false)
      focusedNode = node
      node.focusChanged(true)
    }
    node.typed = event.text
    if (event.type === "change") return node.props.onInput?.(event.text)
    node.props.onChange?.(event.text)
    node.props.onSubmit?.(event.text)
  }
  // An OpenTUI key event of the host's key (`ctrl+shift+a`, `enter`, `space`): a listener's, so taking it does
  // nothing, which the JS host's log says once.
  const keyEvent = (event: Json) => {
    let rest = String(event.key ?? "")
    const held = { ctrl: false, shift: false, meta: false, super: false, hyper: false } as Record<string, boolean>
    for (let at = /^(ctrl|shift|meta|super|hyper)\+(.+)$/.exec(rest); at; at = /^(ctrl|shift|meta|super|hyper)\+(.+)$/.exec(rest)) {
      held[at[1]!] = true
      rest = at[2]!
    }
    const name = rest === "enter" ? "return" : rest
    const sequence = event.text ?? SEQUENCES[name] ?? ""
    const taken = () => {
      if (keysTaken) return
      keysTaken = true
      console.warn(`plugin ${id}: a key a listener takes still reaches opencode-native`)
    }
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
        taken()
      },
      stopPropagation() {
        stopped = true
        taken()
      },
    }
  }
  let keysTaken = false
  // OpenTUI's key handler (CT-11): an emitter whose `keypress` listeners hear each key, through a global listener layer
  // the plugin registers with its first one, as most plugins never listen.
  const keyInput = new EventEmitter()
  let listening = false
  keyInput.on("newListener", (name) => {
    if (name !== "keypress" || listening || !carrier.layer) return
    listening = true
    carrier.layer({ scope: "global", any: true }, (event: Json) => {
      if (event.type === "key") keyInput.emit("keypress", keyEvent(event))
    })
    carrier.changed()
  })
  // A surface's scrolls (CT-2): a scroll box's state is the host's read of it, which follows it as it moves, and a move
  // is the contract's verb on the scroll of the surface's live mount, by its id.
  const scrollsOf = (surface: string): Scrolls => {
    const target = (node: VNode) => ({ type: "node", surface, id: idOf(node) })
    return {
      state: (node) => read(`scroll:${surface}:${idOf(node)}`, { type: "scroll-state", target: target(node) }) ?? undefined,
      to: (node, offset) => void carrier.effect({ type: "scroll", target: target(node), verb: { type: "offset", offset } }),
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
    const parked = new Map<string, { entry: Rendered; timer: ReturnType<typeof setTimeout> }>()
    const adopt = (cx: Json) => {
      const slot = `${cx.mount.surface}\u0000${cx.mount.key}`
      const kept = parked.get(slot)
      if (!kept) return undefined
      clearTimeout(kept.timer)
      parked.delete(slot)
      rendered.set(key(cx), kept.entry)
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
        const [props, setProps] = createStore(structuredClone(value))
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
          setInput: (next: Json) => setProps(reconcile(structuredClone(next))),
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
    carrier.surface(name, place, view, {
      // A mount a reload of the registrations ends (`handover`) is kept a moment: the reload begins it again in a later
      // message, and the new mount of the same surface and key adopts it, so its components do not run again. TS takes
      // a registration without a remount; a component that registers anew as it mounts (opencode-navigator names each
      // binding by a count) reloaded without end (CT-21). Any other end ends its components at once.
      unmount(mount: Json, handover?: boolean) {
        const at = `${mount.surface}\u0000${mount.key}\u0000${mount.generation}`
        const entry = rendered.get(at)
        rendered.delete(at)
        presses.delete(at)
        if (!entry || entry.crashed !== undefined || !handover) return entry?.dispose()
        const slot = `${mount.surface}\u0000${mount.key}`
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
        parked.set(slot, { entry, timer })
      },
      on: (event: Json) => fieldEvent(name, event),
      // A route or a panel holds the focus, and a field in it: each key while it does comes to the field the plugin
      // focused, as its `onKeyDown` (a listener: the key goes on).
      ...(place.type === "route" || place.type === "panel" ? { layers: [{ scope: "surface", any: true }] } : {}),
    })
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

  const slotInput = (path: string) => (cx: Json) => {
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
        name: panelName,
        sessionID: slot.session_id ?? "",
        width: panel.width ?? cx.input.width,
        presentation: panel.fullscreen ? "fullscreen" : "panel",
        focused: !!panel.focused,
      }
    }
    if (path.startsWith("sidebar.") || path === "session.composer.top") return { sessionID: slot.session_id ?? "" }
    return {}
  }
  let panelName = ""
  const panels: string[] = []

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
  const dispatch = (name: string, input?: string) => {
    const live = (registrations.get(name) ?? []).filter((at) => !at.retired && at.commands.has(name))
    const command = live.at(-1)?.commands.get(name)
    if (!command) return false
    const target = live.at(-1)?.target
    if (target && !within(target(), focusedNode)) return false
    const mode = live.at(-1)?.mode
    if (mode !== undefined && (read("input-mode", { type: "input-mode" }) ?? "base") !== mode) return false
    const enabled = typeof command.enabled === "function" ? command.enabled() : command.enabled !== false
    return enabled ? command.run(input) : false
  }
  const commands = (registration: Registration, scope?: string) => {
    const names: string[] = []
    for (const [name, command] of registration.commands) {
      names.push(name)
      const known = registrations.get(name) ?? []
      if (!known.includes(registration)) registrations.set(name, [...known.filter((at) => !at.retired), registration])
      carrier.command(
        {
          name,
          title: command.title ?? name,
          group: command.group,
          slash: command.slash?.name,
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
    get themeMode() {
      return base.themeMode
    },
    markdown: {
      registerCodeBlockRenderer() {
        unsupported("markdown.registerCodeBlockRenderer")
        return () => {}
      },
    },
    keymap: {
      // As TS's (bigboi P8-4): the factory is followed, so its `enabled` and its commands may change; a disabled
      // layer registers nothing; a layer keeps to the base mode unless its `mode` is `global`, or a mode of the plugin's
      // own, whose commands decline unless it is the input mode; a command's own
      // `enabled` is asked as it runs. A layer a component made ends with it: from then on its commands run nothing,
      // though the host lists them a little longer (`uncommand`). Its `target` makes its commands decline while that
      // node lacks the plugin's focus. Its `priority` and `bindings` are not mapped.
      layer(factory: () => Json) {
        const registration: Registration = { retired: false, commands: new Map<string, Json>() }
        let names: string[] = []
        const apply = (layer: Json) => {
          const enabled = typeof layer?.enabled === "function" ? layer.enabled() : layer?.enabled !== false
          // A mode of the plugin's own (`modal`, one it pushes) is active only while it is the input mode (CT-31): its
          // commands are bound everywhere and decline elsewhere, so the key goes on.
          const own = typeof layer?.mode === "string" && layer.mode !== "global" && layer.mode !== "base"
          const scope = layer?.mode === "global" || own ? undefined : "base"
          registration.mode = own ? layer.mode : undefined
          registration.target = typeof layer?.target === "function" ? layer.target : undefined
          registration.commands = new Map(named(enabled ? (layer?.commands ?? []) : [], scope))
          const next = commands(registration, scope)
          names.forEach((name) => carrier.uncommand(name))
          names = next
          carrier.changed()
        }
        const owner = getOwner()
        createRoot((dispose) => {
          createEffect(() => apply(factory()))
          if (owner)
            runWithOwner(owner, () =>
              onCleanup(() => {
                registration.retired = true
                dispose()
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
          void carrier.effect({ type: "set-mode", mode })
          return () => void carrier.effect({ type: "set-mode" })
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
        const persisted = () => {
          const text = read(`storage:${key}`, { type: "storage-get", key })
          try {
            return typeof text === "string" ? JSON.parse(text) : undefined
          } catch {
            return undefined
          }
        }
        const [store, setStore] = createRoot(() => createStore(structuredClone(persisted() ?? options.initial)))
        carrier.listen((pushedKey) => {
          if (pushedKey !== `storage:${key}`) return
          const value = untrack(persisted)
          if (value !== undefined) setStore(reconcile(value))
        })
        // As TS's, under its lock (bigboi P8-3): one update of the key at a time, each made from what the host holds
        // then, which the last update wrote; what it changed is merged into what is stored as it is written, so a field
        // another client wrote meanwhile stays. One that removes a field writes the whole value.
        let queue: Promise<unknown> = Promise.resolve()
        const once = async (mutation: (draft: Json) => void) => {
          const stored = await carrier.effect({ type: "storage-get", key })
          let base: Json
          try {
            base = typeof stored === "string" ? JSON.parse(stored) : structuredClone(options.initial)
          } catch {
            base = structuredClone(options.initial)
          }
          const draft = structuredClone(base)
          mutation(draft)
          const plain = (value: Json) => !!value && typeof value === "object" && !Array.isArray(value)
          if (plain(base) && plain(draft) && Object.keys(base).every((field) => field in draft)) {
            const fields = Object.fromEntries(
              Object.entries(draft).filter(([field, value]) => JSON.stringify(value) !== JSON.stringify(base[field])),
            )
            if (Object.keys(fields).length) await carrier.effect({ type: "storage-merge", key, fields })
          } else await carrier.effect({ type: "storage-set", key, value: JSON.stringify(draft) })
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
          const crashed = (error: unknown) => {
            const message = error instanceof Error ? error.message : String(error)
            void carrier.effect({ type: "toast", variant: "error", title: "Plugin", message: `${id} crashed in dialog: ${message}` })
          }
          const provided = () =>
            createComponent(PluginContext.Provider, {
              value: ctx,
              get children() {
                return render()
              },
            })
          const before = rendering
          const reading = { pending: false, keys: new Set<string>() }
          rendering = reading
          try {
            const key = `compat.dialog.${++shows}`
            shown = {
              mounted: mount(provided, screen, panelChanged, crashed, focus, undefined, (feature) => unsupported(feature)),
              key,
              onClose,
              opened: false,
            }
          } finally {
            rendering = before
          }
          shown.mounted.keys = reading.keys
          untrack(() => read(`dialog-open:${shown!.key}`, { type: "dialog-open", key: shown!.key }))
          sendShown()
        },
        set(options: Json) {
          presentation = { size: options?.size ?? "medium", centered: !!options?.centered }
          if (shown) sendShown()
          // An alert's or a confirm's size and centering are not the contract's (CT-35: the joe-broadhead status
          // alerts at `large`): it would need them on `Alert` and `Confirm` (contract 2.x proposal, addition 4).
          else if (answering && (presentation.size !== "medium" || presentation.centered) && !uncarried) {
            uncarried = true
            console.warn(`plugin ${id}: dialog.set of an alert or a confirm is not carried; it shows at its own size`)
          }
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
        alert: (options: Json) =>
          ask({ type: "alert", title: options.title, message: options.message }).then(() => undefined),
        confirm: (options: Json) =>
          ask({
            type: "confirm",
            title: options.title,
            message: options.message,
            label: { confirm: options.label?.confirm, cancel: options.label?.cancel },
          }).then((answer) => (answer === undefined ? undefined : answer === "true")),
        prompt: (options: Json) => {
          if (options.value !== undefined) unsupported("ui.dialog.prompt value")
          if (options.description !== undefined) unsupported("ui.dialog.prompt description")
          return ask({ type: "prompt", title: options.title, placeholder: options.placeholder })
        },
        async select(options: Json) {
          if (options.actions?.length) unsupported("ui.dialog.select actions")
          const search = options.search
          const enabled = options.options.filter((option: Json) => !option.disabled)
          // The rows listed now, which an answer's index names: a plugin's search lists its own, flat and in its order,
          // with the category as the footer, as TS's does (FT-12).
          let listed: Json[] = search ? (search("", enabled) ?? []).filter((option: Json) => !option.disabled) : options.options
          const rows = () =>
            listed.map((option: Json, index: number) => ({
              title: option.title,
              value: String(index),
              description: option.description,
              footer: search ? (option.category ?? option.footer) : option.footer,
              category: search ? undefined : option.category,
              disabled: !!option.disabled,
            }))
          const current = () => {
            const at = listed.findIndex((option: Json) => option.value === options.current)
            return at === -1 ? {} : { current: String(at) }
          }
          // The host tells a plugin's search each query (P6c's `query`): it lists the rows the search returns, in place
          // under the select's key.
          const key = `search.${asked + 1}`
          // A new dialog is medium until the plugin's `dialog.set` says otherwise, as TS's.
          presentation = { size: "medium", centered: false }
          const dialog = () => ({
            type: "select",
            title: options.title,
            placeholder: options.placeholder,
            options: rows(),
            ...current(),
            ...(search ? { key, query: { type: "command", name: QUERY } } : {}),
            ...(["large", "xlarge"].includes(presentation.size) ? { size: presentation.size } : {}),
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
          // A select that replaced this one searches on.
          if (searching === run) searching = undefined
          // A keyed select stays open as a row is picked.
          if (search && answer !== undefined) void carrier.effect({ type: "dialog", dialog: { type: "close", key } })
          return answer === undefined ? undefined : listed[Number(answer)]?.value
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
          panelName = name
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
        current: () => (panelName ? { name: panelName, sessionID: route().sessionID ?? "" } : undefined),
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
          return surface(name, { type: "panel", name }, slotInput(path), claim.render, `slot ${path}`)
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
