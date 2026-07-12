import { NodeFileSystem } from "@effect/platform-node"
import { Global } from "@opencode-ai/core/global"
import { Effect } from "effect"
import { expect, test } from "bun:test"
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
      keybinds: { leader: "ctrl+o" },
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
      paste_summary_enabled: false,
      exploration_grouping: false,
      tips_hidden: true,
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
      keybinds: { leader: "ctrl+o" },
      plugins: [{ package: "example", options: { mode: "safe" } }, "-disabled"],
      leader: { timeout: 500 },
      scroll: { speed: 2, acceleration: true },
      diffs: { view: "unified" },
      prompt: { paste: "full" },
      session: { grouping: "none" },
      hints: { tips: false },
      mouse: false,
    })
    expect((await Bun.file(path.join(directory, "cli.json")).json()).keybinds).toEqual({ leader: "ctrl+o" })
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
        yield* Effect.promise(() =>
          Bun.write(path.join(directory, "tui.json"), JSON.stringify({ theme: "changed" })),
        )
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

test("updates a config draft while preserving JSONC comments", async () => {
  const directory = await Bun.$`mktemp -d`.text().then((value) => value.trim())
  await Bun.write(path.join(directory, "cli.json"), "{\n  // Keep this comment\n  \"animations\": true\n}\n")

  try {
    const config = await run(
      directory,
      Effect.gen(function* () {
        const service = yield* Config.Service
        return yield* service.update((draft) => {
          draft.prompt = { paste: "compact" }
        })
      }),
    )

    expect(config).toEqual({ animations: true, prompt: { paste: "compact" } })
    expect(await Bun.file(path.join(directory, "cli.json")).text()).toContain("// Keep this comment")
  } finally {
    await Bun.$`rm -rf ${directory}`
  }
})
