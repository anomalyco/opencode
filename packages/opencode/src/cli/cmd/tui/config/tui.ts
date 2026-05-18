export * as TuiConfig from "./tui"

import z from "zod"
import { mergeDeep, unique } from "remeda"
import { Context, Effect, Fiber, Layer } from "effect"
import { ConfigParse } from "@/config/parse"
import * as ConfigPaths from "@/config/paths"
import { migrateTuiConfig } from "./tui-migrate"
import { TuiInfo } from "./tui-schema"
import { Flag } from "@opencode-ai/core/flag/flag"
import { isRecord } from "@/util/record"
import { Global } from "@opencode-ai/core/global"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { CurrentWorkingDirectory } from "./cwd"
import { ConfigPlugin } from "@/config/plugin"
import { ConfigKeybinds } from "@/config/keybinds"
import { InstallationLocal, InstallationVersion } from "@opencode-ai/core/installation/version"
import { makeRuntime } from "@opencode-ai/core/effect/runtime"
import { Filesystem } from "@/util/filesystem"
import * as Log from "@opencode-ai/core/util/log"
import { ConfigVariable } from "@/config/variable"
import { Npm } from "@opencode-ai/core/npm"

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

async function resolvePlugins(config: Info, configFilepath: string) {
  if (!config.plugin) return config
  for (let i = 0; i < config.plugin.length; i++) {
    config.plugin[i] = await ConfigPlugin.resolvePluginSpec(config.plugin[i], configFilepath)
  }
  return config
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

const loadState = Effect.fn("TuiConfig.loadState")(function* (ctx: { directory: string }) {
  // Every config dir we may read from: global config dir, any `.opencode`
  // folders between cwd and home, and OPENCODE_CONFIG_DIR.
  const directories = yield* ConfigPaths.directories(ctx.directory)
  yield* Effect.promise(() => migrateTuiConfig({ directories, cwd: ctx.directory }))

  const projectFiles = Flag.OPENCODE_DISABLE_PROJECT_CONFIG ? [] : yield* ConfigPaths.files("tui", ctx.directory)

  const acc: Acc = {
    result: {},
  }

  // 1. Global tui config (lowest precedence).
  for (const file of ConfigPaths.fileInDirectory(Global.Path.config, "tui")) {
    yield* Effect.promise(() => mergeFile(acc, file, ctx)).pipe(Effect.orDie)
  }

  // 2. Explicit OPENCODE_TUI_CONFIG override, if set.
  if (Flag.OPENCODE_TUI_CONFIG) {
    const configFile = Flag.OPENCODE_TUI_CONFIG
    yield* Effect.promise(() => mergeFile(acc, configFile, ctx)).pipe(Effect.orDie)
    log.debug("loaded custom tui config", { path: configFile })
  }

  // 3. Project tui files, applied root-first so the closest file wins.
  for (const file of projectFiles) {
    yield* Effect.promise(() => mergeFile(acc, file, ctx)).pipe(Effect.orDie)
  }

  // 4. `.opencode` directories (and OPENCODE_CONFIG_DIR) discovered while
  // walking up the tree. Also returned below so callers can install plugin
  // dependencies from each location.
  const dirs = unique(directories).filter((dir) => dir.endsWith(".opencode") || dir === Flag.OPENCODE_CONFIG_DIR)

  for (const dir of dirs) {
    if (!dir.endsWith(".opencode") && dir !== Flag.OPENCODE_CONFIG_DIR) continue
    for (const file of ConfigPaths.fileInDirectory(dir, "tui")) {
      yield* Effect.promise(() => mergeFile(acc, file, ctx)).pipe(Effect.orDie)
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
})

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const directory = yield* CurrentWorkingDirectory
    const npm = yield* Npm.Service
    const data = yield* loadState({ directory })
    const deps = yield* Effect.forEach(
      data.dirs,
      (dir) =>
        npm
          .install(dir, {
            add: [
              {
                name: "@opencode-ai/plugin",
                version: InstallationLocal ? undefined : InstallationVersion,
              },
            ],
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

export const defaultLayer = layer.pipe(Layer.provide(Npm.defaultLayer), Layer.provide(AppFileSystem.defaultLayer))

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
  return ConfigVariable.substitute({ text, type: "path", path: configFilepath, missing: "empty" })
    .then((expanded) => ConfigParse.jsonc(expanded, configFilepath))
    .then((data) => {
      if (!isRecord(data)) return {}

      // Flatten a nested "tui" key so users who wrote `{ "tui": { ... } }` inside tui.json
      // (mirroring the old opencode.json shape) still get their settings applied.
      return ConfigParse.schema(Info, normalize(data), configFilepath)
    })
    .then((data) => resolvePlugins(data, configFilepath))
    .catch((error) => {
      log.warn("invalid tui config", { path: configFilepath, error })
      return {}
    })
}
