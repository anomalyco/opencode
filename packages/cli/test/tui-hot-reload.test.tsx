/** @jsxImportSource @opentui/solid */
import { NodeFileSystem } from "@effect/platform-node"
import { Global } from "@opencode/util/global"
import { ConfigProvider, resolve, useConfig } from "@opencode/tui/config"
import { Keymap } from "@opencode/tui/context/keymap"
import type { TextareaRenderable } from "@opentui/core"
import { createThemeSource, ThemeProvider, useTheme, useThemes } from "@opencode/tui/context/theme"
import { testRender } from "@opentui/solid"
import { onCleanup } from "solid-js"
import { expect, test } from "bun:test"
import { Effect } from "effect"
import { mkdir, rename, rm } from "node:fs/promises"
import path from "node:path"
import { Config } from "../src/config"
import { tmpdir } from "./fixture/tmpdir"
import defaults from "../../tui/src/theme/assets/v2/opencode.json" with { type: "json" }

async function configService(directory: string) {
  const service = await Effect.runPromise(
    Config.Service.pipe(
      Effect.provide(Config.layer),
      Effect.provide(Global.layerWith({ config: directory, state: directory })),
      Effect.provide(NodeFileSystem.layer),
    ),
  )
  let reads = 0
  return {
    path: service.path,
    async get() {
      const config = await Effect.runPromise(service.get())
      reads++
      return config
    },
    get reads() {
      return reads
    },
    update: (update: Parameters<typeof service.update>[0]) => Effect.runPromise(service.update(update)),
  }
}

async function wait(read: () => boolean, label = "hot reload") {
  const started = Date.now()
  while (!read()) {
    if (Date.now() - started > 4000) throw new Error(`timed out waiting for ${label}`)
    await Bun.sleep(10)
  }
}

test("external cli.json edits update rendered settings and recover after invalid writes", async () => {
  await using directory = await tmpdir()
  const file = path.join(directory.path, "cli.json")
  await Bun.write(file, JSON.stringify({ mouse: false, scroll: { speed: 2 } }))
  const service = await configService(directory.path)
  const initial = await service.get()
  let current: ReturnType<typeof useConfig> | undefined
  function Probe() {
    current = useConfig()
    return <text>{`${current.data.mouse ? "mouse" : "none"} speed ${current.data.scroll?.speed}`}</text>
  }
  const app = await testRender(() => (
    <ConfigProvider config={resolve(initial, { terminalSuspend: true })} service={service}>
      <Probe />
    </ConfigProvider>
  ))
  app.renderer.start()
  try {
    await wait(() => service.reads > 1, "initial config read")
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("none speed 2")
    await Bun.write(file, JSON.stringify({ mouse: false, scroll: { speed: 4 } }))
    await wait(() => current?.data.scroll?.speed === 4, "changed config")
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("none speed 4")
    for (const text of ['{"mouse":', '{"scroll":{"speed":-1}}']) {
      const before = service.reads
      await Bun.write(file, text)
      await wait(() => service.reads > before, `invalid config ${text}`)
      await app.renderOnce()
      expect(app.captureCharFrame()).toContain("none speed 4")
    }
    await Bun.write(file + ".tmp", JSON.stringify({ mouse: true, scroll: { speed: 3 } }))
    await rename(file + ".tmp", file)
    await wait(() => current?.data.mouse === true && current.data.scroll?.speed === 3)
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("mouse speed 3")
  } finally {
    app.renderer.destroy()
  }
})

test("external keybinding changes cancel stale leader sequences and use the new timeout", async () => {
  await using directory = await tmpdir()
  const file = path.join(directory.path, "cli.json")
  await Bun.write(file, JSON.stringify({ keybinds: { leader: "ctrl+x", "session.list": "<leader>l" } }))
  const service = await configService(directory.path)
  const initial = await service.get()
  const calls: string[] = []
  const leaders: string[] = []
  let current: ReturnType<typeof useConfig> | undefined
  let state: ReturnType<typeof Keymap.useState> | undefined
  function Probe() {
    current = useConfig()
    state = Keymap.useState()
    const keymap = Keymap.use()
    onCleanup(
      keymap.intercept("key", ({ event }) => {
        if (keymap.isLeader(event)) leaders.push(event.name)
      }),
    )
    Keymap.createLayer(() => ({ commands: [{ id: "session.list", run: () => void calls.push("list") }] }))
    return <text>{String(current.data.keybinds.get("leader")[0]?.key)}</text>
  }
  const app = await testRender(() => (
    <ConfigProvider config={resolve(initial, { terminalSuspend: true })} service={service}>
      <Keymap.Provider>
        <Probe />
      </Keymap.Provider>
    </ConfigProvider>
  ))
  app.renderer.start()
  try {
    // Wait for the initial disk reconciliation before starting a sequence.
    await wait(() => service.reads > 1, "initial config read")
    app.mockInput.pressKey("x", { ctrl: true })
    await wait(() => state?.pending().length === 1, "initial leader")
    await Bun.write(
      file,
      JSON.stringify({ keybinds: { leader: "ctrl+a", "session.list": "<leader>q" }, leader: { timeout: 100 } }),
    )
    await wait(() => current?.data.keybinds.get("leader")[0]?.key === "ctrl+a", "updated leader")
    expect(state?.pending()).toEqual([])
    app.mockInput.pressKey("l")
    expect(calls).toEqual([])
    app.mockInput.pressKey("a", { ctrl: true })
    await wait(() => state?.pending().length === 1, "new leader")
    app.mockInput.pressKey("q")
    await wait(() => calls.length === 1)
    app.mockInput.pressKey("x", { ctrl: true })
    app.mockInput.pressKey("q")
    expect(calls).toEqual(["list"])
    app.mockInput.pressKey("a", { ctrl: true })
    await wait(() => state?.pending().length === 1)
    await wait(() => state?.pending().length === 0)
    app.mockInput.pressKey("q")
    expect(calls).toEqual(["list"])
    expect(leaders).toEqual(["x", "a", "a"])
  } finally {
    app.renderer.destroy()
  }
})

test("external input bindings update a focused production textarea", async () => {
  await using directory = await tmpdir()
  const file = path.join(directory.path, "cli.json")
  await Bun.write(file, JSON.stringify({ keybinds: { "input.select.all": "ctrl+g" } }))
  const service = await configService(directory.path)
  const initial = await service.get()
  let textarea: TextareaRenderable | undefined
  let current: ReturnType<typeof useConfig> | undefined
  function Probe() {
    current = useConfig()
    return <textarea ref={textarea} focused={true} initialValue="hello" />
  }
  const app = await testRender(() => (
    <ConfigProvider config={resolve(initial, { terminalSuspend: true })} service={service}>
      <Keymap.Provider>
        <Probe />
      </Keymap.Provider>
    </ConfigProvider>
  ))
  app.renderer.start()
  try {
    await app.renderOnce()
    expect(textarea?.plainText).toBe("hello")
    expect(app.renderer.currentFocusedEditor).toBe(textarea!)
    app.mockInput.pressKey("g", { ctrl: true })
    await wait(() => textarea?.getSelectedText() === "hello", "initial textarea binding")
    textarea?.clearSelection()
    await Bun.write(file, JSON.stringify({ keybinds: { "input.select.all": "ctrl+o" } }))
    await wait(() => current?.data.keybinds.get("input.select.all")[0]?.key === "ctrl+o")
    app.mockInput.pressKey("g", { ctrl: true })
    expect(textarea?.getSelectedText()).toBe("")
    app.mockInput.pressKey("o", { ctrl: true })
    await wait(() => textarea?.getSelectedText() === "hello", "updated textarea binding")
  } finally {
    app.renderer.destroy()
  }
})

test("custom theme files reconcile live colors and catalog without losing valid intermediate state", async () => {
  await using directory = await tmpdir()
  const themes = path.join(directory.path, "themes")
  await mkdir(themes)
  const file = path.join(themes, "live-theme.json")
  const theme = (color: string) => ({
    ...defaults,
    base: { ...defaults.base, text: { ...defaults.base.text, base: color } },
  })
  await Bun.write(file, JSON.stringify(theme("#abcdef")))
  const source = createThemeSource(directory.path, directory.path)
  let reads = 0
  let current: ReturnType<typeof useThemes> | undefined
  function Probe() {
    current = useThemes()
    const colors = useTheme()
    return <text>{colors.text.base.toString()}</text>
  }
  const app = await testRender(() => (
    <ConfigProvider config={resolve({ theme: { name: "live-theme", mode: "dark" } }, { terminalSuspend: true })}>
      <ThemeProvider
        mode="dark"
        source={{
          ...source,
          async discover() {
            const result = await source.discover()
            reads++
            return result
          },
        }}
      >
        <Probe />
      </ThemeProvider>
    </ConfigProvider>
  ))
  app.renderer.start()
  try {
    await wait(() => current?.ready === true, "initial themes")
    const first = current?.current.text.base.toString()
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain(first!)
    await Bun.write(file + ".tmp", JSON.stringify(theme("#fedcba")))
    await rename(file + ".tmp", file)
    await wait(() => current?.current.text.base.toString() !== first)
    const second = current?.current.text.base.toString()
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain(second!)
    for (const text of ["{", JSON.stringify(theme("$missing"))]) {
      const before = reads
      await Bun.write(file, text)
      await wait(() => reads > before)
      await app.renderOnce()
      expect(app.captureCharFrame()).toContain(second!)
      expect(current?.selected).toBe("live-theme")
    }
    await Bun.write(path.join(themes, "added-theme.json"), JSON.stringify(theme("#123456")))
    await wait(() => current?.has("added-theme") === true)
    expect(current?.current.text.base.toString()).toBe(second)
    await Bun.write(file, JSON.stringify(theme("#abcdef")))
    await wait(() => current?.current.text.base.toString() === first)
    await rm(file)
    await wait(() => current?.has("live-theme") === false)
    expect(current?.has("added-theme")).toBeTrue()
    expect(current?.current.text.base.toString()).not.toBe(first)
    await Bun.write(file, JSON.stringify(theme("#abcdef")))
    await wait(() => current?.has("live-theme") === true && current.current.text.base.toString() === first)
    await rm(path.join(themes, "added-theme.json"))
    await wait(() => current?.has("added-theme") === false)
    const projectThemes = path.join(directory.path, ".opencode", "themes")
    await mkdir(projectThemes, { recursive: true })
    await Bun.write(path.join(projectThemes, "project-theme.json"), JSON.stringify(theme("#654321")))
    await wait(() => current?.has("project-theme") === true)
  } finally {
    app.renderer.destroy()
  }
})
