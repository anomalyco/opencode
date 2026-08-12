import { NodeFileSystem } from "@effect/platform-node"
import { Flock } from "@opencode-ai/util/flock"
import { Global } from "@opencode-ai/util/global"
import { Effect, FileSystem, Option } from "effect"
import { expect, test } from "bun:test"
import { parse } from "jsonc-parser"
import path from "path"
import { Config } from "../src/config"

function run<A, E>(directory: string, effect: Effect.Effect<A, E, Config.Service>) {
  return Effect.runPromise(
    effect.pipe(
      Effect.provide(Config.layer),
      Effect.provide(Global.layerWith({ config: directory, state: directory })),
      Effect.provide(NodeFileSystem.layer),
    ),
  )
}

test("migrates tui and kv config into cli.json", async () => {
  const directory = await Bun.$`mktemp -d`.text().then((value) => value.trim())
  await Bun.write(
    path.join(directory, "tui.json"),
    JSON.stringify({
      theme: "legacy",
      keybinds: {
        leader: "ctrl+o",
        app_exit: "ctrl+q",
        app_heap_snapshot: "ctrl+h",
        input_paste: { key: "ctrl+v", preventDefault: false },
        session_delete: false,
        "dialog.select.next": "ctrl+n",
      },
      plugin: [["example", { mode: "safe" }]],
      plugin_enabled: { disabled: false },
      leader_timeout: 500,
      scroll_speed: 2,
      scroll_acceleration: { enabled: true },
      diff_style: "stacked",
      mouse: false,
    }),
  )
  await Bun.write(
    path.join(directory, "kv.json"),
    JSON.stringify({
      theme_mode_lock: "light",
      attention_sound_pack: "custom.pack",
      diff_wrap_mode: "none",
      diff_viewer_show_file_tree: false,
      diff_viewer_single_patch: true,
      diff_viewer_view: "split",
      terminal_title_enabled: false,
      file_context_enabled: false,
      paste_summary_enabled: false,
      sidebar: "hide",
      scrollbar_visible: true,
      thinking_mode: "show",
      exploration_grouping: false,
      dismissed_getting_started: true,
      animations_enabled: false,
      skipped_version: "9.9.9",
      which_key_layout: "overlay",
    }),
  )

  try {
    const config = await run(
      directory,
      Effect.gen(function* () {
        const service = yield* Config.Service
        return yield* service.get()
      }),
    )

    expect(config).toMatchObject({
      theme: { name: "legacy", mode: "light" },
      keybinds: {
        leader: "ctrl+o",
        "app.exit": "ctrl+q",
        "prompt.paste": { key: "ctrl+v", preventDefault: false },
        "session.delete": false,
        "dialog.select.next": "ctrl+n",
      },
      plugins: [{ package: "example", options: { mode: "safe" } }, "-disabled"],
      leader: { timeout: 500 },
      scroll: { speed: 2, acceleration: true },
      attention: { sound_pack: "custom.pack" },
      diffs: { wrap: "none", tree: false, single: true, view: "split" },
      terminal: { title: false },
      prompt: { editor: false, paste: "full" },
      session: { sidebar: "hide", scrollbar: true, thinking: "show", grouping: "none" },
      animations: false,
      mouse: false,
    })
    expect(config).not.toHaveProperty("skipped_version")
    expect(config).not.toHaveProperty("which_key")
    expect(config).not.toHaveProperty("hints")
    expect((await Bun.file(path.join(directory, "cli.json")).json()).keybinds).toEqual({
      leader: "ctrl+o",
      "app.exit": "ctrl+q",
      "prompt.paste": { key: "ctrl+v", preventDefault: false },
      "session.delete": false,
      "dialog.select.next": "ctrl+n",
    })
    expect(await Bun.file(path.join(directory, "cli.json")).exists()).toBe(true)
    expect(await Bun.file(path.join(directory, "tui.json")).exists()).toBe(true)
    expect(await Bun.file(path.join(directory, "kv.json")).exists()).toBe(true)
  } finally {
    await Bun.$`rm -rf ${directory}`
  }
})

test("migrates before the first update and does not remigrate afterward", async () => {
  const directory = await Bun.$`mktemp -d`.text().then((value) => value.trim())
  await Bun.write(path.join(directory, "tui.json"), JSON.stringify({ theme: "legacy" }))

  try {
    const config = await run(
      directory,
      Effect.gen(function* () {
        const service = yield* Config.Service
        yield* service.update((draft) => {
          draft.animations = false
          draft.mouse = false
        })
        yield* Effect.promise(() => Bun.write(path.join(directory, "tui.json"), JSON.stringify({ theme: "changed" })))
        return yield* service.get()
      }),
    )

    expect(config).toEqual({ theme: { name: "legacy" }, animations: false, mouse: false })
    expect(await Bun.file(path.join(directory, "cli.json")).json()).toEqual({
      theme: { name: "legacy" },
      animations: false,
      mouse: false,
    })
  } finally {
    await Bun.$`rm -rf ${directory}`
  }
})

test("preserves legacy cursor settings", async () => {
  const directory = await Bun.$`mktemp -d`.text().then((value) => value.trim())
  await Bun.write(path.join(directory, "tui.json"), JSON.stringify({ cursor: { style: "underline", blinking: false } }))

  try {
    const config = await run(
      directory,
      Effect.gen(function* () {
        const service = yield* Config.Service
        return yield* service.get()
      }),
    )

    expect(config.cursor).toEqual({ style: "underline", blinking: false })
    expect((await Bun.file(path.join(directory, "cli.json")).json()).cursor).toEqual({
      style: "underline",
      blinking: false,
    })
  } finally {
    await Bun.$`rm -rf ${directory}`
  }
})

test("migrates legacy keybind names in an existing cli.json", async () => {
  const directory = await Bun.$`mktemp -d`.text().then((value) => value.trim())
  const file = path.join(directory, "cli.json")
  await Bun.write(
    file,
    `{
  // Preserve this comment
  "keybinds": {
    // Session list shortcut
    "session_list": "ctrl+l",
    "app_heap_snapshot": "ctrl+h",
    // Legacy delete shortcut
    "session_delete": "ctrl+d",
    // Canonical delete shortcut
    "session.delete": "ctrl+x",
    "app.heap_snapshot": "ctrl+shift+h"
  }
}
`,
  )

  try {
    const config = await run(
      directory,
      Effect.gen(function* () {
        const service = yield* Config.Service
        return yield* service.get()
      }),
    )

    expect(config.keybinds).toEqual({
      "session.list": "ctrl+l",
      "session.delete": "ctrl+x",
    })
    const text = await Bun.file(file).text()
    expect(text).toContain("// Preserve this comment")
    expect(text).toContain("// Session list shortcut")
    expect(text).toContain("// Legacy delete shortcut")
    expect(text).toContain("// Canonical delete shortcut")
    expect(parse(text).keybinds).toEqual({
      "session.list": "ctrl+l",
      "session.delete": "ctrl+x",
    })
  } finally {
    await Bun.$`rm -rf ${directory}`
  }
})

test("uses migrated keybinds when persistence fails", async () => {
  const directory = await Bun.$`mktemp -d`.text().then((value) => value.trim())
  const file = path.join(directory, "cli.json")
  await Bun.write(file, `{"keybinds":{"session_list":"ctrl+l"}}`)
  const node = await Effect.runPromise(FileSystem.FileSystem.pipe(Effect.provide(NodeFileSystem.layer)))
  const fs = new Proxy(node, {
    get(target, property, receiver) {
      if (property === "rename") return () => Effect.die(new Error("read-only config"))
      return Reflect.get(target, property, receiver)
    },
  })

  try {
    const config = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* Config.Service
        return yield* service.get()
      }).pipe(
        Effect.provide(Config.layer),
        Effect.provide(Global.layerWith({ config: directory, state: directory })),
        Effect.provideService(FileSystem.FileSystem, fs),
      ),
    )

    expect(config.keybinds).toEqual({ "session.list": "ctrl+l" })
    expect(await Bun.file(file).json()).toEqual({ keybinds: { session_list: "ctrl+l" } })
    expect(await Array.fromAsync(new Bun.Glob("*.tmp").scan(directory))).toEqual([])
  } finally {
    await Bun.$`rm -rf ${directory}`
  }
})

test("preserves the effective value when migrating duplicate legacy keybinds", async () => {
  const directory = await Bun.$`mktemp -d`.text().then((value) => value.trim())
  const file = path.join(directory, "cli.json")
  await Bun.write(file, `{"keybinds":{"session_delete":"ctrl+a","session_delete":"ctrl+b"}}`)

  try {
    const config = await run(
      directory,
      Effect.gen(function* () {
        const service = yield* Config.Service
        return yield* service.get()
      }),
    )

    expect(config.keybinds).toEqual({ "session.delete": "ctrl+b" })
    expect(parse(await Bun.file(file).text()).keybinds).toEqual({ "session.delete": "ctrl+b" })
  } finally {
    await Bun.$`rm -rf ${directory}`
  }
})

test("migrates and updates the effective duplicate top-level keybinds", async () => {
  const directory = await Bun.$`mktemp -d`.text().then((value) => value.trim())
  const file = path.join(directory, "cli.json")
  await Bun.write(file, `{"keybinds":{"session_delete":"first"},"keybinds":{"session_delete":"last"}}`)

  try {
    const config = await run(
      directory,
      Effect.gen(function* () {
        const service = yield* Config.Service
        expect((yield* service.get()).keybinds).toEqual({ "session.delete": "last" })
        return yield* service.update((draft) => {
          draft.keybinds = { ...draft.keybinds, "session.delete": "changed" }
        })
      }),
    )

    expect(config.keybinds).toEqual({ "session.delete": "changed" })
    expect(parse(await Bun.file(file).text()).keybinds).toEqual({ "session.delete": "changed" })
  } finally {
    await Bun.$`rm -rf ${directory}`
  }
})

test("serializes migration and updates across processes", async () => {
  const directory = await Bun.$`mktemp -d`.text().then((value) => value.trim())
  const file = path.join(directory, "cli.json")
  const started = path.join(directory, "started")
  const release = path.join(directory, "release")
  const migrateReady = path.join(directory, "migrate-ready")
  const updateReady = path.join(directory, "update-ready")
  await Bun.write(file, `{"keybinds":{"session_delete":"ctrl+d"}}`)
  const worker = path.join(import.meta.dir, "fixture/config-concurrency.ts")
  const migrate = Bun.spawn([process.execPath, worker, "migrate", directory, started, release, migrateReady], {
    stdout: "ignore",
    stderr: "pipe",
  })

  try {
    await waitForFile(started, migrate.exited)
    const update = Bun.spawn([process.execPath, worker, "update", directory, started, release, updateReady], {
      stdout: "ignore",
      stderr: "pipe",
    })
    try {
      await waitForFile(updateReady, update.exited)
      expect(await Promise.race([update.exited.then(() => true), Bun.sleep(500).then(() => false)])).toBe(false)
      await Bun.write(release, "")
      const [migrateCode, updateCode] = await Promise.all([migrate.exited, update.exited])
      expect(await new Response(migrate.stderr).text()).toBe("")
      expect(await new Response(update.stderr).text()).toBe("")
      expect([migrateCode, updateCode]).toEqual([0, 0])
      expect(await Bun.file(file).json()).toEqual({ keybinds: { "session.delete": "ctrl+d" }, mouse: false })
    } finally {
      update.kill()
      await update.exited
    }
  } finally {
    await Bun.write(release, "")
    migrate.kill()
    await migrate.exited
    await Bun.$`rm -rf ${directory}`
  }
})

test("config reads remain interruptible while waiting for the file lock", async () => {
  const directory = await Bun.$`mktemp -d`.text().then((value) => value.trim())
  const file = path.join(directory, "cli.json")
  const locks = path.join(directory, "locks")
  const held = await Flock.acquire(file, { dir: locks })

  try {
    const service = await Effect.runPromise(
      Config.Service.pipe(
        Effect.provide(Config.layer),
        Effect.provide(Global.layerWith({ config: directory, state: directory })),
        Effect.provide(NodeFileSystem.layer),
      ),
    )
    const result = Effect.runPromise(service.get().pipe(Effect.timeoutOption("50 millis")))
    expect(await Promise.race([result, Bun.sleep(250).then(() => "blocked" as const)])).toEqual(Option.none())
  } finally {
    await held.release()
    await Bun.$`rm -rf ${directory}`
  }
})

test("updates effective duplicate canonical keybinds", async () => {
  const directory = await Bun.$`mktemp -d`.text().then((value) => value.trim())
  const file = path.join(directory, "cli.json")
  await Bun.write(
    file,
    `{"keybinds":{"session.delete":"first","session.delete":"last","permission.mode":"off","permission.mode":"on"}}`,
  )

  try {
    const config = await run(
      directory,
      Effect.gen(function* () {
        const service = yield* Config.Service
        expect((yield* service.get()).keybinds).toEqual({ "session.delete": "last", "permission.mode": "on" })
        return yield* service.update((draft) => {
          draft.keybinds = { ...draft.keybinds, "session.delete": "changed", "permission.mode": "changed" }
        })
      }),
    )

    expect(config.keybinds).toEqual({ "session.delete": "changed", "permission.mode": "changed" })
    expect(parse(await Bun.file(file).text()).keybinds).toEqual({
      "session.delete": "changed",
      "permission.mode": "changed",
    })
  } finally {
    await Bun.$`rm -rf ${directory}`
  }
})

test("removes orphaned keybinds without deleting trailing comments", async () => {
  const directory = await Bun.$`mktemp -d`.text().then((value) => value.trim())
  const file = path.join(directory, "cli.json")
  await Bun.write(
    file,
    `{
  "keybinds": {
    "app_heap_snapshot": "ctrl+h" /* Keep legacy explanation */,
    "app.heap_snapshot": "ctrl+shift+h" /* Keep canonical explanation */,
  },
}
`,
  )

  try {
    const config = await run(
      directory,
      Effect.gen(function* () {
        const service = yield* Config.Service
        return yield* service.get()
      }),
    )

    expect(config.keybinds).toEqual({})
    const text = await Bun.file(file).text()
    expect(text).toContain("/* Keep legacy explanation */")
    expect(text).toContain("/* Keep canonical explanation */")
    expect(parse(text).keybinds).toEqual({})
  } finally {
    await Bun.$`rm -rf ${directory}`
  }
})

test("updates a config draft while preserving JSONC comments", async () => {
  const directory = await Bun.$`mktemp -d`.text().then((value) => value.trim())
  await Bun.write(path.join(directory, "cli.json"), '{\n  // Keep this comment\n  "animations": true\n}\n')

  try {
    const config = await run(
      directory,
      Effect.gen(function* () {
        const service = yield* Config.Service
        return yield* service.update((draft) => {
          draft.prompt = { paste: "compact" }
          draft.mini = { thinking: "hide", shell_output: "hide", turn_summary: "hide", splash: "hide", mono: true }
        })
      }),
    )

    expect(config).toEqual({
      animations: true,
      prompt: { paste: "compact" },
      mini: { thinking: "hide", shell_output: "hide", turn_summary: "hide", splash: "hide", mono: true },
    })
    expect(await Bun.file(path.join(directory, "cli.json")).text()).toContain("// Keep this comment")
  } finally {
    await Bun.$`rm -rf ${directory}`
  }
})

async function waitForFile(file: string, exited: Promise<number>) {
  const found = await Promise.race([
    (async () => {
      while (!(await Bun.file(file).exists())) await Bun.sleep(10)
      return true
    })(),
    exited.then(() => false),
    Bun.sleep(5000).then(() => false),
  ])
  if (!found) throw new Error(`timed out waiting for ${file}`)
}
