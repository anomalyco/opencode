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
    uncommand() {},
    storage() {},
    subscriptions: [] as Json[],
    on(types: string[], handler: (event: Json) => unknown) {
      fake.subscriptions.push({ types, handler })
    },
    async effect(request: Json) {
      fake.effects.push(request)
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
  expect(fake.toasts()).toEqual(["t.errors: a read failed: the read is 300000 bytes, over 262144"])
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

// Bigboi P8-4: a disabled layer registers nothing, and one that becomes enabled does; a layer is the base mode's
// unless it says `global`; a component's layer runs nothing once the component ended.
test("a layer keeps its conditions and ends with its component", async () => {
  const fake = host()
  const ctx = plugin("t.layer", fake)
  const [on, setOn] = solid.createSignal(false)
  const ran: string[] = []
  ctx.keymap.layer(() => ({ enabled: on(), commands: [{ id: "t.gated", run: () => ran.push("gated") }] }))
  expect(fake.commands.has("t.gated")).toBe(false)
  setOn(true)
  expect(fake.commands.has("t.gated")).toBe(true)
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

// CT-23: `@opencode/plugin/effect` is served, its `Rpc` the same as `@opencode/plugin/rpc`'s (opencode-superagent's TUI
// defines its RPC by it and failed to load); its server schemas link, undefined.
test("@opencode/plugin/effect serves Rpc", () => {
  const effect = modules["@opencode/plugin/effect"] as Json
  expect(effect.Rpc).toBe((modules["@opencode/plugin/rpc"] as Json).Rpc)
  expect("Agent" in effect && effect.Agent === undefined).toBe(true)
})

// CT-2: an element is an event emitter, as an OpenTUI renderable is, so file-browser's `element.on("focus", …)` does
// not crash its route; `focus()` of a field asks the host to focus it by its id and emits `focused`, another node's
// focus blurs it (`blurred`), and `blur()` asks the host to blur. A box's focus is the layer's alone.
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
  await turn()
  const target = { type: "node", surface, id: "list" }
  expect(fake.effects.filter((effect: Json) => effect.type === "scroll")).toEqual([
    { type: "scroll", target, verb: { type: "offset", offset: 6 } },
  ])
  expect(fake.watches.has(`scroll:${surface}:list`)).toBe(true)
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
  route.options.on({ type: "change", node, text: "ab" })
  expect([field.ref.value, field.ref.focused]).toEqual(["ab", true])
  route.options.on({ type: "submit", node, text: "ab" })
  route.options.on({ type: "change", node: "elsewhere", text: "x" })
  expect(events).toEqual(["key down", "input ab", "submit ab"])
  // The contract's focus refuses a field.
  expect(fake.toasts()).toEqual(["t.keys: focus() of an <input> is not supported by opencode-native yet"])
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
  expect(fake.toasts()).toEqual([
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
test("a built renderable adds nothing and the renderer has a root", () => {
  const fake = host()
  const ctx = plugin("t.built", fake)
  const core = modules["@opentui/core"] as Json
  const refs: Json = {}
  ctx.ui.slot({ append: "home.footer", render: () => h("box", { ref: (el: Json) => (refs.box = el) }) })
  const mount = view(fake, 0, "a")
  mount.draw()
  refs.box.add(new core.BoxRenderable({}, {}))
  expect(mount.draw().children[0].children ?? []).toEqual([])
  const renderer = ctx.renderer
  expect(["currentFocusedEditor" in renderer, "currentFocusedRenderable" in renderer]).toEqual([true, true])
  expect(typeof renderer.root.add).toBe("function")
  expect(renderer.currentFocusedEditor).toBeUndefined()
  expect(fake.toasts()).toEqual([
    "t.built: a renderable built with new is not supported by opencode-native yet",
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

// CT-15: a render that returns a renderable it built itself (opencode-quick-quote's slot marker) draws nothing and says
// so, where it crashed on `e.children.indexOf`. CT-15, CT-24: a node's `getLayout()`, `width` and `onSizeChange` are the
// host's layout of it (`Read::rect`), once the host said: the node carries an id from its next view.
test("a built renderable returned draws nothing, and a node's layout is the host's", () => {
  const fake = host()
  const ctx = plugin("t.layout", fake)
  const core = modules["@opentui/core"] as Json
  ctx.ui.slot({ append: "home.footer", render: () => new core.BoxRenderable({}, {}) })
  expect(view(fake, 0, "a").draw().children ?? []).toEqual([])
  expect(fake.toasts()).toEqual(["t.layout: a renderable built with new is not supported by opencode-native yet"])
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
  expect(refs.box.getLayout()).toEqual({ x: 0, y: 0, width: 0, height: 0 })
  fake.push(key, { x: 2, y: 3, width: 30, height: 4 })
  expect(sizes).toEqual([30])
  expect(refs.box.getLayout()).toEqual({ x: 2, y: 3, width: 30, height: 4 })
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
  expect(fake.toasts()).toContain("t.dialogs: ui.dialog.prompt value is not supported by opencode-native yet")
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
  expect(fake.toasts()).toEqual(["t.scroll: scrolling a <scrollbox> in ui.dialog.show is not supported by opencode-native yet"])
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
  expect(fake.toasts()).toEqual(["t.loud: usePaste is not supported by opencode-native yet"])
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
  // opencode-good-fences spreads a Map's values at setup.
  expect([...core.extensionToFiletype.values()]).toEqual([])
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
  expect(fake.toasts()).toEqual([
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
