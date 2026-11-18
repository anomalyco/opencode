// The V2 compatibility layer as the JS host ships it (`compat.js`), given a carrier that answers as the host does: the
// rows of big-boi's P8 review that a probe of the bundle showed (reads, storage, layers, dialogs, clicks).
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
      fake.surfaces.push({ name, place, view, options })
    },
    layers: [] as Json[],
    layer(layer: Json, handler: (event: Json) => unknown) {
      fake.layers.push({ layer, handler })
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
    // Contract 2.x, step D: the renderer claims, as `host.ts` keeps them, each ended by its disposer.
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
      if (request.type === "storage-set") fake.stored.set(request.key, request.value)
      // As the host's: merged into what is stored as it is written.
      if (request.type === "storage-merge")
        fake.stored.set(request.key, JSON.stringify({ ...JSON.parse(fake.stored.get(request.key) ?? "{}"), ...request.fields }))
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

const text = (tree: Json): string =>
  tree === undefined ? "<none>" : [...(tree.spans ?? []).map((span: Json) => span.text), ...(tree.children ?? []).map(text)].join("")

// Bigboi P8-2: syncing 140 sessions' messages, one after another, keeps within the host's 128 reads (a read no mount
// holds goes when it is not used), each sync answers with its session's messages, and a new view draws.
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

// Bigboi P8-2: a read the host cannot answer (over its bound, or too large) is an error, not empty data: its sync
// rejects, the plugin is told once, and a healthy sibling read still answers.
test("a read the host could not answer rejects its sync", async () => {
  const fake = host((key) => (key === "messages:big" ? "error:the read is 300000 bytes, over 262144" : []))
  const ctx = plugin("t.errors", fake)
  await expect(ctx.data.session.message.sync("big")).rejects.toThrow("over 262144")
  await expect(ctx.data.session.message.sync("small")).resolves.toBeUndefined()
  await expect(ctx.data.session.message.sync("big")).rejects.toThrow("over 262144")
  expect(fake.warnings()).toEqual(["t.errors: a read failed: the read is 300000 bytes, over 262144"])
})

// Bigboi P8-2: a first render waits for its own reads alone: a read another operation made, which never answers, does
// not hold a view back.
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

// Bigboi P8-3: two updates before the first is written each apply to what the other wrote, as TS's under its lock; a
// field another client wrote stays.
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

// Bigboi P8-4, contract ergonomics 2.5: a disabled layer's commands are registered disabled, so the host binds no key
// of theirs, and decline if run; they are enabled as the layer is. A layer is the base mode's unless it says `global`;
// a component's layer runs nothing once the component ended.
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

// Contract ergonomics 2.5 (CT-8): a command's own `enabled`, a function of what the plugin reads, is followed: the
// host is told each change (here, the route the plugin reads), so it binds the command's key only while it holds, and
// a run while it does not declines. The layer's reads stay watched while it lives, as a mount's do.
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

// Carbon ce-1: two layers that hold the same command (session-manager's `pageup` while listing and while searching,
// each layer enabled by the other's opposite): the host holds it enabled while either is, and its run is the enabled
// layer's, whichever is newer. A layer that drops it (file-browser's `commands: []`) or ends disables it at once,
// where it stayed enabled until `uncommand`'s 250 ms; another live layer that holds it keeps it.
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

// Carbon ce-2: a command's `enabled` that reads a field's focus (file-browser's `!inputFocused()`), the open panel
// (@cleocode/goal) or the theme's mode follows it: each is a signal the layer follows, so a command disabled while
// the field had the focus is enabled once it lost it, where it stayed disabled for good.
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

// Carbon ce-2: an `enabled` that reads only what the layer cannot follow (a plain variable) leaves its command enabled
// on the host, which sends its key, and the run asks it, as TS asks it as the key comes: it can never latch off. One
// that reads a signal and a plain variable is asked again as each call into the plugin ends.
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

// Carbon ce-2: what a command's `enabled` or its layer reads stays watched while it reads it, and no longer: one that
// named 140 sessions one after another leaves the host's 128 watches free for the rest, where each stayed watched for
// good.
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

// CT-1: a component that mounts again registers its layer's commands without an `id` under the names it gave them
// before: a new name each mount was a new manifest, which reloaded tokscope and mounted its page again, without end.
// Two of the same keys and title in one layer stay two, and the newest mount's handler runs.
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

// CT-4: a plugin's TUI part calls its own server plugin's RPC as TS's client does: `@opencode/plugin/rpc` defines it,
// `client.rpc(definition)` calls `/api/rpc/<id>/<method>` with the input and answers the output, `client.rpc.call` is
// the raw call, and an event of it is the host's event `rpc.<id>.<name>`, heard until it is let go.
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

// CT-27: a text node's `content` may be OpenTUI's `StyledText`, built with `t`, `bold` and `fg`, as
// @encoredigitalgroup/opencode's panels set it: a span of each chunk, where it drew "[object Object]".
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

// CT-25: as OpenTUI's renderables, a node with a fixed width or height does not shrink unless its `flexShrink` says
// so (@wpro-eng/opencode-config's 14-cell agent names shrank to their text).
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

// CT-10: `<Portal>` draws its children in a box that fills the mount's room, over the rest, which `ref` gets; it threw,
// and opencode-landstrip's pane and opencode-sesh's menu showed nothing.
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

// CT-23: `@opencode/plugin/effect` is served, its `Rpc` the same as `@opencode/plugin/rpc`'s (opencode-superagent's TUI
// defines its RPC by it and failed to load); its server schemas link, undefined.
test("@opencode/plugin/effect serves Rpc", () => {
  const effect = modules["@opencode/plugin/effect"] as Json
  expect(effect.Rpc).toBe((modules["@opencode/plugin/rpc"] as Json).Rpc)
  expect("Agent" in effect && effect.Agent === undefined).toBe(true)
})

// CT-2: an element is an event emitter, as an OpenTUI renderable is, so file-browser's `element.on("focus", …)` does
// not crash its route; `focus()` of a field asks the host to focus it by its id and emits `focused`, another node's
// focus blurs it (`blurred`), and `blur()` asks the host to blur. A box's focus is the layer's alone. A scroll box's
// moves are the contract's verbs.
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
  await turn()
  const target = { type: "node", surface, id: "list" }
  expect(fake.effects.filter((effect: Json) => effect.type === "scroll")).toEqual([
    { type: "scroll", target, verb: { type: "offset", offset: 6 } },
    { type: "scroll", target, verb: { type: "to", node: "row-3", align: { type: "nearest" } } },
  ])
  expect(fake.watches.has(`scroll:${surface}:list`)).toBe(true)
})

// Carbon c2d-3: a renderable added inside itself, or inside a node under it, throws, as a tree without end would make
// every view of it run for good; the tree stays as it was.
test("a renderable added inside itself throws", () => {
  const { BoxRenderable } = modules["@opentui/core"] as Json
  const outer = new BoxRenderable(undefined, {})
  const inner = new BoxRenderable(undefined, {})
  outer.add(inner)
  expect(() => outer.add(outer)).toThrow("cannot be added inside itself")
  expect(() => inner.add(outer)).toThrow("cannot be added inside itself")
  expect([outer.parent, inner.parent === outer, outer.getChildren().length]).toEqual([undefined, true, 1])
})

// Carbon c2b-3: an alert, a confirm or a select is built a microtask after it is asked (so a `dialog.set` right after
// sizes it); one that a `dialog.clear()` or a `dialog.show()` settled before then answers nothing and never shows.
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
  expect(shown().some((dialog: string) => dialog.includes("LiveShow"))).toBe(true)
  expect(answers).toEqual([undefined, undefined])
})

// Carbon c2b-2: a focused field the plugin removes has the focus no more: it emits `blurred`, and the layer records no
// focus in it, so a key layer that targets it no longer holds. A field moved to another place keeps its focus.
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

// CT-11: the renderer's key handler hears each key through one global listener layer, registered with the first
// `keypress` listener (opencode-navigator's `ctrl+,`), and `useKeyboard` listens on it while its component lives. A
// route's field hears its edits, its submit and, while the plugin focused it, each key as `onKeyDown`.
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
  press("ctrl+,")
  press("shift+enter")
  press("a", "a")
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
          event.preventDefault()
          events.push(`key ${event.name}`)
        },
      }),
  })
  const route = fake.surfaces.find((surface: Json) => surface.place.type === "route")
  expect(route.options.layers).toEqual([{ scope: "surface", any: true }])
  route.view({ mount: { surface: "files", key: "a", generation: 1 }, input: { width: 40, height: 10 } })
  const id = fake.effects.length
  route.options.on({ type: "key", key: "down" })
  field.ref.focus()
  route.options.on({ type: "key", key: "down" })
  const node = fake.effects.slice(id).find((effect: Json) => effect.type === "focus").node
  // An edit in the host's field gives it the plugin's focus, as the field has the host's then.
  field.ref.blur()
  route.options.on({ type: "change", node, text: "ab", seq: 7 })
  expect([field.ref.value, field.ref.focused]).toEqual(["ab", true])
  // The field's next tree names the edit it heard, so the host tells its echo from a value of the plugin's (cf-2).
  const viewed = route.view({ mount: { surface: "files", key: "a", generation: 1 }, input: { width: 40, height: 10 } })
  expect(JSON.stringify(viewed)).toContain('"seen":7')
  route.options.on({ type: "submit", node, text: "ab" })
  route.options.on({ type: "change", node: "elsewhere", text: "x" })
  expect(events).toEqual(["key down", "input ab", "submit ab"])
  // The contract's focus of a field (`focus-input`) maps, with no notice.
  expect(node).toBe("opentui-input-" + node.split("-").at(-1))
  expect(fake.warnings()).toEqual([])
  expect(fake.toasts()).toEqual([])
})

// Ports trio (opencode-session-manager): TS renders a route into a column that fills the page, so the root of a
// route's tree grows, and a `flexGrow` box in it fills the page; a slot's root does not.
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

// Contract 2.x, `focus-input`: a field's `focused` focuses it as it is created and as it turns true, and blurs it as it
// turns false; the contract's focus and blur of its node, once each change.
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

// Contract 2.x, step B: a field's focus is the request of the mount whose render holds it, which names it; a field in
// no mount (a dialog of the plugin's own) has no focus on the host, which the client's log says once.
test("a field's focus names its mount, and a field in no mount has none", async () => {
  const fake = host()
  const ctx = plugin("t.owned", fake)
  const refs: Json = {}
  ctx.ui.router.register({ name: "f", render: () => h("input", { id: "q", ref: (el: Json) => (refs.routed = el) }) })
  const route = fake.surfaces.find((surface: Json) => surface.place.type === "route")
  const mount = { surface: "f", key: "a", generation: 7 }
  route.view({ mount, input: { width: 40, height: 10 } })
  refs.routed.focus()
  ctx.ui.dialog.show(() => h("input", { id: "d", ref: (el: Json) => (refs.shown = el) }))
  refs.shown.focus()
  refs.shown.focus()
  await turn()
  const focus = fake.effects.filter((effect: Json) => effect.type === "focus")
  expect(focus).toEqual([{ type: "focus", node: "q", mount }])
  expect(fake.warnings()).toEqual(["t.owned: focus() of an <input> in no mount is not supported by opencode-native yet"])
})

// Contract 2.x, step B (big-boi's G2): a field in no mount's tree, one the plugin removed and still holds by its ref or
// one it built and never added, has no focus on the host, by `focus()` or by its `focused` prop; the client's log
// says so once. It focuses no other mount.
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

// Contract 2.x, addition 4: a `dialog.set` right after a select, an alert or a confirm sizes and centers it, as TS's
// sizes the dialog shown; a dialog without one is medium and placed as the host places it; one after the dialog showed
// is not carried, which the client's log says once.
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

// CT-18: a box's border as OpenTUI's: `true` or an array of sides draws, anything else (`{ type: "single" }`, the
// OMO-Slim family's) draws none, and a border style or color set while the border is `false` makes it `true`.
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
  ]
  ctx.ui.slot({ append: "home.footer", render: () => cases.map((props) => h("box", props)) })
  const tree = view(fake, 0, "a").draw()
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
  ])
})

// `data.listen` hears every event the client names, as `{ details }`, through one subscription made with its first
// listener (tokscope marks a session dirty on each); it said it was not supported and heard nothing.
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

// CT-14: the TS TUI's `<spinner>` is the contract's spinner, its own frames and color reported (opencode-auto-mode
// crashed with "Unknown component type: spinner"). CT-16: an inert call of a method OpenTUI declares async answers a
// resolved promise, so `getTreeSitterClient().initialize().then(…)` (shell-highlighting's setup) runs on.
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

// CT-15: a renderable the plugin built itself, added to a node by its ref, adds nothing and says so, where the render
// crashed on `e.children.indexOf` (opencode-quick-quote). CT-17: the renderer has a root that takes nothing and the
// focus members a plugin probes for (opencode-dollar-skills refused to start without them), each reported as read.
test("a built renderable added by a ref draws, and the renderer has a root", () => {
  const fake = host()
  const ctx = plugin("t.built", fake)
  const core = modules["@opentui/core"] as Json
  const refs: Json = {}
  ctx.ui.slot({ append: "home.footer", render: () => h("box", { ref: (el: Json) => (refs.box = el) }) })
  const mount = view(fake, 0, "a")
  mount.draw()
  // Contract 2.x, step D: a renderable built with `new` is the node its JSX makes (CT-15 lifted).
  refs.box.add(new core.BoxRenderable({}, { backgroundColor: "#ff0000" }))
  expect(mount.draw().children[0].children).toEqual([{ type: "box", bg: "#ff0000", children: [] }])
  const renderer = ctx.renderer
  expect(["currentFocusedEditor" in renderer, "currentFocusedRenderable" in renderer]).toEqual([true, true])
  expect(typeof renderer.root.add).toBe("function")
  expect(renderer.currentFocusedEditor).toBeUndefined()
  expect(fake.warnings()).toEqual([
    "t.built: renderer.root is not supported by opencode-native yet",
    "t.built: renderer.currentFocusedEditor is not supported by opencode-native yet",
  ])
})

// CT-8, CT-19: a command answers `false`, so the host routes its key on, when it declines (returns `false`), when its
// `enabled` says no (linear binds `r` while its dialog shows), and when its layer ended; one that runs answers what
// it returned.
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

// CT-31: a layer of a mode of the plugin's own (`modal`, one it pushes) is active only while that is the input mode:
// elsewhere its commands decline, so opencode-usage-report's `r` goes on to the composer.
test("a layer of the plugin's own mode declines in another", () => {
  const fake = host()
  const ctx = plugin("t.mode", fake)
  ctx.keymap.layer(() => ({ mode: "modal", commands: [{ id: "t.refresh", bind: "r", run: () => "refreshed" }] }))
  const run = () => fake.commands.get("t.refresh")!()
  expect(run()).toBe(false)
  fake.push("input-mode", "modal")
  expect(run()).toBe("refreshed")
})

// Ports trio (oc-context-grid): a mode a component pushes is its mount's on the host, so the plugin's own read of the
// input mode says `base`; the layer of that mode still runs its command while the plugin's push holds, and declines
// once it is popped.
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

// CT-20: a layer's `target` holds its commands to the plugin's focus in that node: elsewhere they decline, so a key
// such as @slkiser/opencode-quota's window Escape goes on to the dialog on screen (Goal's select stayed open).
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

// CT-21: a reload of the registrations ends a mount (`handover`) and begins it again: the new mount of the same surface
// and key adopts the one that ended, so its component does not run again (navigator registered new names on each run
// and reloaded without end). One that begins after the moment renders anew, and so does one another end ended.
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

// Contract ergonomics, step 8: the host's focus was the ended mount's, so the field the plugin focused in a mount a reload
// begins again asks for it again, for the new mount, as that mount adopts the tree (`P.8/session-manager`'s search,
// whose layer reloads as the field shows, lost what the user typed). A field not focused asks for nothing.
test("a mount a reload begins again focuses the field the plugin focused", () => {
  const fake = host()
  const ctx = plugin("t.refocus", fake)
  const refs: Json = {}
  ctx.ui.slot({ append: "sidebar.content", render: () => h("input", { id: "search", ref: (el: Json) => (refs.search = el) }) })
  const cx = (generation: number) => ({ mount: { surface: "slot#0", key: "a", generation }, input: { width: 40, height: 10, slot: {} } })
  const surface = fake.surfaces[0]
  const focuses = () => fake.effects.filter((effect: Json) => effect.type === "focus").map((effect: Json) => effect.mount.generation)
  surface.view(cx(1))
  surface.options.unmount(cx(1).mount, true)
  surface.view(cx(2))
  expect(focuses()).toEqual([])
  refs.search.focus()
  surface.options.unmount(cx(2).mount, true)
  surface.view(cx(3))
  expect(focuses()).toEqual([2, 3])
  surface.options.unmount(cx(3).mount)
})

// CT-15: a render that returns a renderable it built itself (opencode-quick-quote's slot marker) draws nothing and says
// so, where it crashed on `e.children.indexOf`. CT-15, CT-24: a node's `getLayout()`, `width` and `onSizeChange` are the
// host's layout of it (`Read::rect`), once the host said: the node carries an id from its next view.
test("a built renderable returned draws, and a node's layout is the host's", () => {
  const fake = host()
  const ctx = plugin("t.layout", fake)
  const core = modules["@opentui/core"] as Json
  // Contract 2.x, step D: what a render returns built with `new` draws as its JSX (CT-15: opencode-quick-quote).
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

// The F16 data collections: the location's agents and a session's permissions, which the contract has no read of, load
// through `client` as the plugin first lists them, answer `undefined` until then, and load again on an event that
// changes them; they answered an empty list and a toast.
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

// Contract 2.x, addition 1, the room rule: before the host laid a node out, a top node of the mount answers its own
// width, `"100%"` of the room the mount's input gave or a number; a nested one answers nothing. Once laid out, a node's
// own numeric width or height is what it answers, as the host lays it out so, where the host's rect is a frame late.
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

// CT-8, CT-22: a raised surface's theme is the host's: a color the dialog or its footer gives differently from the page
// is that color, without a token, and the rest keep their page token; another name is the page's. No toast says so,
// where one covered five plugins' pages.
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

// CT-9: TS's raw hue scales, the categorical list, the stateful colors' `state` and the step functions, from the host's
// palette. A step carries the contract's token (`accent.500`), so the host restyles it; opencode-sesh read
// `theme.hue.accent` and crashed.
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

// Big-boi's catalog review (CT-1): commands without an `id` in two live layers, a global and a base one, with the same
// keys and title but other slash names and callbacks, stay two commands, each listed with its slash name and running its
// own callback; it was one command, the second callback's. Each keeps its name as its layer mounts again.
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

// Bigboi P8-7: a dialog the host closes without an answer settles at once with nothing, also with no dialog after it;
// `clear()` closes an asked dialog on the host too; a new `show` starts from the default size and place.
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
  // Contract ergonomics 2.6: a prompt's `value` is the host's field's starting text.
  const prompt = fake.effects.find((effect: Json) => effect.dialog?.dialog?.type === "prompt").dialog.dialog
  expect([prompt.title, prompt.value]).toEqual(["Name", "x"])
  expect(fake.warnings()).toEqual([])
  ctx.ui.dialog.show(() => h("text", { children: "big" }))
  ctx.ui.dialog.set({ size: "large", centered: true })
  ctx.ui.dialog.clear()
  ctx.ui.dialog.show(() => h("text", { children: "small" }))
  const panel = fake.effects.filter((effect) => effect.dialog?.type === "panel").at(-1).dialog
  expect([panel.size, panel.centered]).toEqual(["medium", false])
})

// Bigboi P8-8: the click handlers of mounts that ended are not kept.
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

// Bigboi P8-6: a session's pending inbox items are the host's, not an empty list.
test("pending items are the host's", async () => {
  const item = { type: "user", id: "inb_1", payload: { text: "queued" }, time: { created: 3 } }
  const fake = host((key) => (key === "pending:s1" ? [item] : []))
  const ctx = plugin("t.pending", fake)
  await ctx.data.session.pending.sync("s1")
  expect(ctx.data.session.pending.list("s1")).toEqual([item])
})

// Bigboi P8-6: a `<scrollbox>` in a dialog of the plugin's own does not scroll here; the keys that would scroll it say
// so, once, while it shows.
test("a dialog's scrollbox says it does not scroll", () => {
  const fake = host()
  const ctx = plugin("t.scroll", fake)
  ctx.ui.dialog.show(() => h("scrollbox", { children: h("text", { children: "long" }) }))
  const scroll = fake.meta.get("t.scroll.compat.dialog-scroll")
  expect(scroll?.keybind).toBe("up,down,pageup,pagedown")
  fake.commands.get("t.scroll.compat.dialog-scroll")!()
  fake.commands.get("t.scroll.compat.dialog-scroll")!()
  expect(fake.warnings()).toEqual(["t.scroll: scrolling a <scrollbox> in ui.dialog.show is not supported by opencode-native yet"])
})

// Carbon-3: a dialog that replaced another is a panel of its own, so its close (escape) closes it and calls its
// `onClose`; a render that throws in a dialog closes it, as TS's boundary clears it.
test("a replacing dialog closes, and a crashing one closes at once", () => {
  const fake = host()
  const ctx = plugin("t.show", fake)
  const closed: string[] = []
  ctx.ui.dialog.show(() => h("text", { children: "A" }), () => closed.push("A"))
  ctx.ui.dialog.show(() => h("text", { children: "B" }), () => closed.push("B"))
  const panels = fake.effects.filter((effect) => effect.dialog?.type === "panel").map((effect) => effect.dialog.key)
  expect(new Set(panels).size).toBe(2)
  fake.push(`dialog-open:${panels.at(-1)}`, true)
  fake.push(`dialog-open:${panels.at(-1)}`, false)
  expect(closed).toEqual(["A", "B"])
  ctx.ui.dialog.show(() => {
    throw new Error("")
  })
  const last = fake.effects.at(-1)
  expect(last.dialog?.type).toBe("close")
})

// Carbon-4: a change a view makes to another mount is drawn: only the mount being drawn takes its own changes in.
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

// Carbon-4: a hook one plugin's render used that does not map is reported for it alone.
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

// Carbon-4: a claim goes to the host as it is: a `replace` of a path the host does not publish is the host's to
// suppress, as TS's is, not an append to its ancestor.
test("a claim keeps its kind and path", () => {
  const fake = host()
  plugin("t.slots", fake).ui.slot({ replace: "home.footer.custom", render: () => h("text", { children: "z" }) })
  expect(fake.surfaces[0].place).toEqual({ type: "slot", kind: "replace", path: "home.footer.custom" })
})

// Carbon-5: numbers a render computes stay in the ABI's domains, so no tree is one the host cannot read.
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

// Carbon-4: TS's attention defaults; the host's commands run by dispatch, and the layer's own are not listed.
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

// FT-5: every name the installed `@opentui/core` and `@opentui/solid` export is one the layer exports, so a plugin's
// named import of it links; an inert class can be extended, constructed and called through, and an enum is the
// package's own.
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
  // opencode-good-fences spreads these Maps' values at setup, and registers the filetype each resolves to: OpenTUI's
  // own (contract 2.x, step D).
  expect([...core.extensionToFiletype]).toEqual([...real.extensionToFiletype])
  expect([...core.basenameToFiletype]).toEqual([...real.basenameToFiletype])
  for (const info of ["ts", "TypeScript", "sh", "zsh", "Dockerfile", "makefile", "rust,no_run", "  py  extra", "x.tsx", ".md", "unknownlang", ""])
    expect(core.infoStringToFiletype(info)).toBe(real.infoStringToFiletype(info))
})

// FT-6: a method of OpenTUI's renderer that the layer lacks warns once and does nothing, rather than throw; an emitter's
// chains, and a member that is no method stays undefined.
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

// Expected (carbon recheck-3): the JS host's containment, as TS's `FSUtil.contains` decides it, holds on Windows paths
// in every spelling of the same file: a drive letter or a name in another case, and a verbatim `\\?\` or `\\?\UNC\`
// prefix on either side, are inside; a sibling with the root as a prefix, a climb out, and another drive are not. On
// POSIX, case counts.
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

// Expected (carbon recheck-3): `real` follows links, as the containment compares real paths.
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

// Contract 2.x, step D: a fence part as the host sends it to a fence claim.
const fence = (info: string, code: string, closed = true) => ({ language: "", info, code, streaming: !closed, closed })

// Contract 2.x, step D: good-fences' renderer, as `opencode-good-fences@0.1.0` writes it (`dist/tui.js`), on the layer:
// a fence claim of the filetype, whose tree is its box of the label and the host's own code view, in the box's color.
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

// Contract 2.x, step D: as TS's registry, a language is its filetype, which the plugin registers once (a second throws,
// also by another name of it); one with no filetype throws; the disposer ends the claim, and the language is free.
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

// Contract 2.x, step D: a renderer that returns nothing declines (the host's code view stays); one that throws throws on
// to the JS host, which falls the part back, with one toast once it returned; what it set on the default render
// other than `bg`, and a value that is no renderable of the layer's, are reported once it returned.
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

// Contract ergonomics 2.6: a prompt's `value` and `description` reach the host's prompt (session-manager's rename shows
// the directory above a field holding the old title); a value that is no string is its text, and an unset one is left
// out.
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
})

// Contract ergonomics 2.6: a command's slash aliases (oc-context-grid's `/ctx`, session-manager's `/sm`) go with its
// slash name; none, or an empty list, adds nothing.
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

// Contract ergonomics 2.6: `minWidth` and `maxWidth` are the layout's, in cells or percent, as OpenTUI's (session-manager's
// directory column, `maxWidth={40}`); neither is reported any more.
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
