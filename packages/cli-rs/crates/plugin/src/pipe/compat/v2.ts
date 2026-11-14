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
  createRoot,
  createSignal,
  getOwner,
  onCleanup,
  untrack,
} from "solid-js"
import { createStore, produce, reconcile, unwrap } from "solid-js/store"
import { homedir } from "node:os"
import { OpenCode } from "../../../../../../client/src/promise/generated/index"
import { RGBA, hexToRgb } from "./core"
import { legacy, missing, mount, serialize, type Mounted, type Screen, type VNode } from "./render"

type Json = any

// The carrier the JS host gives each plugin (`host.ts`).
export interface Carrier {
  surface(name: string, place: Json, view: (cx: Json) => Json, options?: Json): void
  command(command: Json, run: (input?: string) => unknown): void
  uncommand(name: string): void
  storage(keys: string[]): void
  on(types: string[], handler: (event: Json) => unknown): void
  effect(request: Json): Promise<Json>
  watch(key: string, request: Json): void
  unwatch(key: string): void
  read(key: string): Json
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

const SLOTS = new Set([
  "app",
  "home.footer",
  "home.footer.status",
  "prompt.footer",
  "prompt.footer.status",
  "prompt.footer.file",
  "session.composer.top",
  "session.panel",
  "sidebar.content",
  "sidebar.footer",
])

export function context(base: Base, carrier: Carrier) {
  const id = base.id
  const unsupported = (feature: string) => {
    const seen = reported.get(id) ?? new Set()
    reported.set(id, seen)
    if (seen.has(feature)) return
    seen.add(feature)
    console.warn(`plugin ${id}: ${feature} is not supported by opencode-native's JS host`)
    void carrier.effect({
      type: "toast",
      variant: "warning",
      title: "Plugin",
      message: `${id}: ${feature} is not supported by opencode-native yet`,
    })
  }

  // Reads: a watch per key, a signal per key that a snapshot bumps, and whether the render that runs read one the host
  // has not pushed yet.
  const versions = new Map<string, ReturnType<typeof createSignal<number>>>()
  const watched = new Set<string>()
  const pushed = new Set<string>()
  const waiters = new Map<string, Array<() => void>>()
  let rendering: { pending: boolean } | undefined
  carrier.listen((key) => {
    pushed.add(key)
    const version = versions.get(key)
    version?.[1]((value) => value + 1)
    waiters.get(key)?.splice(0).forEach((resolve) => resolve())
  })
  const read = (key: string, request: Json) => {
    let version = versions.get(key)
    if (!version) {
      version = createRoot(() => createSignal(0))
      versions.set(key, version)
    }
    version[0]()
    if (!watched.has(key)) {
      watched.add(key)
      carrier.watch(key, request)
    }
    if (!pushed.has(key) && rendering) rendering.pending = true
    return carrier.read(key)
  }
  const synced = (key: string, request: Json) =>
    new Promise<void>((resolve) => {
      untrack(() => read(key, request))
      if (pushed.has(key)) return resolve()
      waiters.set(key, [...(waiters.get(key) ?? []), resolve])
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
    list: () => {
      unsupported(`data.${name}`)
      return undefined
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

  const data = {
    on: base.data.on,
    listen() {
      unsupported("data.listen")
      return () => {}
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
      // The host's inbox is not a read: a session has no pending items, quietly, as one whose inbox is empty.
      pending: { list: () => [], sync: async () => {}, invalidate() {} },
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
      permission: none("session.permission"),
      form: { ...none("session.form"), reply: async () => unsupported("data.session.form"), cancel: async () => {} },
    },
    project: { ...none("project"), get: () => undefined, permission: none("project.permission") },
    shell: { ...none("shell"), get: () => undefined },
    location: {
      default: () => toRef(info()?.location) ?? { directory: process.cwd() },
      sync: async () => {},
      invalidate() {},
      vcs: {
        info: (location?: Json) =>
          read(`vcs:${locationKey(location)}`, { type: "vcs", location: locationOf(location) }) ?? undefined,
        sync: (location?: Json) => synced(`vcs:${locationKey(location)}`, { type: "vcs", location: locationOf(location) }),
        invalidate() {},
      },
      agent: none("location.agent"),
      command: none("location.command"),
      integration: collection("integrations"),
      mcp: { server: collection("mcp-servers"), resource: none("location.mcp.resource") },
      model: collection("models"),
      provider: {
        list: () => read("providers", { type: "providers" }) ?? undefined,
        sync: () => synced("providers", { type: "providers" }),
        invalidate() {},
      },
      reference: none("location.reference"),
      skill: none("location.skill"),
    },
  }

  // The theme, from the host's palette: each leaf a color that carries its token, so the host restyles it.
  const theme = (): Json => {
    const palette = carrier.palette()
    const tree: Json = {}
    for (const [token, hex] of Object.entries(palette.colors).sort(([a], [b]) => a.length - b.length)) {
      const parts = token.split(".")
      let at = tree
      for (const part of parts.slice(0, -1)) {
        if (!(part in at)) at[part] = {}
        at = at[part]
      }
      const last = parts[parts.length - 1]!
      const value = hexToRgb(hex)
      const rgba = new RGBA(value.r, value.g, value.b, value.a, token)
      at[last] = Object.assign(rgba, typeof at[last] === "object" ? at[last] : {})
    }
    return tree
  }

  // Internal commands: a click on a node, and a dialog's answer. The host runs a dialog's action with the answer as its
  // input, and one dialog shows at a time.
  const presses = new Map<string, (event: unknown) => unknown>()
  let answering: ((value: string | undefined) => void) | undefined
  const PRESS = `${id}.compat.press`
  const ANSWER = `${id}.compat.answer`
  carrier.command({ name: PRESS, title: PRESS }, (input) => {
    presses.get(input ?? "")?.({ type: "down", stopPropagation() {}, preventDefault() {} })
  })
  carrier.command({ name: ANSWER, title: ANSWER }, (input) => {
    const resolve = answering
    answering = undefined
    resolve?.(input ?? "")
  })
  const settle = () => {
    const resolve = answering
    answering = undefined
    resolve?.(undefined)
  }
  // The dialog this one replaces answers nothing, as TS resolves it with undefined. One closed with escape answers
  // only then: the host runs nothing for it.
  const ask = (dialog: Json) =>
    new Promise<string | undefined>((resolve) => {
      settle()
      unshow()
      answering = resolve
      void carrier.effect({ type: "dialog", dialog: { ...dialog, action: { type: "command", name: ANSWER } } })
    })

  // `ui.dialog.show`: the plugin's own JSX in the host's live panel dialog (`Dialog::Panel`), the contract's dialog that
  // shows a node, sent again under its key as the JSX changes. A bare panel: the host draws only the dialog's frame
  // around it, as TS does; a close of it (escape, the backdrop, another dialog) calls `onClose`, as TS's
  // `dialog.replace` does.
  const PANEL = "compat.dialog"
  let shown: { mounted: Mounted; onClose?: () => void; opened: boolean } | undefined
  let presentation = { size: "medium", centered: false }
  let resend = false
  const unshow = () => {
    const was = shown
    shown = undefined
    if (!was) return
    was.mounted.dispose()
    was.onClose?.()
  }
  const sendShown = () => {
    resend = false
    if (!shown) return
    const reading = {
      dropped: new Set<string>(),
      press(node: VNode, handler: (event: unknown) => unknown) {
        const name = `${PANEL}/${pressIndex(node)}`
        presses.set(name, handler)
        return { type: "command", name: PRESS, input: name }
      },
    }
    let body: Json
    try {
      body = legacy(serialize(shown.mounted.root, reading))
    } catch (error) {
      void carrier.effect({ type: "toast", variant: "error", title: "Plugin", message: `${id} crashed in dialog: ${error instanceof Error ? error.message : String(error)}` })
      unshow()
      return
    }
    for (const dropped of reading.dropped) unsupported(dropped)
    const size = ["large", "xlarge"].includes(presentation.size) ? presentation.size : "medium"
    void carrier.effect({
      type: "dialog",
      dialog: { type: "panel", key: PANEL, size, title: [], body, centered: presentation.centered, bare: true },
    })
  }
  const panelChanged = () => {
    if (!shown || resend) return
    resend = true
    queueMicrotask(sendShown)
  }
  carrier.listen((key) => {
    if (key !== `dialog-open:${PANEL}` || !shown) return
    const open = carrier.read(key) === true
    if (open) shown.opened = true
    else if (shown.opened) unshow()
  })

  // Surfaces: each mount renders its claim's JSX under a Solid root; its view reads that tree.
  const rendered = new Map<string, Mounted & { pending: number; input: Json; setInput: (input: Json) => void }>()
  const size = createRoot(() => createSignal({ width: 0, height: 0 }))
  // What `useTerminalDimensions` reads: the terminal's size, as the host says it.
  const screen: Screen = {
    width: () => info()?.size?.[0] || size[0]().width,
    height: () => info()?.size?.[1] || size[0]().height,
    renderer: {},
  }
  let claims = 0
  // A change of a tree asks for one view of the plugin's mounts once the code that changed it returned; a change
  // while a view reads the trees is in that view already.
  let viewing = false
  let scheduled = false
  const invalidate = () => {
    if (viewing || scheduled) return
    scheduled = true
    queueMicrotask(() => {
      scheduled = false
      carrier.invalidate()
    })
  }
  const surface = (name: string, place: Json, input: (cx: Json) => Json, render: (input: Json) => unknown, where: string) => {
    let removed = false
    const key = (cx: Json) => `${cx.mount.surface}\u0000${cx.mount.key}\u0000${cx.mount.generation}`
    // As TS's plugin boundary: the render shows nothing from now on, and one toast says why.
    const crashed = (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      void carrier.effect({ type: "toast", variant: "error", title: "Plugin", message: `${id} crashed in ${where}: ${message}` })
    }
    const view = (cx: Json) => {
      if (removed) return { type: "box" }
      viewing = true
      try {
        return draw(cx)
      } finally {
        viewing = false
      }
    }
    const draw = (cx: Json) => {
      if (cx.input.width || cx.input.height) size[1]({ width: cx.input.width, height: cx.input.height })
      let entry = rendered.get(key(cx))
      if (entry && !entry.crashed && JSON.stringify(entry.input) !== JSON.stringify(input(cx))) {
        entry.input = input(cx)
        entry.setInput(entry.input)
      }
      // A first render that read what the host has not pushed yet renders again once it came, a few times at most.
      const retry = (at: typeof entry) => !!at && at.pending > 0 && at.pending < 4 && !at.crashed
      if (!entry || (retry(entry) && [...watched].every((key) => pushed.has(key)))) {
        entry?.dispose()
        const tries = entry ? entry.pending : 0
        const value = input(cx)
        const [props, setProps] = createStore(structuredClone(value))
        const reading = { pending: false }
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
          mounted = mount(provided, screen, invalidate, crashed)
        } finally {
          rendering = before
        }
        entry = Object.assign(mounted, {
          pending: reading.pending ? tries + 1 : 0,
          input: value,
          setInput: (next: Json) => setProps(reconcile(structuredClone(next))),
        })
        rendered.set(key(cx), entry)
      }
      if (retry(entry)) return undefined
      const reading = {
        dropped: new Set<string>(),
        press(node: VNode, handler: (event: unknown) => unknown) {
          const name = `${key(cx)}/${pressIndex(node)}`
          presses.set(name, handler)
          return { type: "command", name: PRESS, input: name }
        },
      }
      try {
        const tree = serialize(entry.root, reading)
        for (const dropped of [...reading.dropped, ...missing]) unsupported(dropped)
        return tree
      } catch (error) {
        crashed(error)
        entry.crashed = String(error)
        entry.dispose()
        entry.root.children = []
        return { type: "box" }
      }
    }
    // No palette input: the colors carry their tokens, so a theme change restyles the last tree in place, and the
    // context's `theme` follows `Down::Theme`. A surface that read the palette would be viewed again instead, and keep
    // its old colors, as its tree did not change.
    carrier.surface(name, place, view, {
      unmount(mount: Json) {
        const at = `${mount.surface}\u0000${mount.key}\u0000${mount.generation}`
        rendered.get(at)?.dispose()
        rendered.delete(at)
      },
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

  const client = OpenCode.make({
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

  const commands = (layer: Json) => {
    const names: string[] = []
    for (const command of layer?.commands ?? []) {
      const name = command.id ?? `${id}.inline-${++inline}`
      names.push(name)
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
          ...(command.scope ? { scope: command.scope } : {}),
        },
        (input) => command.run(input),
      )
    }
    return names
  }
  let inline = 0

  const toasts = (options: Json) => ({
    type: "toast",
    variant: options.variant ?? "info",
    message: options.message,
    ...(options.title ? { title: options.title } : {}),
    ...(options.sessionID ? { session: options.sessionID } : {}),
  })

  const renderer = new Proxy(
    {
      requestRender: () => invalidate(),
      get width() {
        return size[0]().width || info()?.size?.[0] || 0
      },
      get height() {
        return size[0]().height || info()?.size?.[1] || 0
      },
    } as Json,
    {
      get(target, name) {
        if (name in target || typeof name === "symbol") return target[name]
        unsupported(`renderer.${String(name)}`)
        return undefined
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
        const when = (value: Json) => (typeof value === "object" ? (value.when ?? "always") : value ? "always" : undefined)
        await carrier.effect({
          type: "attention",
          ...(options.title ? { title: options.title } : {}),
          message: options.message,
          ...(when(options.notification) ? { notify: when(options.notification) } : {}),
          ...(options.sound
            ? {
                sound: {
                  name: options.sound.name ?? "default",
                  when: options.sound.when ?? "always",
                  ...(options.sound.volume === undefined ? {} : { volume: options.sound.volume }),
                },
              }
            : {}),
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
      layer(factory: () => Json) {
        const names = commands(untrack(factory))
        carrier.changed()
        if (getOwner())
          onCleanup(() => {
            names.forEach((name) => carrier.uncommand(name))
            carrier.changed()
          })
      },
      dispatch(name: string, input?: string) {
        void carrier.effect({ type: "dispatch", name, ...(input === undefined ? {} : { input }) })
      },
      shortcuts: (name: string) => read(`shortcuts:${name}`, { type: "shortcuts", name }) ?? [],
      commands: () =>
        (read("keymap-commands", { type: "keymap-commands" }) ?? []).map((command: Json) => ({
          ...command,
          slash: command.slash,
          run() {},
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
        const update = async (mutation: (draft: Json) => void) => {
          const draft = structuredClone(unwrap(store))
          mutation(draft)
          await carrier.effect({ type: "storage-set", key, value: JSON.stringify(draft) })
          batch(() => setStore(reconcile(draft)))
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
          settle()
          unshow()
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
          shown = { mounted: mount(provided, screen, panelChanged, crashed), onClose, opened: false }
          untrack(() => read(`dialog-open:${PANEL}`, { type: "dialog-open", key: PANEL }))
          sendShown()
        },
        set(options: Json) {
          presentation = { size: options?.size ?? "medium", centered: !!options?.centered }
          if (shown) sendShown()
        },
        clear() {
          settle()
          if (!shown) return
          void carrier.effect({ type: "dialog", dialog: { type: "close", key: PANEL } })
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
        prompt: (options: Json) => ask({ type: "prompt", title: options.title, placeholder: options.placeholder }),
        async select(options: Json) {
          if (options.search) unsupported("ui.dialog.select search")
          if (options.actions?.length) unsupported("ui.dialog.select actions")
          const values: Json[] = options.options.map((option: Json) => option.value)
          const current = values.indexOf(options.current)
          const answer = await ask({
            type: "select",
            title: options.title,
            placeholder: options.placeholder,
            options: options.options.map((option: Json, index: number) => ({
              title: option.title,
              value: String(index),
              description: option.description,
              footer: option.footer,
              category: option.category,
              disabled: !!option.disabled,
            })),
            ...(current === -1 ? {} : { current: String(current) }),
          })
          return answer === undefined ? undefined : values[Number(answer)]
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
        // A path the host does not publish degrades as TS's does: to the nearest published ancestor, appended.
        const at = SLOTS.has(path) ? path : ancestor(path)
        if (!at) return () => {}
        return surface(
          name,
          { type: "slot", kind: at === path ? kind : "append", path: at },
          slotInput(at),
          claim.render,
          `slot ${path}`,
        )
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

function ancestor(path: string) {
  for (let index = path.lastIndexOf("."); index !== -1; index = path.lastIndexOf(".", index - 1)) {
    const at = path.slice(0, index)
    if (SLOTS.has(at)) return at
  }
  return undefined
}
