import { existsSync } from "fs"
import z from "zod"
import { mergeDeep, unique } from "remeda"
import { Config } from "./config"
import { ConfigPaths } from "./paths"
import { migrateTuiConfig } from "./tui-migrate"
import { TuiInfo } from "./tui-schema"
import { Instance } from "@/project/instance"
import { Flag } from "@/flag/flag"
import { Log } from "@/util/log"
import { isRecord } from "@/util/record"
import { Global } from "@/global"

export namespace TuiConfig {
  const log = Log.create({ service: "tui.config" })

  export const Info = TuiInfo

  type Acc = {
    result: Info
  }

  export type Info = z.output<typeof Info> & {
    // Internal resolved plugin list used by runtime loading.
    plugin_origins?: Config.PluginOrigin[]
  }

  function pluginScope(file: string): Config.PluginScope {
    if (Instance.containsPath(file)) return "local"
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

  function installDeps(dir: string): Promise<void> {
    return Config.installDependencies(dir)
  }

  async function mergeFile(acc: Acc, file: string) {
    const data = await loadFile(file)
    acc.result = mergeDeep(acc.result, data)
    if (!data.plugin?.length) return

    const scope = pluginScope(file)
    const plugins = Config.deduplicatePluginOrigins([
      ...(acc.result.plugin_origins ?? []),
      ...data.plugin.map((spec) => ({ spec, scope, source: file })),
    ])
    acc.result.plugin = plugins.map((item) => item.spec)
    acc.result.plugin_origins = plugins
  }

  const state = Instance.state(async () => {
    let projectFiles = Flag.OPENCODE_DISABLE_PROJECT_CONFIG
      ? []
      : await ConfigPaths.projectFiles("tui", Instance.directory, Instance.worktree)
    const directories = await ConfigPaths.directories(Instance.directory, Instance.worktree)
    const custom = customPath()
    const managed = Config.managedConfigDir()
    await migrateTuiConfig({ directories, custom, managed })
    // Re-compute after migration since migrateTuiConfig may have created new tui.json files
    projectFiles = Flag.OPENCODE_DISABLE_PROJECT_CONFIG
      ? []
      : await ConfigPaths.projectFiles("tui", Instance.directory, Instance.worktree)

    const acc: Acc = {
      result: {},
    }

    for (const file of ConfigPaths.fileInDirectory(Global.Path.config, "tui")) {
      await mergeFile(acc, file)
    }

    if (custom) {
      await mergeFile(acc, custom)
      log.debug("loaded custom tui config", { path: custom })
    }

    for (const file of projectFiles) {
      await mergeFile(acc, file)
    }

    for (const dir of unique(directories)) {
      if (!dir.endsWith(".opencode") && dir !== Flag.OPENCODE_CONFIG_DIR) continue
      for (const file of ConfigPaths.fileInDirectory(dir, "tui")) {
        await mergeFile(acc, file)
      }
    }

    if (existsSync(managed)) {
      for (const file of ConfigPaths.fileInDirectory(managed, "tui")) {
        await mergeFile(acc, file)
      }
    }

    acc.result.keybinds = Config.Keybinds.parse(acc.result.keybinds ?? {})

    const deps: Promise<void>[] = []
    if (acc.result.plugin?.length) {
      for (const dir of unique(directories)) {
        if (!dir.endsWith(".opencode") && dir !== Flag.OPENCODE_CONFIG_DIR) continue
        deps.push(installDeps(dir))
      }
    }

    return {
      config: acc.result,
      deps,
    }
  })

  export async function get() {
    return state().then((x) => x.config)
  }

  export async function waitForDependencies() {
    const deps = await state().then((x) => x.deps)
    await Promise.all(deps)
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
