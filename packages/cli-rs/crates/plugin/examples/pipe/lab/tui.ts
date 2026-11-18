// Exercises reads, effects and snapshots through the public plugin context.

export default {
  id: "example.lab",
  setup(api: any) {
    const carrier = api[Symbol.for("opencode.carrier")]
    const toast = (message: string) => api.ui.toast.show({ message })
    const state = { a: 0, c: 0, zero: false, big: false, exit: false }
    // Each mount's content handle, as a handle names content of its own mount alone, and its inner builds.
    const handles = new Map<string, number>()
    const inner = new Map<string, number>()
    const command = (name: string, run: (input?: string) => unknown) => carrier.command({ name, title: name }, run)
    carrier.storage(["note"])
    carrier.watch("note", { type: "storage-get", key: "note" })
    for (let index = 0; index < 140; index++) carrier.watch(`w${index}`, { type: "info" })
    command("lab.context", () => toast(`${api.app.version} ${api.app.channel} ${api.themeMode}`))
    command("lab.store", async (input?: string) => {
      await carrier.effect({ type: "storage-set", key: "note", value: JSON.stringify({ text: input }) })
      const stored = await carrier.effect({ type: "storage-get", key: "note" })
      toast(`stored ${JSON.stringify(stored).slice(0, 100)}`)
    })
    command("lab.unwatch", () => carrier.unwatch("note"))
    command("lab.readerror", () => toast(`read error ${carrier.readError("note") ?? "none"}`))
    command("lab.notelength", () => toast(`note length ${JSON.stringify(carrier.read("note") ?? null).length}`))
    command("lab.watches", () => {
      let answered = 0
      for (let index = 0; index < 140; index++) if (carrier.read(`w${index}`) !== undefined) answered++
      toast(`watches ${answered}`)
    })
    // A watch of a handler's, which a setup again does not make.
    command("lab.late", () => {
      // Its watches are at the bound: one goes first.
      carrier.unwatch("w0")
      carrier.watch("late", { type: "info" })
    })
    command("lab.lateread", () => toast(`late ${carrier.read("late") !== undefined}`))
    command("lab.effects", (input?: string) => {
      for (let index = 0; index < Number(input); index++) carrier.effect({ type: "log", level: "debug", message: `${index}` })
    })
    command("lab.bigint", () => carrier.effect({ type: "log", level: "info", message: 1n }))
    command("lab.bigview", () => {
      state.big = true
    })
    command("lab.exit", () => {
      state.exit = true
    })
    command("lab.a", () => {
      state.a += 1
    })
    command("lab.c", () => {
      state.c += 1
    })
    command("lab.inner", () => toast(`inner ${Math.max(...inner.values())}`))
    command("lab.zero", () => {
      state.zero = true
    })
    carrier.surface("lab", { type: "slot", kind: "append", path: "home.footer" }, (cx: any) => {
      if (state.exit) process.exit(9)
      if (state.big) return { type: "text", spans: [{ text: `big ${1n}` }], size: 1n }
      if (state.zero) return { type: "box", layout: { height: { cells: 0 } }, children: [] }
      const mount = JSON.stringify(cx.mount)
      const last = handles.get(mount)
      if (last) cx.release(last)
      const handle = cx.content(`@@ -1 +1 @@\n-c\n+c ${state.c}\n`)
      handles.set(mount, handle)
      return {
        type: "box",
        children: [
          { type: "text", spans: [{ text: `lab c=${state.c} note=${JSON.stringify(carrier.read("note") ?? null)}` }] },
          cx.memo("outer", state.a, () => ({
            type: "box",
            children: [
              { type: "text", spans: [{ text: `lab a=${state.a}` }] },
              cx.memo("inner", 0, () => {
                inner.set(mount, (inner.get(mount) ?? 0) + 1)
                return { type: "text", spans: [{ text: "lab inner" }] }
              }),
            ],
          })),
          { type: "diff", content: { content: handle } },
        ],
      }
    })
  },
}
