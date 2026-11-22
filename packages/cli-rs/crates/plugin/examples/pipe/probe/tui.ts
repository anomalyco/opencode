// Writes one JSON line per plugin call to the configured log, independent of the host's observations.

import { appendFileSync, existsSync, readFileSync, writeSync } from "node:fs"
import path from "node:path"

// Staged project plugins use the path from `log.txt` to log outside their private copy.
const named = path.join(import.meta.dir, "log.txt")
const beside = existsSync(named) ? readFileSync(named, "utf8").trim() : path.join(import.meta.dir, "..", ".probe.log.jsonl")

// The module's own code runs as it is imported: it says so, so a test can tell it never ran before approval.
appendFileSync(beside, JSON.stringify({ module: true }) + "\n")

export default {
  id: "example.probe",
  setup(api: any) {
    const carrier = api[Symbol.for("opencode.carrier")]
    // Without the option (a project's plugin has none), beside its directory: a file in it is part of its hash.
    const file = api.options.log ?? beside
    const log = (entry: unknown) => appendFileSync(file, JSON.stringify(entry) + "\n")
    let rows = 3
    let hoard: unknown[] = []
    log({ setup: true })
    carrier.command({ name: "probe.step", title: "probe.step" }, (input?: string) => {
      log({ step: Number(input) })
      api.ui.toast.show({ message: `step ${input}` })
      // The order effects apply in, as a command of the test's own records it.
      if (api.options.record) api.keymap.dispatch("recorder.note", String(input))
    })
    carrier.command({ name: "probe.hold", title: "probe.hold", hold: true }, (input?: string) => {
      const until = Date.now() + (Number(input) || 0)
      while (Date.now() < until) {}
      log({ hold: Number(input) })
    })
    // A holding command whose answer sets the composer: the keys it held come after that edit.
    carrier.command({ name: "probe.holdset", title: "probe.holdset", hold: true }, () => {
      carrier.effect({ type: "composer-edit", edit: { type: "set", text: "set:" } })
    })
    // The command returns at once; the view it makes due never does.
    let stuck = false
    carrier.command({ name: "probe.stuck", title: "probe.stuck" }, () => {
      stuck = true
    })
    // `input` calls of `probe.notes`, each `input` dispatches of the test's recorder in one answer: answers of many
    // effects that arrive together.
    carrier.command({ name: "probe.burst", title: "probe.burst" }, (input?: string) => {
      for (let index = 0; index < Number(input); index++) api.keymap.dispatch("probe.notes", input)
    })
    carrier.command({ name: "probe.notes", title: "probe.notes" }, (input?: string) => {
      for (let index = 0; index < Number(input); index++) api.keymap.dispatch("recorder.note", String(index))
    })
    carrier.command({ name: "probe.throw", title: "probe.throw" }, () => {
      api.ui.toast.show({ message: "before the throw" })
      throw new Error("the probe threw")
    })
    carrier.command({ name: "probe.hang", title: "probe.hang" }, () => {
      while (true) {}
    })
    carrier.command({ name: "probe.exit", title: "probe.exit" }, () => process.exit(7))
    carrier.command({ name: "probe.flood", title: "probe.flood" }, (input?: string) => {
      // Effects outside the call: each a message of its own.
      setTimeout(() => {
        for (let index = 0; index < Number(input); index++) carrier.effect({ type: "log", level: "debug", message: `${index}` })
      })
    })
    carrier.command({ name: "probe.raw", title: "probe.raw" }, () => {
      // To the descriptor itself, as oc-bg-color-sync sets the terminal's background, a native addon or a careless
      // write would.
      writeSync(1, "\x1b]11;rgb:10/20/30\x07not a frame\n")
      log({ raw: true })
    })
    carrier.command({ name: "probe.print", title: "probe.print" }, () => {
      console.log("a stray print")
      process.stdout.write("another stray print\n")
      log({ printed: true })
    })
    carrier.command({ name: "probe.leak", title: "probe.leak" }, (input?: string) => {
      // After the call: the JS host as a whole holds it.
      setTimeout(() => {
        for (let index = 0; index < Number(input); index++) hoard.push(Buffer.alloc(1 << 20, index))
      })
    })
    carrier.command({ name: "probe.rows", title: "probe.rows" }, (input?: string) => {
      rows = Number(input)
    })
    carrier.surface("lines", { type: "slot", kind: "prepend", path: "home.footer" }, () => {
      while (stuck) {}
      return {
      type: "box",
      children: Array.from({ length: rows }, (_, index) => ({ type: "text", spans: [{ text: `probe line ${index}` }] })),
      }
    })
    const list = { type: "node", surface: "pane", id: "list" }
    carrier.watch("list", { type: "scroll-state", target: list })
    carrier.command({ name: "probe.bottom", title: "probe.bottom" }, () => {
      carrier.effect({ type: "scroll", target: list, verb: { type: "edge", edge: "bottom" } })
    })
    carrier.surface(
      "pane",
      { type: "route", name: "pane" },
      () => ({
        type: "box",
        layout: { grow: true },
        children: [
          { type: "text", id: "state", spans: [{ text: `offset ${carrier.read("list")?.offset ?? "-"}` }] },
          {
            type: "scroll",
            id: "list",
            user_scroll: true,
            layout: { grow: true },
            children: Array.from({ length: 60 }, (_, index) => ({ type: "text", spans: [{ text: `item ${index}` }] })),
          },
        ],
      }),
      { on: (event: any) => void (event.type === "scroll" && log({ scrolled: event.event.type })) },
    )
    return () => {
      hoard = []
      log({ cleanup: true })
    }
  },
}
