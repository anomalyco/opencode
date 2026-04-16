import z from "zod"
import { mergeDeep, unique } from "remeda"
import { Context, Effect, Fiber, Layer } from "effect"
import * as ConfigPaths from "@/config/paths"
import { migrateTuiConfig } from "./tui-migrate"
import { TuiInfo } from "./tui-schema"
import { Flag } from "@/flag/flag"
import { isRecord } from "@/util/record"
import { Global } from "@/global"
import { AppFileSystem } from "@opencode-ai/shared/filesystem"
import { Npm } from "@opencode-ai/shared/npm"
import { CurrentWorkingDirectory } from "./cwd"
import { ConfigPlugin } from "@/config/plugin"
import { ConfigKeybinds } from "@/config/keybinds"
import { InstallationLocal, InstallationVersion } from "@/installation/version"
import { makeRuntime } from "@/cli/effect/runtime"
import { Filesystem, Log } from "@/util"

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
    plugin_origins?: ConfigPlugin.Origin[]
  }

  export interface Interface {
    readonly get: () => Effect.Effect<Info>
    readonly waitForDependencies: () => Effect.Effect<void>
  }

  export class Service extends Context.Service<Service, Interface>()("@opencode/TuiConfig") {}

  function pluginScope(file: string, ctx: { directory: string }): ConfigPlugin.Scope {
    if (Filesystem.contains(ctx.directory, file)) return "local"
    // if (ctx.worktree !== "/" && Filesystem.contains(ctx.worktree, file)) return "local"
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

  async function mergeFile(acc: Acc, file: string, ctx: { directory: string }) {
    const data = await loadFile(file)
    acc.result = mergeDeep(acc.result, data)
    if (!data.plugin?.length) return

    const scope = pluginScope(file, ctx)
    const plugins = ConfigPlugin.deduplicatePluginOrigins([
      ...(acc.result.plugin_origins ?? []),
      ...data.plugin.map((spec) => ({ spec, scope, source: file })),
    ])
    acc.result.plugin = plugins.map((item) => item.spec)
    acc.result.plugin_origins = plugins
  }

  async function loadState(ctx: { directory: string }) {
    let projectFiles = Flag.OPENCODE_DISABLE_PROJECT_CONFIG ? [] : await ConfigPaths.projectFiles("tui", ctx.directory)
    const directories = await ConfigPaths.directories(ctx.directory)
    const custom = customPath()
    await migrateTuiConfig({ directories, custom, cwd: ctx.directory })
    // Re-compute after migration since migrateTuiConfig may have created new tui.json files
    projectFiles = Flag.OPENCODE_DISABLE_PROJECT_CONFIG ? [] : await ConfigPaths.projectFiles("tui", ctx.directory)

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

    const keybinds = { ...(acc.result.keybinds ?? {}) }
    if (process.platform === "win32") {
      // Native Windows terminals do not support POSIX suspend, so prefer prompt undo.
      keybinds.terminal_suspend = "none"
      keybinds.input_undo ??= unique([
        "ctrl+z",
        ...ConfigKeybinds.Keybinds.shape.input_undo.parse(undefined).split(","),
      ]).join(",")
    }
    acc.result.keybinds = ConfigKeybinds.Keybinds.parse(keybinds)

    return {
      config: acc.result,
      dirs: acc.result.plugin?.length ? dirs : [],
    }
  }

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const directory = yield* CurrentWorkingDirectory
      const npm = yield* Npm.Service
      const data = yield* Effect.promise(() => loadState({ directory }))
      const deps = yield* Effect.forEach(
        data.dirs,
        (dir) =>
          npm
            .install(dir, {
              add: ["@opencode-ai/plugin" + (InstallationLocal ? "" : "@" + InstallationVersion)],
            })
            .pipe(Effect.forkScoped),
        {
          concurrency: "unbounded",
        },
      )

      const get = Effect.fn("TuiConfig.get")(() => Effect.succeed(data.config))

      const waitForDependencies = Effect.fn("TuiConfig.waitForDependencies")(() =>
        Effect.forEach(deps, Fiber.join, { concurrency: "unbounded" }).pipe(Effect.ignore(), Effect.asVoid),
      )
      return Service.of({ get, waitForDependencies })
    }).pipe(Effect.withSpan("TuiConfig.layer")),
  )

  export const defaultLayer = layer.pipe(Layer.provide(Npm.defaultLayer))

  const { runPromise } = makeRuntime(Service, defaultLayer)

  export async function waitForDependencies() {
    await runPromise((svc) => svc.waitForDependencies())
  }

  export async function get() {
    return runPromise((svc) => svc.get())
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
        data.plugin[i] = await ConfigPlugin.resolvePluginSpec(data.plugin[i], configFilepath)
      }
    }

    return data
  }
}
