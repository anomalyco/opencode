import { existsSync } from "fs"
import z from "zod"
import { mergeDeep, unique } from "remeda"
import { Context, Effect, Fiber, Layer } from "effect"
import { Config } from "./config"
import { ConfigPaths } from "./paths"
import { migrateTuiConfig } from "./tui-migrate"
import { TuiInfo } from "./tui-schema"
import { Flag } from "@/flag/flag"
import { Log } from "@/util/log"
import { isRecord } from "@/util/record"
import { Global } from "@/global"
import { InstanceState } from "@/effect/instance-state"
import { makeRuntime } from "@/effect/run-service"
import { AppFileSystem } from "@opencode-ai/shared/filesystem"

export namespace TuiConfig {
  const log = Log.create({ service: "tui.config" })

  export const Info = TuiInfo

  type Acc = {
    result: Info
  }

  type State = {
    config: Info
    deps: Array<Fiber.Fiber<void, AppFileSystem.Error>>
  }

  export type Info = z.output<typeof Info> & {
    // Internal resolved plugin list used by runtime loading.
    plugin_origins?: Config.PluginOrigin[]
  }

  export interface Interface {
    readonly get: () => Effect.Effect<Info>
    readonly waitForDependencies: () => Effect.Effect<void, AppFileSystem.Error>
  }

  export class Service extends Context.Service<Service, Interface>()("@opencode/TuiConfig") {}

  function pluginScope(file: string, ctx: { directory: string; worktree: string }): Config.PluginScope {
    if (AppFileSystem.contains(ctx.directory, file)) return "local"
    if (ctx.worktree !== "/" && AppFileSystem.contains(ctx.worktree, file)) return "local"
    return "global"
  }

  function customPath() {
    return Flag.OPENCODE_TUI_CONFIG
  }

  function normalize(raw: Record<string, unknown>) {
    const data = { ...raw }
    if (!("tui" in data)) return data
    if (!isRecord(data.tui)) {
      delete data.tui
      return data
    }

    const tui = data.tui
    delete data.tui
    return {
      ...tui,
      ...data,
    }
  }

  async function mergeFile(acc: Acc, file: string, ctx: { directory: string; worktree: string }) {
    const data = await loadFile(file)
    acc.result = mergeDeep(acc.result, data)
    if (!data.plugin?.length) return

    const scope = pluginScope(file, ctx)
    const plugins = Config.deduplicatePluginOrigins([
      ...(acc.result.plugin_origins ?? []),
      ...data.plugin.map((spec) => ({ spec, scope, source: file })),
    ])
    acc.result.plugin = plugins.map((item) => item.spec)
    acc.result.plugin_origins = plugins
  }

  async function loadState(ctx: { directory: string; worktree: string }) {
    let projectFiles = Flag.OPENCODE_DISABLE_PROJECT_CONFIG
      ? []
      : await ConfigPaths.projectFiles("tui", ctx.directory, ctx.worktree)
    const directories = await ConfigPaths.directories(ctx.directory, ctx.worktree)
    const custom = customPath()
    const managed = Config.managedConfigDir()
    await migrateTuiConfig({ directories, custom, managed })
    // Re-compute after migration since migrateTuiConfig may have created new tui.json files
    projectFiles = Flag.OPENCODE_DISABLE_PROJECT_CONFIG
      ? []
      : await ConfigPaths.projectFiles("tui", ctx.directory, ctx.worktree)

    const acc: Acc = {
      result: {},
    }

    for (const file of ConfigPaths.fileInDirectory(Global.Path.config, "tui")) {
      await mergeFile(acc, file, ctx)
    }

    if (custom) {
      await mergeFile(acc, custom, ctx)
      log.debug("loaded custom tui config", { path: custom })
    }

    for (const file of projectFiles) {
      await mergeFile(acc, file, ctx)
    }

    const dirs = unique(directories).filter((dir) => dir.endsWith(".opencode") || dir === Flag.OPENCODE_CONFIG_DIR)

    for (const dir of dirs) {
      if (!dir.endsWith(".opencode") && dir !== Flag.OPENCODE_CONFIG_DIR) continue
      for (const file of ConfigPaths.fileInDirectory(dir, "tui")) {
        await mergeFile(acc, file, ctx)
      }
    }

    if (existsSync(managed)) {
      for (const file of ConfigPaths.fileInDirectory(managed, "tui")) {
        await mergeFile(acc, file, ctx)
      }
    }

    const keybinds = { ...acc.result.keybinds }
    if (process.platform === "win32") {
      // Native Windows terminals do not support POSIX suspend, so prefer prompt undo.
      keybinds.terminal_suspend = "none"
      keybinds.input_undo ??= unique(["ctrl+z", ...Config.Keybinds.shape.input_undo.parse(undefined).split(",")]).join(
        ",",
      )
    }
    acc.result.keybinds = Config.Keybinds.parse(keybinds)

    return {
      config: acc.result,
      dirs: acc.result.plugin?.length ? dirs : [],
    }
  }

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const cfg = yield* Config.Service
      const state = yield* InstanceState.make<State>(
        Effect.fn("TuiConfig.state")(function* (ctx) {
          const data = yield* Effect.promise(() => loadState(ctx))
          const deps = yield* Effect.forEach(data.dirs, (dir) => cfg.installDependencies(dir).pipe(Effect.forkScoped), {
            concurrency: "unbounded",
          })
          return { config: data.config, deps }
        }),
      )

      const get = Effect.fn("TuiConfig.get")(() => InstanceState.use(state, (s) => s.config))

      const waitForDependencies = Effect.fn("TuiConfig.waitForDependencies")(() =>
        InstanceState.useEffect(state, (s) =>
          Effect.forEach(s.deps, Fiber.join, { concurrency: "unbounded" }).pipe(Effect.asVoid),
        ),
      )

      return Service.of({ get, waitForDependencies })
    }),
  )

  export const defaultLayer = layer.pipe(Layer.provide(Config.defaultLayer))

  const { runPromise } = makeRuntime(Service, defaultLayer)

  export async function get() {
    return runPromise((svc) => svc.get())
  }

  export async function waitForDependencies() {
    await runPromise((svc) => svc.waitForDependencies())
  }

  async function loadFile(filepath: string): Promise<Info> {
    const text = await ConfigPaths.readFile(filepath)
    if (!text) return {}
    return load(text, filepath).catch((error) => {
      log.warn("failed to load tui config", { path: filepath, error })
      return {}
    })
  }

  async function load(text: string, configFilepath: string): Promise<Info> {
    const raw = await ConfigPaths.parseText(text, configFilepath, "empty")
    if (!isRecord(raw)) return {}

    // Flatten a nested "tui" key so users who wrote `{ "tui": { ... } }` inside tui.json
    // (mirroring the old opencode.json shape) still get their settings applied.
    const normalized = normalize(raw)

    const parsed = Info.safeParse(normalized)
    if (!parsed.success) {
      log.warn("invalid tui config", { path: configFilepath, issues: parsed.error.issues })
      return {}
    }

    const data = parsed.data
    if (data.plugin) {
      for (let i = 0; i < data.plugin.length; i++) {
        data.plugin[i] = await Config.resolvePluginSpec(data.plugin[i], configFilepath)
      }
    }

    return data
  }
}
