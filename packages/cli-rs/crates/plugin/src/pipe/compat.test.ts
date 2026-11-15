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
function host(answer: (key: string) => Json = () => [], limit = 64) {
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
    command(command: Json, run: (input?: string) => unknown) {
      fake.commands.set(command.name, run)
      fake.meta.set(command.name, command)
    },
    uncommand() {},
    storage() {},
    on() {},
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

// Bigboi P8-2: syncing seventy sessions' messages, one after another, keeps within the host's 64 reads (a read no mount
// holds goes when it is not used), each sync answers with its session's messages, and a new view draws.
test("reads past the host's bound are released, not lost", async () => {
  const fake = host((key) => (key.startsWith("messages:") ? [{ id: key }] : []))
  const ctx = plugin("t.reads", fake)
  for (let index = 0; index < 70; index++) {
    await ctx.data.session.message.sync(`s${index}`)
    expect(ctx.data.session.message.list(`s${index}`)).toEqual([{ id: `messages:s${index}` }])
  }
  expect(fake.watches.size).toBeLessThanOrEqual(64)
  ctx.ui.slot({
    append: "sidebar.content",
    render: (props: Json) => h(() => h("text", { children: `n ${ctx.data.session.message.list(props.sessionID).length}` })),
  })
  const mount = view(fake, 0, "a", { session_id: "s99" })
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
  loud.ui.slot({ append: "home.footer", render: () => (solidRuntime.useKeyboard(() => {}), h("text", { children: "x" })) })
  quiet.ui.slot({ append: "sidebar.content", render: () => h("text", { children: "y" }) })
  view(fake, 0, "a").draw()
  view(fake, 1, "b").draw()
  expect(fake.toasts()).toEqual(["t.loud: useKeyboard is not supported by opencode-native yet"])
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
