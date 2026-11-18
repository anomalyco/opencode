import { expect, test } from "bun:test"
import { context, modules } from "./compat.js"

type Json = any

const runtime = modules["@opentui/solid/jsx-runtime"] as Json
const solid = modules["solid-js"] as Json
const h = (type: Json, props: Json = {}) => runtime.jsx(type, props)
const turn = () => new Promise((resolve) => setTimeout(resolve, 0))

// A carrier as `host.ts` gives one, over a host that watches at most `limit` reads and answers each watch with the
// value `answer` gives (`undefined`: never; a string: the error it fails with).
function host(answer: (key: string) => Json = () => [], limit = 128) {
  const snapshots = new Map<string, Json>()
  const errors = new Map<string, string>()
  const listeners: Array<(key: string) => void> = []
  const fake = {
    surfaces: [] as Json[],
    // The dialog surface every plugin registers for `ui.dialog.show`, apart from the surfaces the plugin registers.
    dialogs: [] as Json[],
    commands: new Map<string, (input?: string) => unknown>(),
    effects: [] as Json[],
    watches: new Set<string>(),
    stored: new Map<string, string>(),
    meta: new Map<string, Json>(),
    push(key: string, value: Json, error?: string) {
      if (error) {
        snapshots.delete(key)
        errors.set(key, error)
      } else {
        snapshots.set(key, value)
        errors.delete(key)
      }
      for (const listener of [...listeners]) listener(key)
    },
    surface(name: string, place: Json, view: Json, options: Json) {
      if (place.type === "dialog") return void fake.dialogs.push({ name, place, view, options })
      fake.surfaces.push({ name, place, view, options })
      return fake.surfaces.length - 1
    },
    layers: [] as Json[],
    layer(layer: Json, handler: (event: Json) => unknown) {
      fake.layers.push({ layer, handler })
      return fake.layers.length - 1
    },
    // what the listeners of every key said they can take, last first, as `host.ts` sends each change.
    taken: [] as Json[],
    takes(listener: Json) {
      return fake.taken.findLast((at: Json) => JSON.stringify(at.listener) === JSON.stringify(listener))?.on ?? false
    },
    command(command: Json, run: (input?: string) => unknown) {
      fake.commands.set(command.name, run)
      fake.meta.set(command.name, command)
    },
    // As `host.ts`'s: a command's state the host holds, told as it changes, and what runs as each call ends.
    enable(name: string, enabled: boolean) {
      const meta = fake.meta.get(name)
      if (meta) meta.enabled = enabled
    },
    afterCalls: [] as Array<() => void>,
    afterCall(run: () => void) {
      fake.afterCalls.push(run)
    },
    // A call into the plugin ends.
    called() {
      for (const run of fake.afterCalls) run()
    },
    uncommand() {},
    storage() {},
    taking(listener: Json, on: boolean) {
      fake.taken.push({ listener, on })
    },
    claims: [] as Json[],
    claim(target: Json, view: (part: Json) => Json) {
      const claim = { target, view, ended: false }
      fake.claims.push(claim)
      return () => {
        claim.ended = true
      }
    },
    subscriptions: [] as Json[],
    on(types: string[], handler: (event: Json) => unknown) {
      fake.subscriptions.push({ types, handler })
    },
    async effect(request: Json, mount?: Json) {
      // The mount a request names, as `host.ts` sends it (a field's focus, of the mount whose tree holds it).
      fake.effects.push(mount ? { ...request, mount } : request)
      await turn()
      if (request.type === "storage-get") return fake.stored.get(request.key) ?? null
      // As the host's: a write answers whether it was kept.
      if (request.type === "storage-set") fake.stored.set(request.key, request.value)
      // Merged into what is stored as it is written.
      if (request.type === "storage-merge")
        fake.stored.set(request.key, JSON.stringify({ ...JSON.parse(fake.stored.get(request.key) ?? "{}"), ...request.fields }))
      if (request.type === "storage-set" || request.type === "storage-merge") return true
      return null
    },
    watch(key: string) {
      if (!fake.watches.has(key) && fake.watches.size >= limit) {
        queueMicrotask(() => fake.push(key, undefined, `the plugin watches ${limit} reads already`))
        return
      }
      fake.watches.add(key)
      const value = key.startsWith("storage:") ? (fake.stored.get(key.slice(8)) ?? null) : answer(key)
      if (value !== undefined) queueMicrotask(() => (typeof value === "string" && value.startsWith("error:") ? fake.push(key, undefined, value.slice(6)) : fake.push(key, value)))
    },
    unwatch(key: string) {
      fake.watches.delete(key)
      snapshots.delete(key)
    },
    read: (key: string) => snapshots.get(key),
    readError: (key: string) => errors.get(key),
    listen(listener: (key: string) => void) {
      listeners.push(listener)
    },
    invalidate() {},
    fetch: async () => ({}),
    palette: () => ({ mode: "dark", colors: {} }),
    changed() {},
    toasts: () => fake.effects.filter((effect) => effect.type === "toast").map((effect) => effect.message),
    warnings: () =>
      fake.effects.filter((effect) => effect.type === "log" && effect.level === "warn").map((effect) => effect.message),
  }
  return fake
}

function plugin(id: string, fake: Json) {
  const base = { id, options: {}, app: { version: "", channel: "" }, themeMode: "dark", data: { on: () => () => {} } }
  return context(base, fake) as Json
}

// The view of the surface `index` for mount `key`, with its input.
function view(fake: Json, index: number, key: string, slot: Json = {}) {
  const cx = { mount: { surface: `slot#${index}`, key, generation: 1 }, input: { width: 40, height: 10, slot } }
  return {
    draw: () => fake.surfaces[index].view(cx),
    unmount: () => fake.surfaces[index].options.unmount(cx.mount),
  }
}

// The view of the plugin's dialog surface for the mount of `ui.dialog.show`'s `key`.
function dialogView(fake: Json, key: string, generation = 1) {
  const cx = { mount: { surface: "compat.dialog", key, generation }, input: { width: 40, height: 10 } }
  return {
    mount: cx.mount,
    draw: () => fake.dialogs[0].view(cx),
    unmount: () => fake.dialogs[0].options.unmount(cx.mount),
  }
}

// The dialog surfaces `ui.dialog.show` asked the host for, in order, each as it waits for its close.
const surfaces = (fake: Json): Json[] =>
  fake.effects
    .map((effect: Json) => (effect.dialog?.type === "dismissable" ? effect.dialog.dialog : effect.dialog))
    .filter((dialog: Json) => dialog?.type === "surface")

// Their keys.
const surfaceKeys = (fake: Json): string[] => surfaces(fake).map((dialog: Json) => dialog.key)

const text = (tree: Json): string =>
  tree === undefined ? "<none>" : [...(tree.spans ?? []).map((span: Json) => span.text), ...(tree.children ?? []).map(text)].join("")

test("reads past the host's bound are released, not lost", async () => {
  const fake = host((key) => (key.startsWith("messages:") ? [{ id: key }] : []))
  const ctx = plugin("t.reads", fake)
  for (let index = 0; index < 140; index++) {
    await ctx.data.session.message.sync(`s${index}`)
    expect(ctx.data.session.message.list(`s${index}`)).toEqual([{ id: `messages:s${index}` }])
  }
  expect(fake.watches.size).toBeLessThanOrEqual(128)
  ctx.ui.slot({
    append: "sidebar.content",
    render: (props: Json) => h(() => h("text", { children: `n ${ctx.data.session.message.list(props.sessionID).length}` })),
  })
  const mount = view(fake, 0, "a", { session_id: "s199" })
  mount.draw()
  await turn()
  expect(text(mount.draw())).toBe("n 1")
})

test("a read the host could not answer rejects its sync", async () => {
  const fake = host((key) => (key === "messages:big" ? "error:the read is 300000 bytes, over 262144" : []))
  const ctx = plugin("t.errors", fake)
  await expect(ctx.data.session.message.sync("big")).rejects.toThrow("over 262144")
  await expect(ctx.data.session.message.sync("small")).resolves.toBeUndefined()
  await expect(ctx.data.session.message.sync("big")).rejects.toThrow("over 262144")
  expect(fake.warnings()).toEqual(["t.errors: a read failed: the read is 300000 bytes, over 262144"])
})

test("a view waits for its own reads only", async () => {
  const fake = host((key) => (key === "messages:never" ? undefined : [1, 2]))
  const ctx = plugin("t.deps", fake)
  void ctx.data.session.message.sync("never")
  ctx.ui.slot({
    append: "sidebar.content",
    render: (props: Json) => h(() => h("text", { children: `n ${ctx.data.session.message.list(props.sessionID).length}` })),
  })
  const mount = view(fake, 0, "a", { session_id: "s1" })
  mount.draw()
  await turn()
  expect(text(mount.draw())).toBe("n 2")
})

test("storage updates apply in turn to the latest value", async () => {
  const fake = host()
  fake.stored.set("view", JSON.stringify({ open: true }))
  const ctx = plugin("t.store", fake)
  const [view, update] = ctx.storage.store("view", { initial: { open: true } })
  await turn()
  const toggle = (draft: Json) => {
    draft.open = !draft.open
  }
  await Promise.all([update(toggle), update(toggle)])
  expect(JSON.parse(fake.stored.get("view")!)).toEqual({ open: true })
  fake.stored.set("view", JSON.stringify({ open: true, sibling: 99 }))
  await update(toggle)
  expect(JSON.parse(fake.stored.get("view")!)).toEqual({ open: false, sibling: 99 })
  expect(view.open).toBe(false)
})

test("a layer keeps its conditions and ends with its component", async () => {
  const fake = host()
  const ctx = plugin("t.layer", fake)
  const [on, setOn] = solid.createSignal(false)
  const ran: string[] = []
  ctx.keymap.layer(() => ({ enabled: on(), commands: [{ id: "t.gated", run: () => ran.push("gated") }] }))
  expect(fake.meta.get("t.gated").enabled).toBe(false)
  expect(fake.commands.get("t.gated")!()).toBe(false)
  setOn(true)
  expect(fake.meta.get("t.gated").enabled).toBe(true)
  fake.commands.get("t.gated")!()
  ctx.keymap.layer(() => ({ mode: "global", commands: [{ id: "t.global", run() {} }] }))
  expect([fake.meta.get("t.gated").scope, fake.meta.get("t.global").scope]).toEqual(["base", undefined])
  let dispose = () => {}
  solid.createRoot((end: () => void) => {
    dispose = end
    ctx.keymap.layer(() => ({ commands: [{ id: "t.mounted", run: () => ran.push("mounted") }] }))
  })
  fake.commands.get("t.mounted")!()
  dispose()
  fake.commands.get("t.mounted")!()
  expect(ran).toEqual(["gated", "mounted"])
})

test("a command's enabled is followed as what it reads changes", () => {
  const fake = host()
  const ctx = plugin("t.enabled", fake)
  const ran: string[] = []
  const session = () => ctx.ui.router.current().type === "session"
  ctx.keymap.layer(() => ({ commands: [{ id: "t.here", bind: "r", enabled: session, run: () => ran.push("here") }] }))
  expect(fake.meta.get("t.here").enabled).toBe(false)
  expect(fake.commands.get("t.here")!()).toBe(false)
  fake.push("route", { type: "session", id: "ses_1" })
  expect(fake.meta.get("t.here").enabled).toBe(true)
  fake.commands.get("t.here")!()
  fake.push("route", { type: "home" })
  expect(fake.meta.get("t.here").enabled).toBe(false)
  expect(ran).toEqual(["here"])
  expect(fake.watches.has("route")).toBe(true)
})

test("a command two layers hold is enabled while either is, and goes with the last", () => {
  const fake = host()
  const ctx = plugin("t.shared", fake)
  const ran: string[] = []
  const [searching, setSearching] = solid.createSignal(false)
  const [listed, setListed] = solid.createSignal(true)
  const page = (run: (input?: string) => unknown) => [{ id: "t.page", bind: "pageup", run }]
  ctx.keymap.layer(() => ({ enabled: !searching(), commands: page(() => ran.push("list")) }))
  let end = () => {}
  solid.createRoot((dispose: () => void) => {
    end = dispose
    ctx.keymap.layer(() => ({ enabled: searching(), commands: page((input?: string) => ran.push(`search ${input}`)) }))
  })
  const state = () => fake.meta.get("t.page").enabled
  expect(state()).toBe(true)
  fake.commands.get("t.page")!()
  setSearching(true)
  expect(state()).toBe(true)
  fake.commands.get("t.page")!("x")
  expect(ran).toEqual(["list", "search x"])
  // The newer layer ends while it is the enabled one: the older, disabled, is all that holds the command.
  end()
  expect(state()).toBe(false)
  expect(fake.commands.get("t.page")!()).toBe(false)
  setSearching(false)
  expect(state()).toBe(true)
  ctx.keymap.layer(() => ({ commands: listed() ? [{ id: "t.drop", bind: "j", run() {} }] : [] }))
  expect(fake.meta.get("t.drop").enabled).toBe(true)
  setListed(false)
  expect(fake.meta.get("t.drop").enabled).toBe(false)
})

test("a command's enabled follows a field's focus, the open panel and the theme", () => {
  const fake = host()
  const app = { version: "", channel: "" }
  const base = { id: "t.reads", options: {}, app, themeMode: "dark", data: { on: () => () => {} } }
  const ctx = context(base, fake) as Json
  const refs: Json = {}
  ctx.keymap.layer(() => ({
    commands: [
      { id: "t.explore", bind: "j", enabled: () => !refs.search?.focused, run() {} },
      { id: "t.panel", bind: "g", enabled: () => !!ctx.ui.panel.current(), run() {} },
      { id: "t.light", bind: "l", enabled: () => ctx.themeMode === "light", run() {} },
    ],
  }))
  const field = () => h("input", { id: "search", ref: (el: Json) => (refs.search = el) })
  ctx.ui.router.register({ name: "f", render: field })
  const route = fake.surfaces.find((surface: Json) => surface.place.type === "route")
  route.view({ mount: { surface: "f", key: "a", generation: 1 }, input: { width: 40, height: 10 } })
  // The ref came with the view, outside a call: the next call's end asks again.
  fake.called()
  const state = (name: string) => fake.meta.get(name).enabled
  expect([state("t.explore"), state("t.panel"), state("t.light")]).toEqual([true, false, false])
  refs.search.focus()
  expect(state("t.explore")).toBe(false)
  refs.search.blur()
  expect(state("t.explore")).toBe(true)
  ctx.ui.slot({ append: "session.panel", render: () => h("text", { children: "panel" }) })
  fake.push("route", { type: "session", id: "ses_1" })
  expect(ctx.ui.panel.open("notes")).toBe(true)
  expect(state("t.panel")).toBe(true)
  const panel = fake.surfaces.find((surface: Json) => surface.place.type === "panel")
  panel.options.unmount({ surface: panel.name, key: "a", generation: 1 })
  expect(state("t.panel")).toBe(false)
  base.themeMode = "light"
  fake.push("theme", undefined)
  expect(state("t.light")).toBe(true)
})

test("an enabled the layer cannot follow is asked as the key comes, and after each call", () => {
  const fake = host()
  const ctx = plugin("t.plain", fake)
  const ran: string[] = []
  let open = false
  const [shown] = solid.createSignal(true)
  ctx.keymap.layer(() => ({
    commands: [
      { id: "t.plain", bind: "p", enabled: () => open, run: () => ran.push("plain") },
      { id: "t.mixed", bind: "m", enabled: () => shown() && open, run: () => ran.push("mixed") },
      { id: "t.open", run: () => void (open = !open) },
    ],
  }))
  expect([fake.meta.get("t.plain").enabled, fake.meta.get("t.mixed").enabled]).toEqual([true, false])
  expect(fake.commands.get("t.plain")!()).toBe(false)
  fake.commands.get("t.open")!()
  fake.called()
  expect([fake.meta.get("t.plain").enabled, fake.meta.get("t.mixed").enabled]).toEqual([true, true])
  fake.commands.get("t.plain")!()
  fake.commands.get("t.mixed")!()
  expect(ran).toEqual(["plain", "mixed"])
})

test("a command's enabled holds only the reads it makes now", async () => {
  const fake = host((key) => (key.startsWith("messages:") ? [] : undefined))
  const ctx = plugin("t.many", fake)
  const [session, setSession] = solid.createSignal("s0")
  ctx.keymap.layer(() => ({
    commands: [{ id: "t.many", enabled: () => ctx.data.session.message.list(session()).length >= 0, run() {} }],
  }))
  // A layer whose commands are what it reads: the factory's reads, likewise.
  ctx.keymap.layer(() => ({
    commands: ctx.data.session.message.list(`f${session()}`).length ? [] : [{ id: "t.listed", run() {} }],
  }))
  for (let index = 1; index < 140; index++) setSession(`s${index}`)
  await turn()
  await expect(ctx.data.session.message.sync("other")).resolves.toBeUndefined()
  expect(fake.watches.size).toBeLessThanOrEqual(128)
})

test("a layer's commands without an id keep their names when it mounts again", () => {
  const fake = host()
  const ctx = plugin("t.inline", fake)
  const ran: string[] = []
  const mount = (round: number) => {
    let dispose = () => {}
    solid.createRoot((end: () => void) => {
      dispose = end
      ctx.keymap.layer(() => ({
        commands: [
          { bind: "escape", title: "back", run: () => ran.push(`back ${round}`) },
          { bind: "j", title: "next", run: () => ran.push(`j ${round}`) },
          { bind: "j", title: "next", run: () => ran.push(`j again ${round}`) },
        ],
      }))
    })
    return dispose
  }
  const end = mount(1)
  const first = [...fake.commands.keys()].filter((name) => name.startsWith("t.inline.inline-"))
  expect(first.length).toBe(3)
  end()
  mount(2)
  expect([...fake.commands.keys()].filter((name) => name.startsWith("t.inline.inline-"))).toEqual(first)
  for (const name of first) fake.commands.get(name)!()
  expect(ran).toEqual(["back 2", "j 2", "j again 2"])
})

test("client.rpc calls a plugin's own server RPC and hears its events", async () => {
  const fake = host()
  const fetched: Json[] = []
  fake.fetch = async (request: Json) => {
    fetched.push(request)
    return { Ok: { output: { echoed: request.body.input } } }
  }
  const listeners = new Map<string, Array<(event: Json) => void>>()
  const base = {
    id: "t.rpc",
    options: {},
    app: { version: "", channel: "" },
    themeMode: "dark",
    data: {
      on(type: string, handler: (event: Json) => void) {
        listeners.set(type, [...(listeners.get(type) ?? []), handler])
        return () => listeners.set(type, (listeners.get(type) ?? []).filter((at) => at !== handler))
      },
    },
  }
  const ctx = context(base, fake) as Json
  const Rpc = (modules["@opencode/plugin/rpc"] as Json).Rpc
  const Echo = Rpc.define({ id: "echo", methods: { say: { input: {}, output: {} } }, events: { said: { schema: {} } } })
  const echo = ctx.client.rpc(Echo)
  expect(await echo.say({ text: "hi" }, { location: { directory: "/d" } })).toEqual({ echoed: { text: "hi" } })
  expect(fetched.map((request) => [request.method, request.path, request.body])).toEqual([
    ["POST", "/api/rpc/echo/say", { input: { text: "hi" } }],
  ])
  expect(fetched[0].query).toEqual([["location[directory]", "/d"]])
  expect(typeof ctx.client.rpc.call).toBe("function")
  const heard: Json[] = []
  const off = echo.events.on("said", (event: Json) => heard.push(event.data))
  const events = echo.events.subscribe("said")[Symbol.asyncIterator]()
  const next = events.next()
  for (const listener of listeners.get("rpc.echo.said") ?? []) listener({ type: "rpc.echo.said", data: 1 })
  expect((await next).value.data).toBe(1)
  off()
  await events.return()
  for (const listener of listeners.get("rpc.echo.said") ?? []) listener({ type: "rpc.echo.said", data: 2 })
  expect(heard).toEqual([1])
  expect(() => echo.events.on("unknown", () => {})).toThrow("Unknown RPC event: echo.unknown")
})

test("a StyledText content draws its chunks", () => {
  const fake = host()
  const ctx = plugin("t.styled", fake)
  const core = modules["@opentui/core"] as Json
  ctx.ui.slot({
    append: "home.footer",
    render: () => {
      const node = h("text", {}) as Json
      node.content = new core.StyledText([core.bold("Panel"), core.fg("#ff0000")(" red"), ...core.t`, ${core.bold("x")}!`.chunks])
      return node
    },
  })
  const tree = view(fake, 0, "a").draw()
  const spans = tree.children[0].spans as Json[]
  expect(spans.map((at) => at.text).join("")).toBe("Panel red, x!")
  expect(spans[0].bold).toBe(true)
  expect(spans[1].fg).toEqual(expect.anything())
  expect(spans[1].bold).toBeUndefined()
  expect(core.isStyledText(core.stringToStyledText("s"))).toBe(true)
})

test("a node with a fixed size does not shrink by default", () => {
  const fake = host()
  const ctx = plugin("t.shrink", fake)
  ctx.ui.slot({
    append: "home.footer",
    render: () =>
      h("box", {
        flexDirection: "row",
        get children() {
          return [
            h("text", { width: 14, children: "analyst" }),
            h("text", { width: 14, flexShrink: 1, children: "b" }),
            h("text", { children: "model" }),
          ]
        },
      }),
  })
  const row = view(fake, 0, "a").draw().children[0]
  expect(row.children.map((node: Json) => node.layout?.shrink)).toEqual([false, true, undefined])
})

test("a Portal draws its children over the mount's room", () => {
  const fake = host()
  const ctx = plugin("t.portal", fake)
  const solidRuntime = modules["@opentui/solid"] as Json
  let container: Json
  ctx.ui.slot({
    append: "app",
    render: () =>
      solidRuntime.createComponent(solidRuntime.Portal, {
        ref: (el: Json) => (container = el),
        get children() {
          return h("box", { position: "absolute", bottom: 0, left: 0, right: 0, children: h("text", { children: "pane" }) })
        },
      }),
  })
  const tree = view(fake, 0, "a").draw()
  const portal = tree.children[0]
  expect(portal.layout.absolute).toEqual({ top: 0, right: 0, bottom: 0, left: 0, z: 1 })
  expect(text(portal)).toBe("pane")
  expect(container).toBeDefined()
  expect(fake.toasts()).toEqual([])
})

test("@opencode/plugin/effect serves Rpc", () => {
  const effect = modules["@opencode/plugin/effect"] as Json
  expect(effect.Rpc).toBe((modules["@opencode/plugin/rpc"] as Json).Rpc)
  expect("Agent" in effect && effect.Agent === undefined).toBe(true)
})

test("an element's focus is the host's and it emits as OpenTUI's renderables", async () => {
  const fake = host()
  const ctx = plugin("t.focus", fake)
  const refs: Json = {}
  const heard: string[] = []
  ctx.ui.slot({
    append: "sidebar.content",
    render: () =>
      h("box", {
        ref: (el: Json) => (refs.box = el),
        get children() {
          return [
            h("input", { id: "search", ref: (el: Json) => (refs.search = el) }),
            h("input", { ref: (el: Json) => (refs.other = el) }),
            h("scrollbox", { id: "list", ref: (el: Json) => (refs.list = el) }),
          ]
        },
      }),
  })
  view(fake, 0, "a").draw()
  expect(refs.search.on("focus", () => heard.push("focus"))).toBe(refs.search)
  refs.search.on("focused", () => heard.push("search focused")).on("blurred", () => heard.push("search blurred"))
  refs.search.focus()
  refs.other.focus()
  refs.other.blur()
  refs.box.focus()
  await turn()
  expect(heard).toEqual(["search focused", "search blurred"])
  const focus = fake.effects.filter((effect: Json) => effect.type === "focus" || effect.type === "blur")
  expect(focus.map((effect: Json) => effect.node ?? effect.type)).toEqual(["search", expect.stringMatching(/^opentui-input-/), "blur"])
  expect(refs.box.focused).toBe(true)
  // A scroll box's position is the host's read of it; before it came, its viewport scrolls nothing; a move is the
  // contract's verb on the surface's scroll.
  expect([refs.list.scrollTop, refs.list.viewport.height]).toEqual([0, Infinity])
  const surface = fake.surfaces[0].name
  fake.push(`scroll:${surface}:list`, { offset: 4, viewport: 10, extent: 30 })
  expect([refs.list.scrollTop, refs.list.viewport.height, refs.list.scrollHeight]).toEqual([4, 10, 30])
  refs.list.scrollBy(2)
  // `scrollChildIntoView` is the least scroll that shows the row (opencode-session-manager's selection).
  refs.list.scrollChildIntoView("row-3")
  // A move past the content is the edge, as OpenTUI clamps it, within the host's i32 (CT-42: opencode-omeglecode's
  // `scrollTo(Number.MAX_SAFE_INTEGER)` ended the JS host).
  refs.list.scrollTo(Number.MAX_SAFE_INTEGER)
  refs.list.scrollTo(-Infinity)
  await turn()
  const target = { type: "node", surface, id: "list" }
  expect(fake.effects.filter((effect: Json) => effect.type === "scroll")).toEqual([
    { type: "scroll", target, verb: { type: "offset", offset: 6 } },
    { type: "scroll", target, verb: { type: "to", node: "row-3", align: { type: "nearest" } } },
    { type: "scroll", target, verb: { type: "offset", offset: 2 ** 31 - 1 } },
    { type: "scroll", target, verb: { type: "offset", offset: -(2 ** 31) } },
  ])
  expect(fake.watches.has(`scroll:${surface}:list`)).toBe(true)
})

test("a renderable added inside itself throws", () => {
  const { BoxRenderable } = modules["@opentui/core"] as Json
  const outer = new BoxRenderable(undefined, {})
  const inner = new BoxRenderable(undefined, {})
  outer.add(inner)
  expect(() => outer.add(outer)).toThrow("cannot be added inside itself")
  expect(() => inner.add(outer)).toThrow("cannot be added inside itself")
  expect([outer.parent, inner.parent === outer, outer.getChildren().length]).toEqual([undefined, true, 1])
})

test("a dialog cleared or replaced before it is built never shows", async () => {
  const fake = host()
  const ctx = plugin("t.stale", fake)
  const shown = () => fake.effects.filter((effect: Json) => effect.type === "dialog").map((effect: Json) => JSON.stringify(effect))
  const answers: unknown[] = []
  void ctx.ui.dialog.alert({ title: "StaleAlert", message: "m" }).then((value: unknown) => answers.push(value))
  ctx.ui.dialog.clear()
  void ctx.ui.dialog.confirm({ title: "StaleConfirm", message: "m" }).then((value: unknown) => answers.push(value))
  ctx.ui.dialog.show(() => h("text", { children: "LiveShow" }))
  await turn()
  await turn()
  expect(shown().filter((dialog: string) => dialog.includes("Stale"))).toEqual([])
  const [key] = surfaceKeys(fake)
  expect(text(dialogView(fake, key!).draw())).toBe("LiveShow")
  expect(answers).toEqual([undefined, undefined])
})

test("a focused field the plugin removes has the focus no more", async () => {
  const fake = host()
  const ctx = plugin("t.removed", fake)
  const refs: Json = {}
  const [shown, setShown] = solid.createSignal(true)
  const [first, setFirst] = solid.createSignal(true)
  const ran: string[] = []
  ctx.ui.router.register({ name: "r", render: () => {
    ctx.keymap.layer(() => ({ target: () => refs.q, commands: [{ id: "t.removed.run", run: () => void ran.push("ran") }] }))
    return h("box", {
      get children() {
        const field = h("input", { id: "q", ref: (el: Json) => (refs.q = el) })
        const other = h("text", { children: "other" })
        return () => (!shown() ? [other] : first() ? [field, other] : [other, field])
      },
    })
  } })
  const route = fake.surfaces.find((surface: Json) => surface.place.type === "route")
  route.view({ mount: { surface: "r", key: "a", generation: 1 }, input: { width: 40, height: 10 } })
  const heard: string[] = []
  refs.q.on("blurred", () => heard.push("blurred"))
  refs.q.focus()
  await turn()
  const run = () => fake.commands.get("t.removed.run")!()
  run()
  setFirst(false)
  await turn()
  run()
  expect([refs.q.focused, ran.length, heard]).toEqual([true, 2, []])
  const removed = refs.q
  setShown(false)
  await turn()
  run()
  expect([removed.focused, ran.length, heard]).toEqual([false, 2, ["blurred"]])
})

test("keys reach keyInput, useKeyboard and a focused field", () => {
  const fake = host()
  const ctx = plugin("t.keys", fake)
  const heard: string[] = []
  const describe = (event: Json) =>
    `${["ctrl", "shift", "meta", "super", "hyper"].filter((held) => event[held]).join("+")} ${event.name} ${JSON.stringify(event.sequence)}`
  expect(fake.layers).toEqual([])
  ctx.renderer.keyInput.on("keypress", (event: Json) => heard.push(`input ${describe(event)}`))
  expect(fake.layers.map((at: Json) => at.layer)).toEqual([{ scope: "global", any: true }])
  const press = (key: string, text?: string) => fake.layers[0].handler({ type: "key", key, ...(text ? { text } : {}) })
  const solidRuntime = modules["@opentui/solid"] as Json
  ctx.ui.slot({
    append: "home.footer",
    render: () => (solidRuntime.useKeyboard((event: Json) => heard.push(`hook ${event.name}`)), h("text", { children: "k" })),
  })
  const footer = view(fake, 0, "a")
  footer.draw()
  // Contract gaps 2: a listener takes its key with `preventDefault`, else the key goes on.
  const taking = (event: Json) => event.name === "a" && event.preventDefault()
  ctx.renderer.keyInput.on("keypress", taking)
  expect([press("ctrl+,"), press("shift+enter"), press("a", "a")]).toEqual(["pass", "pass", "consume"])
  ctx.renderer.keyInput.off("keypress", taking)
  footer.unmount()
  press("ctrl+shift+meta++")
  expect(heard).toEqual([
    'input ctrl , ""',
    "hook ,",
    'input shift return "\\r"',
    "hook return",
    'input  a "a"',
    "hook a",
    'input ctrl+shift+meta + ""',
  ])
  expect(fake.layers.length).toBe(1)

  const field: Json = {}
  const events: string[] = []
  ctx.ui.router.register({
    name: "files",
    render: () =>
      h("input", {
        ref: (el: Json) => (field.ref = el),
        onInput: (text: string) => events.push(`input ${text}`),
        onSubmit: (text: string) => events.push(`submit ${text}`),
        onKeyDown: (event: Json) => {
          if (event.name === "down") event.preventDefault()
          events.push(`key ${event.name}`)
        },
      }),
  })
  const route = fake.surfaces.find((surface: Json) => surface.place.type === "route")
  expect(route.options.layers).toEqual([{ scope: "surface", any: true }])
  route.view({ mount: { surface: "files", key: "a", generation: 1 }, input: { width: 40, height: 10 } })
  const id = fake.effects.length
  // Unfocused, a key goes on; focused, `down` is taken and `up` goes on.
  expect(route.options.on({ type: "key", key: "down" })).toBe("pass")
  field.ref.focus()
  expect(route.options.on({ type: "key", key: "down" })).toBe("consume")
  expect(route.options.on({ type: "key", key: "up" })).toBe("pass")
  const node = fake.effects.slice(id).find((effect: Json) => effect.type === "focus").node
  // An edit in the host's field gives it the plugin's focus, as the field has the host's then.
  field.ref.blur()
  route.options.on({ type: "change", node, text: "ab", seq: 7 })
  expect([field.ref.value, field.ref.focused]).toEqual(["ab", true])
  // The field's next tree names the edit it heard, so the host tells its echo from a value of the plugin's.
  const viewed = route.view({ mount: { surface: "files", key: "a", generation: 1 }, input: { width: 40, height: 10 } })
  expect(JSON.stringify(viewed)).toContain('"seen":7')
  route.options.on({ type: "submit", node, text: "ab" })
  route.options.on({ type: "change", node: "elsewhere", text: "x" })
  expect(events).toEqual(["key down", "key up", "input ab", "submit ab"])
  // The contract's focus of a field (`focus-input`) maps, with no notice.
  expect(node).toBe("opentui-input-" + node.split("-").at(-1))
  expect(fake.warnings()).toEqual([])
  expect(fake.toasts()).toEqual([])
})

test("a listener takes keys only while a handler can take one", () => {
  const fake = host()
  const ctx = plugin("t.taking", fake)
  const global = { layer: 0 }
  const hears = () => {}
  ctx.renderer.keyInput.on("keypress", hears)
  expect(fake.takes(global)).toBe(false)
  const takes = (event: Json) => event.preventDefault()
  ctx.renderer.keyInput.on("keypress", takes)
  expect(fake.takes(global)).toBe(true)
  ctx.renderer.keyInput.off("keypress", takes)
  expect(fake.takes(global)).toBe(false)
  // Through a helper: it holds keys once it took one.
  const prevent = (event: Json) => event.preventDefault()
  const helped = (event: Json) => event.name === "x" && prevent(event)
  ctx.renderer.keyInput.on("keypress", helped)
  expect(fake.takes(global)).toBe(false)
  expect(fake.layers[0].handler({ type: "key", key: "y" })).toBe("pass")
  expect(fake.takes(global)).toBe(false)
  expect(fake.layers[0].handler({ type: "key", key: "x" })).toBe("consume")
  expect(fake.takes(global)).toBe(true)
  const fields: Json = {}
  ctx.ui.router.register({
    name: "fields",
    render: () => [
      h("input", { ref: (el: Json) => (fields.typed = el), onInput: () => {} }),
      h("input", { ref: (el: Json) => (fields.heard = el), onKeyDown: () => {} }),
      h("input", { ref: (el: Json) => (fields.keyed = el), onKeyDown: (event: Json) => event.preventDefault() }),
    ],
  })
  const index = fake.surfaces.findIndex((surface: Json) => surface.place.type === "route")
  fake.surfaces[index].view({ mount: { surface: "fields", key: "a", generation: 1 }, input: { width: 40, height: 10 } })
  const surface = { surface: index }
  expect(fake.takes(surface)).toBe(false)
  fields.typed.focus()
  expect(fake.takes(surface)).toBe(false)
  fields.heard.focus()
  expect(fake.takes(surface)).toBe(false)
  fields.keyed.focus()
  expect(fake.takes(surface)).toBe(true)
  fields.keyed.blur()
  expect(fake.takes(surface)).toBe(false)
})

test("a route's tree fills the page", () => {
  const fake = host()
  const ctx = plugin("t.fill", fake)
  ctx.ui.router.register({ name: "page", render: () => h("box", { flexGrow: 1, children: h("text", { children: "p" }) }) })
  ctx.ui.slot({ append: "home.footer", render: () => h("text", { children: "s" }) })
  const route = fake.surfaces.find((surface: Json) => surface.place.type === "route")
  const tree = route.view({ mount: { surface: "page", key: "a", generation: 1 }, input: { width: 40, height: 10 } })
  expect([tree.layout, tree.children[0].layout]).toEqual([{ grow: true }, { grow: true }])
  expect(view(fake, fake.surfaces.indexOf(fake.surfaces.find((surface: Json) => surface.place.type !== "route")), "a").draw().layout).toBeUndefined()
})

test("a field's focused prop focuses and blurs it", async () => {
  const fake = host()
  const ctx = plugin("t.focused", fake)
  const [on, setOn] = solid.createSignal(true)
  ctx.ui.router.register({ name: "f", render: () => h("input", {
        id: "q",
        get focused() {
          return on()
        },
      }) })
  const route = fake.surfaces.find((surface: Json) => surface.place.type === "route")
  route.view({ mount: { surface: "f", key: "a", generation: 1 }, input: { width: 40, height: 10 } })
  const verbs = () =>
    fake.effects.filter((effect: Json) => effect.type === "focus" || effect.type === "blur").map((effect: Json) => effect.type + (effect.node ? ` ${effect.node}` : ""))
  await turn()
  expect(verbs()).toEqual(["focus q"])
  setOn(false)
  await turn()
  setOn(false)
  await turn()
  expect(verbs()).toEqual(["focus q", "blur"])
  setOn(true)
  await turn()
  expect(verbs()).toEqual(["focus q", "blur", "focus q"])
  expect(fake.warnings()).toEqual([])
})

test("a field removed from its mount, or never added, has no focus and says so once", async () => {
  // Each its own plugin, as the log says it once a plugin: `stray` is built with its `focused` prop and never added;
  // `gone` is removed from the tree, and its ref focused twice.
  const detached = async (id: string, stray: boolean) => {
    const fake = host()
    const ctx = plugin(id, fake)
    const refs: Json = {}
    const [shown, setShown] = solid.createSignal(true)
    ctx.ui.router.register({
      name: "f",
      render: () => {
        if (stray) h("input", { id: "stray", focused: true })
        return h("box", {
          get children() {
            return [h("input", { id: "keep" }), shown() ? h("input", { id: "gone", ref: (el: Json) => (refs.gone = el) }) : null]
          },
        })
      },
    })
    const route = fake.surfaces.find((surface: Json) => surface.place.type === "route")
    route.view({ mount: { surface: "f", key: "a", generation: 1 }, input: { width: 40, height: 10 } })
    await turn()
    setShown(false)
    await turn()
    if (!stray) refs.gone.focus()
    if (!stray) refs.gone.focus()
    await turn()
    return { focus: fake.effects.filter((effect: Json) => effect.type === "focus"), warnings: fake.warnings() }
  }
  for (const [id, stray] of [["t.stray", true], ["t.gone", false]] as const)
    expect(await detached(id, stray)).toEqual({
      focus: [],
      warnings: [`${id}: focus() of an <input> in no mount is not supported by opencode-native yet`],
    })
})

test("dialog.set sizes and centers a select, an alert and a confirm", async () => {
  const fake = host()
  const ctx = plugin("t.presented", fake)
  const shown = () => fake.effects.filter((effect: Json) => effect.type === "dialog").at(-1).dialog.dialog
  const fields = (dialog: Json) => [dialog.type, dialog.size, dialog.centered]
  void ctx.ui.dialog.select({ title: "Pick", options: [{ title: "A", value: 1 }] })
  ctx.ui.dialog.set({ size: "xlarge", centered: true })
  await turn()
  expect(fields(shown())).toEqual(["select", "xlarge", true])
  void ctx.ui.dialog.alert({ title: "Told", message: "m" })
  ctx.ui.dialog.set({ size: "large", centered: true })
  await turn()
  expect(fields(shown())).toEqual(["alert", "large", true])
  void ctx.ui.dialog.confirm({ title: "Asked", message: "m" })
  await turn()
  expect(fields(shown())).toEqual(["confirm", undefined, undefined])
  ctx.ui.dialog.set({ size: "xlarge", centered: true })
  ctx.ui.dialog.set({ size: "large" })
  await turn()
  expect(fields(shown())).toEqual(["confirm", undefined, undefined])
  expect(fake.warnings()).toEqual(["t.presented: dialog.set after its dialog showed is not supported by opencode-native yet"])
})

test("a border draws as OpenTUI's box draws it", () => {
  const fake = host()
  const ctx = plugin("t.border", fake)
  const cases: Json[] = [
    {},
    { border: true },
    { border: ["left", "right"] },
    { border: { type: "single" } },
    { border: { type: "single" }, borderColor: "#ff0000" },
    { borderColor: "#ff0000" },
    { borderStyle: "rounded" },
    { border: false },
    { border: false, borderColor: "#ff0000" },
    { borderColor: "#ff0000", border: false },
    { border: true, title: "top", titleAlignment: "center", bottomTitle: "bottom", bottomTitleAlignment: "right" },
  ]
  const refs: Json = {}
  ctx.ui.slot({
    append: "home.footer",
    render: () => [...cases.map((props) => h("box", props)), h("box", { border: true, ref: (el: Json) => (refs.box = el) })],
  })
  const mount = view(fake, 0, "a")
  mount.draw()
  Object.assign(refs.box, { title: "T", titleAlignment: "center", bottomTitle: "B", bottomTitleAlignment: "right" })
  const tree = mount.draw()
  expect(tree.children.pop().border).toEqual({ title: "T", title_align: "center", bottom_title: "B", bottom_title_align: "right" })
  expect(tree.children.map((child: Json) => child.border)).toEqual([
    undefined,
    {},
    { sides: { top: false, right: true, bottom: false, left: true } },
    undefined,
    undefined,
    { color: "#ff0000" },
    { style: "rounded" },
    undefined,
    { color: "#ff0000" },
    undefined,
    { title: "top", title_align: "center", bottom_title: "bottom", bottom_title_align: "right" },
  ])
})

test("data.listen hears every event", () => {
  const fake = host()
  const ctx = plugin("t.listen", fake)
  const heard: string[] = []
  const off = ctx.data.listen((event: Json) => heard.push(`a ${event.details.type}`))
  ctx.data.listen((event: Json) => heard.push(`b ${event.details.data.sessionID}`))
  expect(fake.subscriptions.length).toBe(1)
  expect(fake.subscriptions[0].types).toEqual(expect.arrayContaining(["session.deleted", "session.step.ended", "session.status"]))
  fake.subscriptions[0].handler({ type: "session.step.ended", data: { sessionID: "ses_a" } })
  off()
  fake.subscriptions[0].handler({ type: "session.deleted", data: { sessionID: "ses_b" } })
  expect(heard).toEqual(["a session.step.ended", "b ses_a", "b ses_b"])
  expect(fake.toasts()).toEqual([])
})

test("a spinner draws and an inert async method resolves", async () => {
  const fake = host()
  const ctx = plugin("t.spinner", fake)
  ctx.ui.slot({ append: "home.footer", render: () => h("box", { children: h("spinner", { frames: ["a", "b"], interval: 120 }) }) })
  expect(view(fake, 0, "a").draw().children[0].children).toEqual([{ type: "spinner", label: "" }])
  expect(fake.warnings()).toEqual([
    "t.spinner: <spinner> frames is not supported by opencode-native yet",
    "t.spinner: <spinner> interval is not supported by opencode-native yet",
  ])
  const core = modules["@opentui/core"] as Json
  const client = core.getTreeSitterClient()
  let added = false
  await client.initialize().then(() => (added = !!client.addFiletypeParser({ filetype: "bash" })))
  expect(added).toBe(true)
})

test("a built renderable added by a ref draws, and the renderer has a root", () => {
  const fake = host()
  const ctx = plugin("t.built", fake)
  const core = modules["@opentui/core"] as Json
  const refs: Json = {}
  ctx.ui.slot({ append: "home.footer", render: () => h("box", { ref: (el: Json) => (refs.box = el) }) })
  const mount = view(fake, 0, "a")
  mount.draw()
  refs.box.add(new core.BoxRenderable({}, { backgroundColor: "#ff0000" }))
  expect(mount.draw().children[0].children).toEqual([{ type: "box", bg: "#ff0000", children: [] }])
  const renderer = ctx.renderer
  expect(["currentFocusedEditor" in renderer, "currentFocusedRenderable" in renderer]).toEqual([true, true])
  expect(typeof renderer.root.add).toBe("function")
  // The root holds none of the host's renderables, so a search of it finds nothing, which is no renderable (CT-40:
  // recap's transcript walk).
  expect(renderer.root.findDescendantById("msg_1")).toBeUndefined()
  expect([undefined, renderer.root, refs.box].map(core.isRenderable)).toEqual([false, false, true])
  expect(renderer.currentFocusedEditor).toBeUndefined()
  expect(fake.warnings()).toEqual([
    "t.built: renderer.root is not supported by opencode-native yet",
    "t.built: renderer.currentFocusedEditor is not supported by opencode-native yet",
  ])
})

test("a disabled, declining or ended command answers false", () => {
  const fake = host()
  const ctx = plugin("t.decline", fake)
  const [on, setOn] = solid.createSignal(false)
  let end = () => {}
  solid.createRoot((dispose: () => void) => {
    end = dispose
    ctx.keymap.layer(() => ({
      commands: [
        { id: "t.refresh", bind: "r", enabled: on, run: () => "ran" },
        { id: "t.submit", bind: "return", run: () => false },
      ],
    }))
  })
  const run = (name: string) => fake.commands.get(name)!()
  expect([run("t.refresh"), run("t.submit")]).toEqual([false, false])
  setOn(true)
  expect(run("t.refresh")).toBe("ran")
  end()
  expect(run("t.refresh")).toBe(false)
})

test("a layer of the plugin's own mode declines in another", () => {
  const fake = host()
  const ctx = plugin("t.mode", fake)
  ctx.keymap.layer(() => ({ mode: "modal", commands: [{ id: "t.refresh", bind: "r", run: () => "refreshed" }] }))
  const run = () => fake.commands.get("t.refresh")!()
  expect(run()).toBe(false)
  fake.push("input-mode", "modal")
  expect(run()).toBe("refreshed")
})

test("a layer of a mode the plugin pushed runs while the push holds", () => {
  const fake = host(() => "base")
  const ctx = plugin("t.pushed", fake)
  const ran: string[] = []
  ctx.keymap.layer(() => ({ mode: "t-page", commands: [{ id: "t.close", bind: "escape", run: () => ran.push("close") }] }))
  expect(fake.commands.get("t.close")!()).toBe(false)
  const pop = ctx.keymap.mode.push("t-page")
  fake.commands.get("t.close")!()
  pop()
  expect(fake.commands.get("t.close")!()).toBe(false)
  expect(ran).toEqual(["close"])
})

test("a layer with a target declines while its node lacks the focus", () => {
  const fake = host()
  const ctx = plugin("t.target", fake)
  const refs: Json = {}
  ctx.ui.slot({
    append: "sidebar.content",
    render: () => {
      ctx.keymap.layer(() => ({ target: () => refs.window, commands: [{ id: "t.close", bind: "escape", run: () => "closed" }] }))
      return h("box", {
        ref: (el: Json) => (refs.window = el),
        get children() {
          return [h("box", { ref: (el: Json) => (refs.row = el) }), h("input", { ref: (el: Json) => (refs.field = el) })]
        },
      })
    },
  })
  view(fake, 0, "a").draw()
  const close = () => fake.commands.get("t.close")!()
  expect(close()).toBe(false)
  refs.row.focus()
  expect(close()).toBe("closed")
  refs.row.blur()
  expect(close()).toBe(false)
})

test("a mount a reload begins again adopts the one it ended", async () => {
  const fake = host()
  const ctx = plugin("t.remount", fake)
  let runs = 0
  ctx.ui.slot({ append: "sidebar.content", render: () => (runs++, h("text", { children: `run ${runs}` })) })
  const cx = (generation: number) => ({ mount: { surface: "slot#0", key: "a", generation }, input: { width: 40, height: 10, slot: {} } })
  const surface = fake.surfaces[0]
  expect(text(surface.view(cx(1)))).toBe("run 1")
  surface.options.unmount(cx(1).mount, true)
  expect(text(surface.view(cx(2)))).toBe("run 1")
  surface.options.unmount(cx(2).mount, true)
  await new Promise((resolve) => setTimeout(resolve, 300))
  expect(text(surface.view(cx(3)))).toBe("run 2")
  surface.options.unmount(cx(3).mount)
  expect(text(surface.view(cx(4)))).toBe("run 3")
})

test("a built renderable returned draws, and a node's layout is the host's", () => {
  const fake = host()
  const ctx = plugin("t.layout", fake)
  const core = modules["@opentui/core"] as Json
  ctx.ui.slot({
    append: "home.footer",
    render: () => {
      const box = new core.BoxRenderable({}, { flexDirection: "row", paddingLeft: 1 })
      box.add(new core.TextRenderable({}, { content: "quote", fg: "#00ff00" }))
      return box
    },
  })
  expect(view(fake, 0, "a").draw().children).toEqual([
    {
      type: "box",
      row: true,
      padding_sides: { top: 0, right: 0, bottom: 0, left: 1 },
      children: [{ type: "text", spans: [{ text: "quote" }], fg: "#00ff00" }],
    },
  ])
  expect(fake.warnings()).toEqual([])
  const refs: Json = {}
  const sizes: number[] = []
  ctx.ui.slot({
    append: "sidebar.content",
    render: () =>
      h("box", { ref: (el: Json) => (refs.box = el), onSizeChange: () => sizes.push(refs.box.width), children: h("text", { children: "x" }) }),
  })
  const mount = view(fake, 1, "b")
  const tree = mount.draw()
  const id = tree.children[0].id
  expect(id).toMatch(/^opentui-box-/)
  const key = `rect:slot#1:${id}`
  expect(fake.watches.has(key)).toBe(true)
  expect(refs.box.getLayout()).toMatchObject({ x: 0, y: 0, width: 0, height: 0 })
  // A node the host has not laid out yet reads 0×0, which is not a size; an unchanged size is not a change.
  fake.push(key, { x: 0, y: 1, width: 0, height: 0 })
  expect([sizes, refs.box.width]).toEqual([[], 0])
  fake.push(key, { x: 2, y: 3, width: 30, height: 4 })
  fake.push(key, { x: 2, y: 3, width: 30, height: 4 })
  expect(sizes).toEqual([30])
  expect(refs.box.getLayout()).toMatchObject({ x: 2, y: 3, width: 30, height: 4, left: 2, top: 3, right: 32, bottom: 7 })
  expect(refs.box.height).toBe(4)
})

test("data collections load through the client", async () => {
  const fake = host()
  const fetched: string[] = []
  let agents = [{ name: "build" }]
  fake.fetch = async (request: Json) => {
    fetched.push(`${request.method} ${request.path}`)
    if (request.path === "/api/agent") return { Ok: { location: { directory: "/w" }, data: agents } }
    if (request.path === "/api/session/s1/permission") return { Ok: { data: [{ id: "per_1" }] } }
    return { Ok: null }
  }
  const handlers = new Map<string, (event: Json) => unknown>()
  const base = {
    id: "t.data",
    options: {},
    app: { version: "", channel: "" },
    themeMode: "dark",
    data: { on: (type: string, handler: (event: Json) => unknown) => (handlers.set(type, handler), () => {}) },
  }
  const ctx = context(base, fake) as Json
  expect(ctx.data.location.agent.list({ directory: "/w" })).toBeUndefined()
  await ctx.data.location.agent.sync({ directory: "/w" })
  expect(ctx.data.location.agent.list({ directory: "/w" })).toEqual([{ name: "build" }])
  await ctx.data.session.permission.sync("s1")
  expect(ctx.data.session.permission.list("s1")).toEqual([{ id: "per_1" }])
  agents = [{ name: "build" }, { name: "plan" }]
  handlers.get("agent.updated")!({ type: "agent.updated" })
  await turn()
  await turn()
  expect(ctx.data.location.agent.list({ directory: "/w" })).toEqual([{ name: "build" }, { name: "plan" }])
  expect(fetched.filter((line) => line === "GET /api/agent").length).toBe(3)
  expect(fake.toasts()).toEqual([])
})

test("a store's update writes nothing it did not read, and shows nothing the host refused", async () => {
  const fake = host()
  fake.stored.set("notes", JSON.stringify({ items: ["kept"] }))
  const ctx = plugin("t.store", fake)
  const [store, update] = ctx.storage.store("notes", { initial: { items: [] } })
  await turn()
  expect(store.items).toEqual(["kept"])
  const answer = fake.effect
  fake.effect = async (request: Json, mount?: Json) => (request.type === "storage-get" ? undefined : answer(request, mount))
  await expect(update((draft: Json) => draft.items.push("tail"))).rejects.toThrow("did not come")
  expect(JSON.parse(fake.stored.get("notes")!)).toEqual({ items: ["kept"] })
  fake.effect = async (request: Json, mount?: Json) =>
    request.type === "storage-merge" ? { error: "a stored value of 300000 bytes, past 262144" } : answer(request, mount)
  await expect(update((draft: Json) => draft.items.push("big"))).rejects.toThrow("past 262144")
  expect([store.items, JSON.parse(fake.stored.get("notes")!)]).toEqual([["kept"], { items: ["kept"] }])
})

// A context whose `data.on` keeps each event's handler, for the rows that send events.
function evented(id: string, fake: Json) {
  const handlers = new Map<string, (event: Json) => unknown>()
  const base = {
    id,
    options: {},
    app: { version: "", channel: "" },
    themeMode: "dark",
    data: { on: (type: string, handler: (event: Json) => unknown) => (handlers.set(type, handler), () => {}) },
  }
  return { ctx: context(base, fake) as Json, handlers }
}

test("a session synced or seeded is what get answers", async () => {
  const nine = { info: { id: "ses_9", title: "Nine" }, status: "running" }
  const fake = host((key) => (key === "session:ses_9" ? nine : key === "sessions" ? undefined : []))
  const ctx = plugin("t.sync", fake)
  fake.push("session:ses_r", { info: { id: "ses_r", title: "Route" }, status: "idle" })
  expect(ctx.data.session.get("ses_r")).toEqual({ id: "ses_r", title: "Route" })
  await ctx.data.session.sync("ses_9")
  expect([ctx.data.session.get("ses_9"), ctx.data.session.status("ses_9")]).toEqual([{ id: "ses_9", title: "Nine" }, "running"])
})

test("a key waits once, and one collection's loads hold no other's", async () => {
  const fake = host()
  const fetched: string[] = []
  const held: Array<() => void> = []
  fake.fetch = async (request: Json) => {
    fetched.push(`${request.method} ${request.path}`)
    if (request.path.endsWith("/permission")) await new Promise<void>((resolve) => held.push(resolve))
    return { Ok: { location: { directory: "/w" }, data: [] } }
  }
  const { ctx, handlers } = evented("t.turns", fake)
  for (const session of ["a", "b", "c", "d", "e"]) ctx.data.session.permission.list(session)
  await turn()
  for (let event = 0; event < 4; event++) handlers.get("permission.asked")!({ type: "permission.asked", data: { sessionID: "e" } })
  ctx.data.location.agent.list({ directory: "/w" })
  await turn()
  expect(fetched).toContain("GET /api/agent")
  while (held.length) {
    held.splice(0).forEach((resolve) => resolve())
    await turn()
    await turn()
  }
  expect(fetched.filter((line) => line === "GET /api/session/e/permission")).toEqual(["GET /api/session/e/permission"])
})

test("an older load never undoes a newer one", async () => {
  const fake = host()
  let server: Json[] = [{ id: "frm_1", sessionID: "s" }]
  const pending: Array<() => void> = []
  fake.fetch = (request: Json) => {
    const answer = { Ok: { data: request.path === "/api/form" ? server : [] } }
    return new Promise((resolve) => pending.push(() => resolve(answer)))
  }
  const { ctx, handlers } = evented("t.forms", fake)
  ctx.data.session.form.list("s")
  await turn()
  server = []
  handlers.get("form.cancelled")!({ type: "form.cancelled", data: { sessionID: "s", id: "frm_1" } })
  await turn()
  // The latest load answers first.
  while (pending.length) {
    pending.pop()!()
    for (let round = 0; round < 3; round++) await turn()
  }
  expect(ctx.data.session.form.list("s")).toEqual([])
})

test("a refreshed form list leaves no older list reachable", async () => {
  const fake = host()
  let server: Json[] = [
    { id: "frm_a", sessionID: "A" },
    { id: "frm_b", sessionID: "B", body: "x".repeat(1000) },
  ]
  fake.fetch = async () => ({ Ok: { data: server } })
  const { ctx, handlers } = evented("t.pinned", fake)
  ctx.data.session.form.list("A")
  for (let round = 0; round < 3; round++) await turn()
  ctx.data.session.form.list("A")
  const weak = new WeakRef(ctx.data.session.form.list("B")[0])
  server = [{ id: "frm_a", sessionID: "A" }]
  handlers.get("form.replied")!({ type: "form.replied", data: { sessionID: "B", id: "frm_b" } })
  for (let round = 0; round < 3; round++) await turn()
  expect(ctx.data.session.form.list("B")).toEqual([])
  for (let round = 0; round < 3; round++) {
    Bun.gc(true)
    await turn()
  }
  expect(weak.deref()).toBeUndefined()
})

// A session panel of the plugin `fake`'s context `ctx`, drawn as mount `generation`, and the input its render last got.
function panelOf(ctx: Json, fake: Json, children: () => Json) {
  let input: Json
  ctx.ui.slot({
    append: "session.panel",
    render: (props: Json) => {
      input = props
      return h("box", { children: children() })
    },
  })
  const index = fake.surfaces.findIndex((surface: Json) => surface.place.type === "panel")
  const name = fake.surfaces[index].name
  const mount = (generation: number) => ({ surface: name, key: "k", generation })
  const draw = (generation: number, fullscreen = false) =>
    fake.surfaces[index].view({ mount: mount(generation), input: { width: 40, height: 10, slot: { session_id: "s" }, panel: { fullscreen } } })
  const unmount = (generation: number, handover?: boolean) => fake.surfaces[index].options.unmount(mount(generation), handover)
  return { input: () => input, name, mount, draw, unmount }
}

test("a panel's input past its mount moves nothing", async () => {
  const fake = host()
  const panel = panelOf(plugin("t.stale", fake), fake, () => [h("text", { children: "Notes" })])
  panel.draw(1)
  const kept = panel.input()
  panel.unmount(1)
  kept.close()
  kept.toggleFullscreen()
  await turn()
  expect(fake.effects.filter((effect: Json) => effect.type.endsWith("-panel"))).toEqual([])
})

test("a panel adopted after a reload focuses its field", async () => {
  const fake = host()
  const panel = panelOf(plugin("t.adopted", fake), fake, () => [h("input", { id: "field" })])
  panel.draw(1)
  panel.unmount(1, true)
  panel.draw(2)
  panel.input().focus()
  await turn()
  expect(fake.effects.filter((effect: Json) => effect.type === "focus")).toEqual([{ type: "focus", node: "field", mount: panel.mount(2) }])
})

test("a panel focuses the field that shows", async () => {
  const fake = host()
  const panel = panelOf(plugin("t.hidden", fake), fake, () => [
    h("box", { visible: false, children: [h("input", { id: "hidden" })] }),
    h("input", { id: "shown" }),
  ])
  panel.draw(1)
  panel.input().focus()
  await turn()
  expect(fake.effects.filter((effect: Json) => effect.type === "focus").map((effect: Json) => effect.node)).toEqual(["shown"])
})

test("a panel's toggleFullscreen toggles", async () => {
  const fake = host()
  const panel = panelOf(plugin("t.toggle", fake), fake, () => [h("text", { children: "Notes" })])
  panel.draw(1)
  panel.input().toggleFullscreen()
  panel.input().toggleFullscreen()
  await turn()
  expect(fake.effects.filter((effect: Json) => effect.type === "open-panel").map((effect: Json) => !!effect.fullscreen)).toEqual([true, false])
})

test("listing hundreds of sessions stays within the host's bounds", async () => {
  const ids = Array.from({ length: 900 }, (_, index) => `ses_${index}`)
  const fake = host((key) => (key === "sessions" ? [{ info: { id: "ses_1" }, status: "running" }] : []))
  const fetched: string[] = []
  let flying = 0
  let most = 0
  fake.fetch = async (request: Json) => {
    fetched.push(`${request.method} ${request.path}`)
    most = Math.max(most, ++flying)
    await turn()
    flying--
    if (request.path === "/api/form") return { Ok: { data: [{ id: "frm_1", sessionID: "ses_2" }] } }
    return { Ok: { data: [] } }
  }
  const handlers = new Map<string, (event: Json) => unknown>()
  const base = {
    id: "t.many",
    options: {},
    app: { version: "", channel: "" },
    themeMode: "dark",
    data: { on: (type: string, handler: (event: Json) => unknown) => (handlers.set(type, handler), () => {}) },
  }
  const ctx = context(base, fake) as Json
  ids.forEach((id) => ctx.data.session.status(id))
  await turn()
  expect(ids.filter((id) => ctx.data.session.status(id) === "running")).toEqual(["ses_1"])
  expect([...fake.watches]).toEqual(["sessions"])
  // Listed again as a plugin's render lists them: past the 256 that may wait, a list loads when it is next listed.
  for (let rounds = 0; rounds < 2000 && (fetched.length < ids.length || flying > 0); rounds++) {
    ids.forEach((id) => ctx.data.session.permission.list(id))
    await turn()
  }
  expect([fetched.length, new Set(fetched).size, most]).toEqual([ids.length, ids.length, 4])
  fetched.length = 0
  handlers.get("permission.asked")!({ type: "permission.asked", data: { sessionID: "ses_7", id: "per_1" } })
  for (let rounds = 0; rounds < 4; rounds++) await turn()
  expect(fetched).toEqual(["GET /api/session/ses_7/permission"])
  fetched.length = 0
  ids.forEach((id) => ctx.data.session.form.list(id))
  for (let rounds = 0; rounds < 4; rounds++) await turn()
  expect(fetched).toEqual(["GET /api/form"])
  expect([ctx.data.session.form.list("ses_2"), ctx.data.session.form.list("ses_3")]).toEqual([
    [{ id: "frm_1", sessionID: "ses_2" }],
    [],
  ])
})

test("a top node answers the room before the host laid it out", () => {
  const fake = host()
  const ctx = plugin("t.room", fake)
  const refs: Json = {}
  ctx.ui.slot({
    append: "sidebar.content",
    render: () => [
      h("box", { ref: (el: Json) => (refs.full = el), width: "100%", children: h("box", { ref: (el: Json) => (refs.nested = el), width: "100%" }) }),
      h("box", { ref: (el: Json) => (refs.fixed = el), width: 12 }),
      h("box", { ref: (el: Json) => (refs.auto = el) }),
    ],
  })
  const cx = { mount: { surface: "slot#0", key: "a", generation: 1 }, input: { width: 37, height: 1, slot: {} } }
  fake.surfaces[0].view(cx)
  expect([refs.full.getLayout().width, refs.nested.getLayout().width, refs.fixed.width, refs.auto.getLayout().width]).toEqual([37, 0, 12, 0])
  const key = `rect:slot#0:${fake.surfaces[0].view(cx).children[1].id}`
  refs.fixed.width = 13
  fake.push(key, { x: 0, y: 1, width: 12, height: 1 })
  expect([refs.fixed.width, refs.fixed.height]).toEqual([13, 1])
})

test("theme.surface answers the raised surface's colors", () => {
  const fake = host()
  fake.palette = () => ({
    mode: "dark",
    colors: {
      "text.base": "#ffffffff",
      "background.base": "#000000ff",
      "@dialog.background.base": "#202020ff",
      "@dialog.footer.background.base": "#303030ff",
    },
  })
  const ctx = plugin("t.surface", fake)
  const dialog = ctx.theme.surface("dialog")
  expect([dialog.background.base.toInts(), dialog.background.base.token]).toEqual([[32, 32, 32, 255], undefined])
  expect(dialog.text.base.token).toBe("text.base")
  expect(dialog.surface("dialog.footer").background.base.toInts()).toEqual([48, 48, 48, 255])
  expect(ctx.theme.surface("menu").background.base.token).toBe("background.base")
  expect(ctx.theme.background.base.token).toBe("background.base")
  expect(fake.toasts()).toEqual([])
})

test("theme carries the hue scales, categorical list and states", () => {
  const fake = host()
  const steps = (name: string, shade: (step: number) => number) =>
    Object.fromEntries([100, 200, 300, 400, 500, 600, 700, 800, 900].map((step) => [`${name}.${step}`, `#${shade(step).toString(16).padStart(2, "0").repeat(3)}ff`]))
  fake.palette = () => ({
    mode: "dark",
    colors: {
      ...steps("hue.accent", (step) => step / 5),
      ...steps("hue.neutral", (step) => step / 4),
      ...steps("categorical.1", (step) => step / 4),
      ...steps("categorical.0", (step) => step / 5),
      "text.base": "#3c3c3cff",
      "text.action.primary.base": "#010101ff",
      "text.action.primary.hovered": "#020202ff",
      "text.action.primary.disabled": "#030303ff",
      "background.formfield.base": "#040404ff",
      "background.formfield.hovered": "#050505ff",
    },
  })
  const ctx = plugin("t.hue", fake)
  const theme = ctx.theme
  expect(theme.hue.accent[500].token).toBe("accent.500")
  expect(theme.hue.accent[500].toInts()).toEqual([100, 100, 100, 255])
  expect(theme.categorical.map((scale: Json) => scale[300].token)).toEqual(["categorical.0.300", "categorical.1.300"])
  const primary = theme.text.action.primary
  expect(primary.state({}).token).toBe("text.action.primary.base")
  expect(primary.state({ hovered: true, disabled: true }).token).toBe("text.action.primary.disabled")
  expect(theme.background.formfield.state({ hovered: true }).token).toBe("background.formfield.hovered")
  expect(theme.source(theme.hue.neutral[200])).toEqual({ hue: "neutral", step: 200 })
  // By value: `text.base` is accent's step 300 here.
  expect(theme.source(theme.text.base)).toEqual({ hue: "accent", step: 300 })
  expect(theme.increase(theme.hue.accent[800], 3).token).toBe("accent.900")
  expect(theme.decrease(theme.text.base).token).toBe("accent.200")
  expect(theme.increase(theme.text.action.primary.base)).toBe(theme.text.action.primary.base)
  expect(fake.toasts()).toEqual([])
})

test("anonymous commands of two layers stay apart and keep their names", () => {
  const fake = host()
  const ctx = plugin("t.layers", fake)
  const ran: string[] = []
  const mount = (round: number) => {
    let dispose = () => {}
    solid.createRoot((end: () => void) => {
      dispose = end
      ctx.keymap.layer(() => ({
        mode: "global",
        commands: [{ bind: "ctrl+o", title: "open", slash: { name: "open-file" }, run: () => ran.push(`file ${round}`) }],
      }))
      ctx.keymap.layer(() => ({
        commands: [{ bind: "ctrl+o", title: "open", slash: { name: "open-dir" }, run: () => ran.push(`dir ${round}`) }],
      }))
    })
    return dispose
  }
  const inline = () => [...fake.commands.keys()].filter((name) => name.startsWith("t.layers.inline-"))
  const end = mount(1)
  const first = inline()
  expect(first.length).toBe(2)
  expect(first.map((name) => fake.meta.get(name).slash).sort()).toEqual(["open-dir", "open-file"])
  for (const name of first) fake.commands.get(name)!()
  expect(ran.sort()).toEqual(["dir 1", "file 1"])
  end()
  mount(2)
  expect(inline()).toEqual(first)
})

test("each dialog settles once, and clear closes it", async () => {
  const fake = host()
  const ctx = plugin("t.dialogs", fake)
  const picked = ctx.ui.dialog.select({ title: "Pick", options: [{ title: "A", value: 1 }] })
  await turn()
  const asked = fake.effects.at(-1)
  expect(asked.dialog.type).toBe("dismissable")
  fake.commands.get(asked.dialog.dismissed.name)!(asked.dialog.dismissed.input)
  expect(await picked).toBeUndefined()
  const prompted = ctx.ui.dialog.prompt({ title: "Name", value: "x" })
  await turn()
  ctx.ui.dialog.clear()
  expect(await prompted).toBeUndefined()
  await turn()
  expect(fake.effects.at(-1).dialog).toEqual({ type: "close", key: "" })
  // A prompt's `value` is the host's field's starting text.
  const prompt = fake.effects.find((effect: Json) => effect.dialog?.dialog?.type === "prompt").dialog.dialog
  expect([prompt.title, prompt.value]).toEqual(["Name", "x"])
  expect(fake.warnings()).toEqual([])
  ctx.ui.dialog.show(() => h("text", { children: "big" }))
  ctx.ui.dialog.set({ size: "large", centered: true })
  await turn()
  ctx.ui.dialog.clear()
  ctx.ui.dialog.show(() => h("text", { children: "small" }))
  await turn()
  const dialogs = surfaces(fake)
  // The first opened, then the `set` right after it sized it under its key; the next is the host's own size.
  expect(dialogs.map((dialog) => [dialog.key, dialog.size, dialog.centered])).toEqual([
    ["compat.dialog.1", undefined, undefined],
    ["compat.dialog.1", "large", true],
    ["compat.dialog.2", undefined, undefined],
  ])
})

test("a select's actions are its footer's", async () => {
  const fake = host()
  const ctx = plugin("t.actions", fake)
  const heard: unknown[] = []
  const actions = [
    { bind: "ctrl+o", title: "Open", onTrigger: (value: unknown) => heard.push(["open", value]) },
    { bind: "ctrl+a", title: "Close", side: "right", selection: "none", onTrigger: () => heard.push("close") },
  ]
  const options = [
    { title: "A", value: { id: "a" } },
    { title: "B", value: { id: "b" } },
  ]
  const picked = ctx.ui.dialog.select({ title: "Pick", options, actions })
  await turn()
  const select = fake.effects.at(-1).dialog.dialog
  expect(select.actions.map(({ action, ...rest }: Json) => rest)).toEqual([
    { title: "Open", key: "ctrl+o" },
    { title: "Close", key: "ctrl+a", primary: false, rowless: true },
  ])
  const run = (action: Json, input = action.input) => fake.commands.get(action.name)!(input)
  run(select.actions[0].action, select.options[1].value)
  run(select.actions[1].action)
  expect(heard).toEqual([["open", { id: "b" }], "close"])
  run(select.action, select.options[0].value)
  expect(await picked).toEqual({ id: "a" })
  // Answered: its actions do nothing.
  fake.commands.get(select.actions[1].action.name)!()
  expect(heard.length).toBe(2)
  expect(fake.warnings()).toEqual([])
  const many = Array.from({ length: 5 }, (_, at) => ({ bind: `f${at + 1}`, title: `F${at + 1}`, onTrigger() {} }))
  void ctx.ui.dialog.select({ title: "Many", options, actions: many })
  await turn()
  expect(fake.effects.at(-1).dialog.dialog.actions.length).toBe(4)
  expect(fake.warnings()).toEqual(["t.actions: ui.dialog.select over 4 actions is not supported by opencode-native yet"])
})

// Selects of plugin `t.stale` whose actions record what they hear, each searching by reversing its rows.
function stale() {
  const fake = host()
  const ctx = plugin("t.stale", fake)
  const heard: unknown[] = []
  const open = (name: string) => {
    const options = [
      { title: "A", value: `${name}a` },
      { title: "B", value: `${name}b` },
    ]
    const actions = [
      { bind: "ctrl+o", title: "Open", onTrigger: (value: unknown) => heard.push(value) },
      { bind: "ctrl+a", title: "All", selection: "none", onTrigger: () => heard.push(`${name} all`) },
    ]
    const search = (query: string, rows: Json[]) => (query ? [...rows].reverse() : rows)
    return ctx.ui.dialog.select({ title: name, options, actions, search })
  }
  const shown = () => fake.effects.at(-1).dialog.dialog
  const action = (select: Json, slot: number, input = select.actions[slot].action.input) =>
    fake.commands.get(select.actions[slot].action.name)!(input)
  return { fake, heard, open, shown, action }
}

test("a replaced select's actions reach nothing", async () => {
  const t = stale()
  const first = t.open("x")
  await turn()
  const a = t.shown()
  const second = t.open("y")
  await turn()
  expect(await first).toBeUndefined()
  const b = t.shown()
  t.action(a, 0, a.options[0].value)
  t.action(a, 1)
  expect(t.heard).toEqual([])
  t.action(b, 0, b.options[0].value)
  t.action(b, 1)
  expect(t.heard).toEqual(["ya", "y all"])
  t.fake.commands.get(b.action.name)!(b.options[1].value)
  expect(await second).toBe("yb")
})

test("a select's action reaches its row through a search", async () => {
  const t = stale()
  const picked = t.open("x")
  await turn()
  const a = t.shown()
  t.fake.commands.get(a.query.name)!("z")
  t.action(a, 0, a.options[0].value)
  expect(t.heard).toEqual(["xa"])
  t.fake.commands.get(a.action.name)!(a.options[0].value)
  expect(await picked).toBe("xa")
})

test("click handlers go with their mount", async () => {
  const fake = host()
  const ctx = plugin("t.clicks", fake)
  const kept: WeakRef<object>[] = []
  ctx.ui.slot({
    append: "sidebar.content",
    render: () => {
      const captured = { at: kept.length }
      kept.push(new WeakRef(captured))
      return h("text", { onMouseUp: () => captured.at, children: "row" })
    },
  })
  for (let index = 0; index < 100; index++) {
    const mount = view(fake, 0, `m${index}`)
    mount.draw()
    mount.unmount()
  }
  await turn()
  Bun.gc(true)
  Bun.gc(true)
  // The collector scans the stack conservatively: a few may stay; a kept table keeps all hundred.
  expect(kept.filter((ref) => ref.deref()).length).toBeLessThan(20)
})

test("a dialog's scrollbox is a scroll its focused prop focuses", async () => {
  const fake = host()
  const ctx = plugin("t.scroll", fake)
  ctx.ui.dialog.show(() => h("scrollbox", { id: "body", focused: true, children: h("text", { children: "long" }) }))
  await turn()
  const dialog = dialogView(fake, surfaceKeys(fake)[0]!)
  const tree = dialog.draw()
  const scroll = (node: Json): Json => (node?.type === "scroll" ? node : (node?.children ?? []).map(scroll).find(Boolean))
  expect(text(scroll(tree))).toBe("long")
  await turn()
  expect(fake.effects.filter((effect: Json) => effect.type === "focus")).toEqual([
    { type: "focus", node: "body", mount: dialog.mount },
  ])
  expect(fake.warnings()).toEqual([])
})

test("a replacing dialog closes, and a crashing one closes at once", async () => {
  const fake = host()
  const ctx = plugin("t.show", fake)
  const closed: string[] = []
  ctx.ui.dialog.show(() => h("text", { children: "A" }), () => closed.push("A"))
  await turn()
  ctx.ui.dialog.show(() => h("text", { children: "B" }), () => closed.push("B"))
  await turn()
  const keys = surfaceKeys(fake)
  expect(new Set(keys).size).toBe(2)
  // The mount of the first renders nothing of the second (each show is its own key).
  expect([text(dialogView(fake, keys[0]!).draw()), text(dialogView(fake, keys[1]!).draw())]).toEqual(["", "B"])
  fake.push(`dialog-open:${keys.at(-1)}`, true)
  fake.push(`dialog-open:${keys.at(-1)}`, false)
  expect(closed).toEqual(["A", "B"])
  ctx.ui.dialog.show(() => {
    throw new Error("")
  })
  await turn()
  dialogView(fake, surfaceKeys(fake).at(-1)!).draw()
  const last = fake.effects.at(-1)
  expect(last.dialog).toEqual({ type: "close", key: surfaceKeys(fake).at(-1) })
})

test("a change to another mount while one is drawn is not lost", async () => {
  const fake = host()
  let invalidations = 0
  fake.invalidate = () => void invalidations++
  const ctx = plugin("t.views", fake)
  const [value, setValue] = solid.createSignal("old")
  ctx.ui.slot({ append: "home.footer", render: () => h("text", { children: () => `a ${value()}` }) })
  ctx.ui.slot({
    append: "sidebar.content",
    render: () => {
      setValue("new")
      return h("text", { children: "b" })
    },
  })
  const a = view(fake, 0, "a")
  expect(text(a.draw())).toBe("a old")
  view(fake, 1, "b").draw()
  await turn()
  expect(invalidations).toBeGreaterThan(0)
  expect(text(a.draw())).toBe("a new")
})

test("an unmapped hook is reported for the plugin that used it", () => {
  const fake = host()
  const solidRuntime = modules["@opentui/solid"] as Json
  const loud = plugin("t.loud", fake)
  const quiet = plugin("t.quiet", fake)
  loud.ui.slot({ append: "home.footer", render: () => (solidRuntime.usePaste(() => {}), h("text", { children: "x" })) })
  quiet.ui.slot({ append: "sidebar.content", render: () => h("text", { children: "y" }) })
  view(fake, 0, "a").draw()
  view(fake, 1, "b").draw()
  expect(fake.warnings()).toEqual(["t.loud: usePaste is not supported by opencode-native yet"])
})

test("a claim keeps its kind and path", () => {
  const fake = host()
  plugin("t.slots", fake).ui.slot({ replace: "home.footer.custom", render: () => h("text", { children: "z" }) })
  expect(fake.surfaces[0].place).toEqual({ type: "slot", kind: "replace", path: "home.footer.custom" })
})

test("numbers are rounded and clamped", () => {
  const fake = host()
  plugin("t.numbers", fake).ui.slot({
    append: "home.footer",
    render: () =>
      h("box", {
        gap: 1.5,
        width: 999999,
        height: "auto%",
        position: "absolute",
        top: 70000,
        zIndex: 1.5,
        children: h("text", { children: "n" }),
      }),
  })
  const box = view(fake, 0, "a").draw().children[0]
  expect(box.gap).toBe(2)
  expect(box.layout.width).toEqual({ cells: 65535 })
  expect(box.layout.height).toBeUndefined()
  expect(box.layout.absolute.top).toBe(32767)
  expect(box.layout.absolute.z).toBe(2)
})

test("attention, listed commands and the mouse button", async () => {
  const fake = host((key) =>
    key === "keymap-commands" ? [{ name: "session.new" }, { name: "t.misc.compat.press" }] : [],
  )
  const ctx = plugin("t.misc", fake)
  await ctx.attention.notify({ message: "done" })
  const attention = fake.effects.find((effect) => effect.type === "attention")
  expect([attention.notify, attention.sound?.when]).toEqual(["blurred", "always"])
  ctx.keymap.commands()
  await turn()
  const listed = ctx.keymap.commands()
  expect(listed.map((command: Json) => command.name)).toEqual(["session.new"])
  listed[0].run()
  await turn()
  expect(fake.effects.at(-1)).toEqual({ type: "dispatch", name: "session.new" })
  expect((modules["@opentui/core"] as Json).MouseButton.LEFT).toBe(0)
})

test("the layer exports every name of OpenTUI's packages", async () => {
  for (const name of ["@opentui/core", "@opentui/solid"]) {
    const real = Object.keys(await import(Bun.resolveSync(name, import.meta.dir)))
    const served = new Set(Object.keys(modules[name]!))
    expect(real.filter((key) => !served.has(key))).toEqual([])
  }
  const core = modules["@opentui/core"] as Json
  const real = await import(Bun.resolveSync("@opentui/core", import.meta.dir))
  expect(core.CliRenderEvents).toEqual({ ...real.CliRenderEvents })
  class Fence extends core.BoxRenderable {
    label = "fence"
    describe() {
      return this.label
    }
  }
  const fence = new Fence({}, { id: "f" }) as Json
  fence.add(new core.TextRenderable({}, {}))
  expect([fence.describe(), fence instanceof Fence, fence instanceof core.BoxRenderable]).toEqual(["fence", true, true])
  expect(`${core.SyntaxStyle.fromStyles({ keyword: {} })}`).toBe("")
  expect(core.addDefaultParsers([])).toBeDefined()
  expect([...core.extensionToFiletype]).toEqual([...real.extensionToFiletype])
  expect([...core.basenameToFiletype]).toEqual([...real.basenameToFiletype])
  for (const info of ["ts", "TypeScript", "sh", "zsh", "Dockerfile", "makefile", "rust,no_run", "  py  extra", "x.tsx", ".md", "unknownlang", ""])
    expect(core.infoStringToFiletype(info)).toBe(real.infoStringToFiletype(info))
})

test("the renderer's missing methods do nothing", async () => {
  const fake = host()
  const ctx = plugin("t.renderer", fake)
  ctx.renderer.prependInputHandler(() => false)
  const bound = ctx.renderer.setBackgroundColor.bind(ctx.renderer)
  bound("#000000")
  expect(ctx.renderer.on("resize", () => {}).off("resize", () => {})).toBe(ctx.renderer)
  expect(ctx.renderer.notAMember).toBeUndefined()
  await ctx.renderer.idle()
  expect(fake.warnings()).toEqual([
    "t.renderer: renderer.prependInputHandler is not supported by opencode-native yet",
    "t.renderer: renderer.setBackgroundColor is not supported by opencode-native yet",
    "t.renderer: renderer.on is not supported by opencode-native yet",
    "t.renderer: renderer.off is not supported by opencode-native yet",
    "t.renderer: renderer.notAMember is not supported by opencode-native yet",
    "t.renderer: renderer.idle is not supported by opencode-native yet",
  ])
})

test("a plugin's files are inside its directory in every spelling Windows gives them", async () => {
  const { inside, stripVerbatim } = await import("./compat/paths")
  const win = (await import("node:path")).win32
  const posix = (await import("node:path")).posix
  const within: [string, string][] = [
    ["C:\\Users\\runneradmin\\p", "C:\\Users\\runneradmin\\p\\tui.ts"],
    ["C:\\Users\\runneradmin\\p", "c:\\users\\RUNNERADMIN\\p\\dist\\tui.js"],
    ["\\\\?\\C:\\a\\p", "C:\\a\\p\\x.ts"],
    ["C:\\a\\p", "\\\\?\\c:\\a\\p\\x.ts"],
    ["\\\\?\\UNC\\srv\\share\\p", "\\\\srv\\share\\p\\x.ts"],
    ["C:\\a\\p", "C:\\a\\p"],
    ["C:\\a\\p\\", "C:\\a\\p\\x"],
  ]
  for (const [root, child] of within) expect([root, child, inside(root, child, win)]).toEqual([root, child, true])
  const outside: [string, string][] = [
    ["C:\\a\\p", "C:\\a\\pq\\x.ts"],
    ["C:\\a\\p", "C:\\a\\p\\..\\q\\x.ts"],
    ["C:\\a\\p", "D:\\a\\p\\x.ts"],
    ["\\\\?\\C:\\a\\p", "\\\\?\\C:\\a\\x.ts"],
    ["C:\\a\\p", "\\\\srv\\share\\a\\p\\x.ts"],
  ]
  for (const [root, child] of outside) expect([root, child, inside(root, child, win)]).toEqual([root, child, false])
  expect(inside("/a/p", "/a/p/x.ts", posix)).toBe(true)
  expect(inside("/a/p", "/a/pq/x.ts", posix)).toBe(false)
  expect(inside("/a/p", "/a/P/x.ts", posix)).toBe(false)
  expect(stripVerbatim("\\\\?\\C:\\a", win)).toBe("C:\\a")
  expect(stripVerbatim("\\\\?\\UNC\\srv\\share\\a", win)).toBe("\\\\srv\\share\\a")
  expect(stripVerbatim("\\\\?\\C:\\a", posix)).toBe("\\\\?\\C:\\a")
})

test("a plugin's real path follows its links", async () => {
  const { real } = await import("./compat/paths")
  const { mkdtempSync, mkdirSync, symlinkSync, realpathSync } = await import("node:fs")
  const nodePath = await import("node:path")
  const root = realpathSync(mkdtempSync(nodePath.join((await import("node:os")).tmpdir(), "paths-")))
  mkdirSync(nodePath.join(root, "real-state"))
  symlinkSync(nodePath.join(root, "real-state"), nodePath.join(root, "link-state"))
  expect(real(nodePath.join(root, "link-state"))).toBe(nodePath.join(root, "real-state"))
  expect(real(nodePath.join(root, "missing", ".."))).toBe(root)
})

const fence = (info: string, code: string, closed = true) => ({ language: "", info, code, streaming: !closed, closed })

test("a code block's renderer draws its box around the host's code view", async () => {
  const fake = host()
  const ctx = plugin("t.fences", fake)
  const core = modules["@opentui/core"] as Json
  const surface = "#222222"
  const render = (token: Json, cx: Json) => {
    const inner = cx.defaultRender()
    if (!inner) return undefined
    inner.bg = surface
    const box = new core.BoxRenderable(ctx.renderer, { width: "100%", flexDirection: "column", backgroundColor: surface, paddingLeft: 2, paddingRight: 1 })
    const language = (token.lang ?? "").trim()
    if (language) box.add(new core.TextRenderable(ctx.renderer, { content: language, fg: "#808080", width: "100%" }))
    box.add(inner)
    return box
  }
  ctx.markdown.registerCodeBlockRenderer("ts", render)
  expect(fake.claims.map((claim: Json) => claim.target)).toEqual([{ type: "fence", name: "typescript" }])
  const tree = fake.claims[0].view(fence("ts", "let x = 1"))
  expect(tree).toEqual({
    type: "box",
    padding_sides: { top: 0, right: 1, bottom: 0, left: 2 },
    bg: surface,
    layout: { width: { percent: 100 } },
    children: [
      { type: "text", spans: [{ text: "ts" }], fg: "#808080", layout: { width: { percent: 100 } } },
      { type: "fence", bg: surface },
    ],
  })
  await turn()
  expect(fake.warnings()).toEqual([])
})

test("a code block's language is its filetype, registered once", () => {
  const fake = host()
  const ctx = plugin("t.once", fake)
  const render = () => undefined
  const dispose = ctx.markdown.registerCodeBlockRenderer("ts", render)
  expect(() => ctx.markdown.registerCodeBlockRenderer("typescript", render)).toThrow(
    "Markdown code-block renderer already registered: typescript",
  )
  expect(() => ctx.markdown.registerCodeBlockRenderer("  ", render)).toThrow("Markdown code-block language is required")
  dispose()
  expect(fake.claims[0].ended).toBe(true)
  ctx.markdown.registerCodeBlockRenderer("TypeScript", render)
  expect(fake.claims.map((claim: Json) => [claim.target.name, claim.ended])).toEqual([
    ["typescript", true],
    ["typescript", false],
  ])
})

test("a code block's renderer declines, throws, and what it cannot draw is reported", async () => {
  const fake = host()
  const ctx = plugin("t.odd", fake)
  let mode = "decline"
  ctx.markdown.registerCodeBlockRenderer("py", (_token: Json, cx: Json) => {
    if (mode === "throw") throw new Error("boom")
    if (mode === "plain") return { type: "box" }
    if (mode === "fg") {
      const inner = cx.defaultRender()
      inner.fg = "#ffffff"
      return inner
    }
    return null
  })
  const view = fake.claims[0].view
  expect(view(fence("py", "x"))).toBeNull()
  mode = "throw"
  expect(() => view(fence("py", "x"))).toThrow("boom")
  mode = "plain"
  expect(view(fence("py", "x"))).toBeNull()
  mode = "fg"
  expect(view(fence("py", "x"))).toEqual({ type: "fence" })
  expect([fake.toasts(), fake.warnings()]).toEqual([[], []])
  await turn()
  expect(fake.toasts()).toEqual(["t.odd crashed in code block python: boom"])
  expect(fake.warnings()).toEqual([
    "t.odd: a code block's renderable built outside @opentui/core's classes is not supported by opencode-native yet",
    "t.odd: a code block's default render fg is not supported by opencode-native yet",
  ])
})

test("a prompt carries its value and description", async () => {
  const fake = host()
  const ctx = plugin("t.prompt", fake)
  void ctx.ui.dialog.prompt({ title: "Rename session", description: "/tmp/project", value: "Old title", placeholder: "Title" })
  await turn()
  void ctx.ui.dialog.prompt({ title: "Count", value: 3 })
  await turn()
  void ctx.ui.dialog.prompt({ title: "Bare" })
  await turn()
  const prompts = fake.effects.filter((effect: Json) => effect.dialog?.dialog?.type === "prompt").map((effect: Json) => {
    const { action: _action, ...prompt } = effect.dialog.dialog
    return prompt
  })
  expect(prompts).toEqual([
    { type: "prompt", title: "Rename session", placeholder: "Title", value: "Old title", description: "/tmp/project" },
    { type: "prompt", title: "Count", value: "3" },
    { type: "prompt", title: "Bare" },
  ])
  expect(fake.warnings()).toEqual([])
  void ctx.ui.dialog.prompt({ title: "Sized" })
  ctx.ui.dialog.set({ size: "large" })
  await turn()
  expect(fake.warnings()).toEqual(["t.prompt: ui.dialog.set of a prompt is not supported by opencode-native yet"])
})

test("a command's slash aliases go to the host", () => {
  const fake = host()
  const ctx = plugin("t.aliases", fake)
  ctx.keymap.layer(() => ({
    commands: [
      { id: "t.manager", title: "Manager", slash: { name: "session-manager", aliases: ["sm", "sessions"] }, run: () => {} },
      { id: "t.plain", title: "Plain", slash: { name: "plain", aliases: [] }, run: () => {} },
    ],
  }))
  expect(fake.meta.get("t.manager")).toMatchObject({ slash: "session-manager", aliases: ["sm", "sessions"] })
  expect("aliases" in fake.meta.get("t.plain")).toBe(false)
})

test("a node's minWidth and maxWidth are its layout's", () => {
  const fake = host()
  const ctx = plugin("t.widths", fake)
  ctx.ui.slot({
    append: "home.footer",
    render: () =>
      h("box", {
        flexDirection: "row",
        children: [
          h("text", { maxWidth: 40, minWidth: 0, children: "dir" }),
          h("text", { maxWidth: "50%", minWidth: 4, children: "title" }),
        ],
      }),
  })
  const row = view(fake, 0, "a").draw().children[0]
  expect(row.children.map((child: Json) => child.layout)).toEqual([
    { min_width: { cells: 0 }, max_width: { cells: 40 } },
    { min_width: { cells: 4 }, max_width: { percent: 50 } },
  ])
  expect(fake.warnings()).toEqual([])
})

test("a dialog of the plugin's own the host refuses is closed for it", async () => {
  const fake = host()
  const ctx = plugin("t.refused", fake)
  const closed: string[] = []
  await turn()
  ctx.ui.dialog.show(() => h("text", { children: "refused" }), () => closed.push("closed"))
  const sent = fake.effects.filter((effect: Json) => effect.dialog?.type === "dismissable").at(-1).dialog
  expect(sent.dialog.type).toBe("surface")
  // The host refuses it: it runs what waits for its close at once.
  fake.commands.get(sent.dismissed.name)!(sent.dismissed.input)
  expect(closed).toEqual(["closed"])
  const before = surfaceKeys(fake).length
  ctx.ui.dialog.set({ size: "large" })
  expect(surfaceKeys(fake).length).toBe(before)
})
