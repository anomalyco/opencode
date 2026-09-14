/** @jsxImportSource @opentui/solid */
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { createSignal, onCleanup, onMount, Show } from "solid-js"
import { Keymap } from "../src/context/keymap"
import { InteractivityProvider, useInteractivity } from "../src/context/interactivity"

const config = { keybinds: { get: () => [] } }

test("disabled scopes isolate named, inline, and global layers without disabling application commands", async () => {
  const calls: string[] = []
  const [enabled, setEnabled] = createSignal(false)
  let keymap!: Keymap

  function Scoped() {
    Keymap.createLayer(() => ({
      commands: [
        { id: "scoped.submit", bind: "return", run: () => void calls.push("submit") },
        { bind: "j", run: () => void calls.push("inline") },
      ],
    }))
    Keymap.createLayer(() => ({
      mode: "global",
      commands: [{ id: "scoped.global", bind: "g", run: () => void calls.push("scoped global") }],
    }))
    return null
  }

  function Harness() {
    keymap = Keymap.use()
    Keymap.createLayer(() => ({
      mode: "global",
      commands: [{ id: "app.global", bind: "x", run: () => void calls.push("app global") }],
    }))
    return (
      <InteractivityProvider enabled={enabled()}>
        <Scoped />
      </InteractivityProvider>
    )
  }

  const app = await testRender(() => (
    <Keymap.Provider config={config}>
      <Harness />
    </Keymap.Provider>
  ))
  try {
    app.mockInput.pressEnter()
    app.mockInput.pressKey("j")
    app.mockInput.pressKey("g")
    keymap.dispatch("scoped.submit")
    keymap.dispatch("scoped.global")
    app.mockInput.pressKey("x")
    expect(calls).toEqual(["app global"])

    setEnabled(true)
    app.mockInput.pressEnter()
    app.mockInput.pressKey("j")
    app.mockInput.pressKey("g")
    expect(calls).toEqual(["app global", "submit", "inline", "scoped global"])

    const pop = keymap.mode.push("modal")
    app.mockInput.pressEnter()
    app.mockInput.pressKey("g")
    app.mockInput.pressKey("x")
    expect(calls.slice(4)).toEqual(["scoped global", "app global"])

    setEnabled(false)
    app.mockInput.pressEnter()
    app.mockInput.pressKey("g")
    app.mockInput.pressKey("x")
    expect(calls.slice(6)).toEqual(["app global"])
    pop()
  } finally {
    app.renderer.destroy()
  }
})

test("nested scopes conjoin ancestors and retain dispatch-time layer predicates", async () => {
  const calls: string[] = []
  const [parent, setParent] = createSignal(false)
  const [child, setChild] = createSignal(true)
  const [layer, setLayer] = createSignal(true)
  let allowed = true
  let read!: () => boolean
  let unscoped!: () => boolean

  function Scoped() {
    read = useInteractivity()
    Keymap.createLayer(() => ({
      enabled: layer(),
      commands: [{ bind: "return", run: () => void calls.push("boolean") }],
    }))
    Keymap.createLayer(() => ({
      mode: "global",
      enabled: () => allowed,
      commands: [{ bind: "g", run: () => void calls.push("predicate") }],
    }))
    return null
  }

  function Harness() {
    unscoped = useInteractivity()
    return (
      <InteractivityProvider enabled={parent()}>
        <InteractivityProvider enabled={child()}>
          <Scoped />
        </InteractivityProvider>
      </InteractivityProvider>
    )
  }

  const app = await testRender(() => (
    <Keymap.Provider config={config}>
      <Harness />
    </Keymap.Provider>
  ))
  try {
    expect(unscoped()).toBe(true)
    expect(read()).toBe(false)
    app.mockInput.pressEnter()
    setParent(true)
    expect(read()).toBe(true)
    app.mockInput.pressEnter()
    app.mockInput.pressKey("g")

    allowed = false
    app.mockInput.pressKey("g")
    setLayer(false)
    app.mockInput.pressEnter()
    expect(calls).toEqual(["boolean", "predicate"])

    setChild(false)
    setLayer(true)
    allowed = true
    app.mockInput.pressEnter()
    app.mockInput.pressKey("g")
    expect(read()).toBe(false)
    setParent(false)
    setChild(true)
    expect(read()).toBe(false)
    app.mockInput.pressEnter()
    app.mockInput.pressKey("g")
    expect(calls).toEqual(["boolean", "predicate"])

    setParent(true)
    expect(read()).toBe(true)
    app.mockInput.pressEnter()
    app.mockInput.pressKey("g")
    expect(calls).toEqual(["boolean", "predicate", "boolean", "predicate"])
  } finally {
    app.renderer.destroy()
  }
})

test("ownerless mode pushes suspend and resume in their captured scope without changing stack order", async () => {
  const [enabled, setEnabled] = createSignal(false)
  const calls: string[] = []
  let scoped!: Keymap
  let global!: Keymap

  function Scoped() {
    scoped = Keymap.use()
    Keymap.createLayer(() => ({
      mode: "form",
      commands: [{ bind: "return", run: () => void calls.push("form") }],
    }))
    Keymap.createLayer(() => ({
      mode: "menu",
      commands: [{ bind: "return", run: () => void calls.push("menu") }],
    }))
    return null
  }

  function Harness() {
    global = Keymap.use()
    return (
      <InteractivityProvider enabled={enabled()}>
        <Scoped />
      </InteractivityProvider>
    )
  }

  const app = await testRender(() => (
    <Keymap.Provider config={config}>
      <Harness />
    </Keymap.Provider>
  ))
  try {
    const form = scoped.mode.push("form")
    expect(global.mode.current()).toBe("base")
    app.mockInput.pressEnter()
    const modal = global.mode.push("modal")
    setEnabled(true)
    expect(global.mode.current()).toBe("modal")
    app.mockInput.pressEnter()
    modal()
    expect(global.mode.current()).toBe("form")
    app.mockInput.pressEnter()
    expect(calls).toEqual(["form"])

    setEnabled(false)
    expect(global.mode.current()).toBe("base")
    const menu = scoped.mode.push("menu")
    form()
    expect(global.mode.current()).toBe("base")
    setEnabled(true)
    expect(global.mode.current()).toBe("menu")
    app.mockInput.pressEnter()
    expect(calls).toEqual(["form", "menu"])
    menu()
    expect(global.mode.current()).toBe("base")
    setEnabled(false)
    setEnabled(true)
    expect(global.mode.current()).toBe("base")
    app.mockInput.pressEnter()
    expect(calls).toEqual(["form", "menu"])
  } finally {
    app.renderer.destroy()
  }
})

test("forwarded keymaps push modes in the calling component's nested scope and clean up while inactive", async () => {
  const [enabled, setEnabled] = createSignal(false)
  const [nested, setNested] = createSignal(true)
  const [mounted, setMounted] = createSignal(true)
  let global!: Keymap

  function Scoped(props: { keymap: Keymap }) {
    onMount(() => onCleanup(props.keymap.mode.push("menu")))
    return null
  }

  function Harness() {
    global = Keymap.use()
    return (
      <InteractivityProvider enabled={enabled()}>
        <InteractivityProvider enabled={nested()}>
          <Show when={mounted()}>
            <Scoped keymap={global} />
          </Show>
        </InteractivityProvider>
      </InteractivityProvider>
    )
  }

  const app = await testRender(() => (
    <Keymap.Provider config={config}>
      <Harness />
    </Keymap.Provider>
  ))
  try {
    expect(global.mode.current()).toBe("base")
    setEnabled(true)
    expect(global.mode.current()).toBe("menu")
    setNested(false)
    expect(global.mode.current()).toBe("base")
    setNested(true)
    expect(global.mode.current()).toBe("menu")
    setEnabled(false)
    setMounted(false)
    setEnabled(true)
    expect(global.mode.current()).toBe("base")
    setMounted(true)
    expect(global.mode.current()).toBe("menu")
    setMounted(false)
    expect(global.mode.current()).toBe("base")
  } finally {
    app.renderer.destroy()
  }
})
