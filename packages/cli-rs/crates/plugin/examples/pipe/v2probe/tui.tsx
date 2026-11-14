/** @jsxImportSource @opentui/solid */
// The V2 probe of the compatibility layer's tests (P8): a `{ id, setup }` module written against `@opencode/plugin/tui`
// as an npm plugin is, with JSX over OpenTUI's intrinsics. It logs each call, one JSON line, to the file its `log`
// option names. Its commands add an item to the list its home footer claim draws, make that render throw or spin,
// flood the host with toasts, pick from a select, and use what the layer does not map. An event it hears is logged.

import { Plugin } from "@opencode/plugin/tui"
import { createSignal } from "solid-js"
import { appendFileSync } from "node:fs"
import path from "node:path"

// The module's own code runs as it is imported: it says so, so a test can tell it never ran before approval.
appendFileSync(path.join(import.meta.dir, "..", ".v2probe.log.jsonl"), JSON.stringify({ module: true }) + "\n")

export default Plugin.define({
  id: "example.v2probe",
  setup(context) {
    const file = context.options.log ?? path.join(import.meta.dir, "..", ".v2probe.log.jsonl")
    const log = (entry: unknown) => appendFileSync(file, JSON.stringify(entry) + "\n")
    const [items, setItems] = createSignal<string[]>([])
    const [mode, setMode] = createSignal("ok")
    log({ setup: true })
    context.keymap.layer(() => ({
      commands: [
        {
          id: "v2probe.add",
          title: "Add an item",
          run: (input?: string) => {
            log({ add: input })
            setItems((list) => [...list, String(input)])
          },
        },
        { id: "v2probe.throw", run: () => void setMode("throw") },
        { id: "v2probe.loop", run: () => void setMode("loop") },
        { id: "v2probe.select", run: () => void setMode("select") },
        {
          id: "v2probe.flood",
          run: () => {
            const timer = setInterval(() => {
              for (let index = 0; index < 64; index++) context.ui.toast.show({ message: "flood" })
            }, 0)
            setTimeout(() => clearInterval(timer), 5_000)
          },
        },
        {
          id: "v2probe.pick",
          run: async () => {
            const value = await context.ui.dialog.select({
              title: "Pick one",
              options: [
                { title: "First", value: { n: 1 } },
                { title: "Second", value: { n: 2 } },
              ],
            })
            log({ picked: value ?? null })
          },
        },
        {
          id: "v2probe.ask",
          run: async () => {
            log({ confirmed: await context.ui.dialog.confirm({ title: "Go on?", message: "It asks." }) })
            log({ prompted: await context.ui.dialog.prompt({ title: "Name it" }) })
            await context.ui.dialog.alert({ title: "Done", message: "It told." })
            log({ alerted: true })
          },
        },
        {
          id: "v2probe.page",
          run: () => context.ui.router.navigate({ type: "plugin", name: "page", data: { n: 3 } }),
        },
        {
          id: "v2probe.unmapped",
          run: () => {
            context.ui.dialog.show(() => null)
            log({ panel: context.ui.panel.open("side") })
          },
        },
      ],
    }))
    context.data.on("session.created", (event) => log({ event: event.data.sessionID }))
    // A page of its own: a bordered box with a title, and a scroll of twenty lines.
    context.ui.router.register({
      name: "page",
      render: (input) => (
        <box border borderStyle="rounded" title="Page" padding={1} flexGrow={1}>
          <text>{`data n=${input.data?.n}`}</text>
          <scrollbox height={5}>
            {Array.from({ length: 20 }, (_, index) => (
              <text>{`line ${index}`}</text>
            ))}
          </scrollbox>
        </box>
      ),
    })
    context.ui.slot({
      append: "home.footer",
      render: () => (
        <box paddingLeft={2}>
          {() => {
            if (mode() === "throw") throw new Error("boom")
            if (mode() === "loop") while (true) {}
            // An intrinsic the contract has no node for.
            if (mode() === "select") return <select />
            return (
              <text fg={context.theme.text.muted}>
                v2probe <b>{items().length}</b>: {items().join(",")}
              </text>
            )
          }}
        </box>
      ),
    })
  },
})
