/** @jsxImportSource @opentui/solid */
// The V2 probe of the compatibility layer's tests (P8): a `{ id, setup }` module written against `@opencode/plugin/tui`
// as an npm plugin is, with JSX over OpenTUI's intrinsics. It logs each call, one JSON line, to the file its `log`
// option names. Its commands add an item to the list its home footer claim draws, make that render throw, spin, use an
// intrinsic without a node or bare text, flood the host with toasts, ask the host's dialogs (also sized and centered),
// show a dialog of its own, open its pages (one whose commands have no `id`, one whose registrations never settle, one
// that shows a field and focuses it in one handler), toast a theme color, and use what the layer does not map. An event
// it hears is logged.

import { Plugin } from "@opencode/plugin/tui"
import { RGBA } from "@opentui/core"
import { createElement, effect, insert, insertNode, setProp } from "@opentui/solid"
import { createMemo, createSignal, onCleanup } from "solid-js"
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
    let [listening, taking] = [false, false]
    // Whether `^`, bound by `v2probe.caret`, is enabled: `v2probe.caretOn` sets it ("on" or anything else).
    const [caret, setCaret] = createSignal(false)
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
        // A printable key bound globally by a command whose `enabled` follows a signal (contract ergonomics 2.5).
        { id: "v2probe.caret", bind: "^", enabled: () => caret(), run: () => log({ caret: true }) },
        { id: "v2probe.caretOn", run: (input?: string) => void setCaret(input === "on") },
        // Declares a store, which reloads the plugin's registrations (a layer's commands change in place), and enables
        // `^` a turn later, after the manifest that reload sends.
        {
          id: "v2probe.lateCaret",
          run: () => {
            context.storage.store("caret", { initial: {} })
            setTimeout(() => setCaret(true), 0)
          },
        },
        // A palette command on `ctrl+p` that declines its key (ce-4): the host's palette opens, and lists it.
        { id: "v2probe.hotkey", title: "Probe hotkey", bind: "ctrl+p", palette: true, run: () => false },
        // A key listener (contract gaps 2), registered with the first run: it takes `ctrl+p` with `preventDefault`
        // while the run's input is "take", and lets it go on otherwise.
        {
          id: "v2probe.listen",
          run: (input?: string) => {
            if (!listening)
              context.renderer.keyInput.on("keypress", (event: { ctrl: boolean; name: string; preventDefault(): void }) => {
                if (!event.ctrl || event.name !== "p") return
                log({ listened: taking })
                if (taking) event.preventDefault()
              })
            listening = true
            taking = input === "take"
          },
        },
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
        // A select, then an alert, each sized and centered by `dialog.set` right after, as opencode-session-time's
        // `/time` (contract 2.x, addition 4).
        {
          id: "v2probe.centered",
          run: async () => {
            const turn = context.ui.dialog.select({ title: "Turns", options: [{ title: "Turn 1", value: 1 }] })
            context.ui.dialog.set({ size: "xlarge", centered: true })
            log({ turn: (await turn) ?? null })
            const told = context.ui.dialog.alert({ title: "Turn details", message: "It took long." })
            context.ui.dialog.set({ size: "xlarge", centered: true })
            await told
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
        { id: "v2probe.findpage", run: () => context.ui.router.navigate({ type: "plugin", name: "find" }) },
        { id: "v2probe.searchpage", run: () => context.ui.router.navigate({ type: "plugin", name: "search" }) },
        { id: "v2probe.churn", run: () => context.ui.router.navigate({ type: "plugin", name: "churn" }) },
        { id: "v2probe.restless", run: () => context.ui.router.navigate({ type: "plugin", name: "restless" }) },
        { id: "v2probe.grow", run: () => context.ui.router.navigate({ type: "plugin", name: "grow" }) },
        { id: "v2probe.panel", run: () => log({ opened: context.ui.panel.open("probe.panel") }) },
        { id: "v2probe.settle", run: () => context.ui.router.navigate({ type: "plugin", name: "settle" }) },
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
    // A page whose command shows a field that asks for the focus as it is created (`focused`), as file-browser's editor
    // does: the focus comes to the host with the handler's effects, the field with the next revision. What it hears is
    // logged.
    const [finding, setFinding] = createSignal(false)
    context.ui.router.register({
      name: "find",
      render: () => {
        context.keymap.layer(() => ({ commands: [{ id: "v2probe.find", run: () => setFinding(true) }] }))
        return (
          <box flexDirection="column">
            <text>find page</text>
            {() =>
              finding() ? (
                <input id="find" focused placeholder="find" onInput={(text: string) => log({ found: text })} />
              ) : (
                <text>no field</text>
              )
            }
          </box>
        )
      },
    })
    // A page whose commands change as the user types in its controlled field: the matches show from the first letter, a
    // component with keys of its own, as a list a search opens.
    const [searching, setSearching] = createSignal(false)
    const [query, setQuery] = createSignal("")
    const Matches = () => {
      context.keymap.layer(() => ({ commands: [{ id: "v2probe.clear", run: () => setSearching(false) }] }))
      return <text>{`query ${query()}.`}</text>
    }
    context.ui.router.register({
      name: "search",
      render: () => {
        context.keymap.layer(() => ({ commands: [{ id: "v2probe.search", run: () => setSearching(true) }] }))
        const typed = createMemo(() => query() !== "")
        return (
          <box flexDirection="column">
            {() =>
              searching() ? (
                <input id="search" focused value={query()} onInput={(text: string) => setQuery(text)} />
              ) : (
                <text>not searching</text>
              )
            }
            {() => (typed() ? <Matches /> : <text>no query.</text>)}
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
    // A session panel whose render registers a key layer, as opencode-self-improvement's /memory panel does: the panel
    // stays open (CT-29).
    context.ui.slot({
      append: "session.panel",
      render: (panel: { name: string }) => {
        context.keymap.layer(() => ({ commands: [{ id: "v2probe.panel-key", run() {} }] }))
        return <text>{`probe panel ${panel.name}`}</text>
      },
    })
    // Two pages sized from their own width (contract 2.x, addition 1, R3): `grow` widens its box by a cell each time
    // its size comes, without end; `settle` takes the width it first measured plus one, once. Built as Solid compiles
    // a plugin's JSX, so the box and its width signal stay as the size changes.
    const sized = (name: string, next: (width: number) => number) =>
      context.ui.router.register({
        name,
        render: () => {
          const [width, setWidth] = createSignal(10)
          const box = createElement("box")
          const text = createElement("text")
          insertNode(box, text)
          insert(text, `${name} page`)
          effect(() => setProp(box, "width", width()))
          setProp(box, "onSizeChange", function (this: { width: number }) {
            log({ [name]: this.width })
            setWidth(next(this.width))
          })
          return box
        },
      })
    sized("grow", (width) => (width % 40) + 1)
    let settled = false
    sized("settle", (width) => (settled ? width : ((settled = true), width + 1)))
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
            if (mode() === "select") return <tab_select />
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
