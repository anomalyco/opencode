/** @jsxImportSource @opentui/solid */
// The V2 probe of the compatibility layer's tests (P8): a `{ id, setup }` module written against `@opencode/plugin/tui`
// as an npm plugin is, with JSX over OpenTUI's intrinsics. It logs each call, one JSON line, to the file its `log`
// option names. Its commands add an item to the list its home footer claim draws, make that render throw, spin, use an
// intrinsic without a node or bare text, flood the host with toasts, ask the host's dialogs, show a dialog of its own,
// open its pages (one whose commands have no `id`, one whose registrations never settle), toast a theme color, and use
// what the layer does not map. An event it hears is logged.

import { Plugin } from "@opencode/plugin/tui"
import { RGBA } from "@opentui/core"
import { createSignal, onCleanup } from "solid-js"
import { appendFileSync, existsSync, readFileSync } from "node:fs"
import path from "node:path"

// The module's own code runs as it is imported: it says so, so a test can tell it never ran before approval, and which
// version of it ran. The file it writes to is the one `marker.txt` beside it names, if any: a project's plugin runs
// from a copy of its files.
const MODULE = true
const named = path.join(import.meta.dir, "marker.txt")
const marker = existsSync(named) ? readFileSync(named, "utf8").trim() : path.join(import.meta.dir, "..", ".v2probe.log.jsonl")
appendFileSync(marker, JSON.stringify({ module: MODULE }) + "\n")

export default Plugin.define({
  id: "example.v2probe",
  setup(context) {
    const file = context.options.log ?? path.join(import.meta.dir, "..", ".v2probe.log.jsonl")
    const log = (entry: unknown) => appendFileSync(file, JSON.stringify(entry) + "\n")
    const [items, setItems] = createSignal<string[]>([])
    const [mode, setMode] = createSignal("ok")
    const [shown, setShown] = createSignal(0)
    let keyArm = "pass"
    const Commands = () => <text>{`v2probe commands ${context.keymap.commands().length > 0}`}</text>
    log({ setup: true })
    // A command of the base mode, as a layer without `mode` is: it does not run while a dialog has the keyboard.
    context.keymap.layer(() => ({ commands: [{ id: "v2probe.base", run: () => log({ base: true }) }] }))
    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "v2probe.add",
          title: "Add an item",
          run: (input?: string) => {
            log({ add: input })
            setItems((list) => [...list, String(input)])
          },
        },
        // A printable key bound globally, which declines: what `v2probe.arm` set makes its next run stall the JS host
        // for 1.5 s or end it 300 ms on, while keys are held after it.
        {
          id: "v2probe.percent",
          bind: "%",
          run: () => {
            const armed = keyArm
            keyArm = "pass"
            if (armed === "stall") for (const until = Date.now() + 1500; Date.now() < until; ) {}
            if (armed === "exit") {
              for (const until = Date.now() + 300; Date.now() < until; ) {}
              process.exit(7)
            }
            log({ percent: armed })
            return false
          },
        },
        { id: "v2probe.arm", run: (input?: string) => void (keyArm = String(input)) },
        { id: "v2probe.throw", run: () => void setMode("throw") },
        { id: "v2probe.loop", run: () => void setMode("loop") },
        { id: "v2probe.select", run: () => void setMode("select") },
        { id: "v2probe.bare", run: () => void setMode("bare") },
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
          id: "v2probe.show",
          run: () => {
            context.ui.dialog.show(
              () => (
                <box padding={1} gap={1}>
                  <text fg={context.theme.text.base}>
                    <b>Own dialog</b>
                  </text>
                  <text>{() => `shown ${shown()}`}</text>
                  <text fg={context.theme.text.muted} onMouseUp={() => setShown((count) => count + 1)}>
                    bump it
                  </text>
                </box>
              ),
              () => log({ closed: true }),
            )
            context.ui.dialog.set({ size: "large" })
          },
        },
        { id: "v2probe.unshow", run: () => context.ui.dialog.clear() },
        {
          id: "v2probe.color",
          run: () => {
            const [r, g, b] = (context.theme.text.muted as RGBA).toInts()
            context.ui.toast.show({ message: `#${[r, g, b].map((value) => value.toString(16).padStart(2, "0")).join("")}` })
          },
        },
        {
          id: "v2probe.page",
          run: () => context.ui.router.navigate({ type: "plugin", name: "page", data: { n: 3 } }),
        },
        { id: "v2probe.home", run: () => context.ui.router.navigate({ type: "home" }) },
        { id: "v2probe.inline", run: () => context.ui.router.navigate({ type: "plugin", name: "inline" }) },
        { id: "v2probe.churn", run: () => context.ui.router.navigate({ type: "plugin", name: "churn" }) },
        { id: "v2probe.restless", run: () => context.ui.router.navigate({ type: "plugin", name: "restless" }) },
        // A handler that rejects later, after a reload perhaps (carbon-5).
        {
          id: "v2probe.reject",
          run: async () => {
            await new Promise((resolve) => setTimeout(resolve, 300))
            throw new Error("late")
          },
        },
        // A store made after setup, written at once (carbon-2).
        {
          id: "v2probe.late",
          run: async () => {
            const [, update] = context.storage.store("late", { initial: { count: 0 } })
            await update((draft: { count: number }) => void (draft.count = 42))
            log({ stored: true })
          },
        },
        // Two reloads of the registrations, apart (carbon-2).
        {
          id: "v2probe.twice",
          run: () => {
            const layer = (id: string) => () => ({ mode: "global", commands: [{ id, run: () => log({ ran: id }) }] })
            context.keymap.layer(layer("v2probe.first"))
            setTimeout(() => context.keymap.layer(layer("v2probe.second")), 30)
          },
        },
        {
          id: "v2probe.unmapped",
          run: () => {
            context.markdown.registerCodeBlockRenderer("probe", () => undefined as never)
            log({ panel: context.ui.panel.open("side") })
          },
        },
      ],
    }))
    context.data.on("session.created", (event) => log({ event: event.data.sessionID }))
    // A page of its own: a bordered box with a title, a scroll of twenty lines, and a command that lives with it.
    context.ui.router.register({
      name: "page",
      render: (input) => {
        context.keymap.layer(() => ({ commands: [{ id: "v2probe.onpage", run: () => log({ onpage: true }) }] }))
        return (
          <box border borderStyle="rounded" title="Page" padding={1} flexGrow={1}>
            <text>{`data n=${input.data?.n}`}</text>
            <scrollbox height={5}>
              {Array.from({ length: 20 }, (_, index) => (
                <text>{`line ${index}`}</text>
              ))}
            </scrollbox>
          </box>
        )
      },
    })
    // A page whose layer's commands have no `id`, as tokscope's (CT-1), and one whose command is new each mount, which
    // never settles.
    context.ui.router.register({
      name: "inline",
      render: () => {
        context.keymap.layer(() => ({
          commands: [
            { bind: "escape", title: "back", run: () => context.ui.router.navigate({ type: "home" }) },
            { bind: "j", title: "next", run: () => log({ inline: "j" }) },
          ],
        }))
        return <text>inline page</text>
      },
    })
    // A page that names its layer's command anew each time it mounts, as opencode-navigator does (CT-21).
    let churns = 0
    context.ui.router.register({
      name: "churn",
      render: () => {
        context.keymap.layer(() => ({ commands: [{ id: `v2probe.churn-${++churns}`, run() {} }] }))
        return <text>churn page</text>
      },
    })
    // A page that registers a new command every 20 ms for as long as it shows: registrations that never settle.
    let restless = 0
    context.ui.router.register({
      name: "restless",
      render: () => {
        const timer = setInterval(
          () => context.keymap.layer(() => ({ commands: [{ id: `v2probe.restless-${++restless}`, run() {} }] })),
          20,
        )
        onCleanup(() => clearInterval(timer))
        return <text>restless page</text>
      },
    })
    context.ui.slot({
      append: "home.footer",
      render: () => (
        <box paddingLeft={2}>
          {() => {
            if (mode() === "throw") throw new Error("boom")
            if (mode() === "loop") while (true) {}
            // An intrinsic the contract has no node for, and text outside a `<text>`.
            if (mode() === "select") return <select />
            if (mode() === "bare") return <box>bare words</box>
            return (
              <text fg={context.theme.text.muted}>
                v2probe <b>{items().length}</b>: {items().join(",")}
                <span fg="#ff0000">|</span>
              </text>
            )
          }}
          <text visible={false}>hidden text</text>
          {/* Read once, in a component's body, as an installed package's JSX reads it: the host's value comes after
              the render that read it. */}
          <Commands />

        </box>
      ),
    })
    // A `replace` of a path the host does not publish, which never degrades, as in TS: it shows nowhere.
    context.ui.slot({ replace: "home.footer.custom", render: () => <text>v2probe missing replace</text> })
    // Always shown: the route as the host pushes it, which follows navigation.
    context.ui.slot({
      append: "app",
      render: () => <text>{() => `v2probe route ${context.ui.router.current().type}`}</text>,
    })
  },
})
