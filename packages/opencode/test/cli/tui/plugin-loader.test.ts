import { beforeAll, describe, expect, spyOn, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { pathToFileURL } from "url"
import { tmpdir } from "../../fixture/fixture"
import { createTuiPluginApi } from "../../fixture/tui-plugin"
import { Global } from "../../../src/global"
import { TuiConfig } from "../../../src/config/tui"
import { Config } from "../../../src/config/config"
import { Filesystem } from "../../../src/util/filesystem"

const { allThemes, addTheme } = await import("../../../src/cli/cmd/tui/context/theme")
const { TuiPluginRuntime } = await import("../../../src/cli/cmd/tui/plugin/runtime")

type Row = Record<string, unknown>

type Data = {
  local: Row
  global: Row
  invalid: Row
  preloaded: Row
  fn_called: boolean
  local_installed: string
  global_installed: string
  preloaded_installed: string
  leaked_local_to_global: boolean
  leaked_global_to_local: boolean
  local_theme: string
  global_theme: string
}

async function row(file: string): Promise<Row> {
  return Filesystem.readJson<Row>(file)
}

async function load(): Promise<Data> {
  const stamp = Date.now()
  const globalConfigPath = path.join(Global.Path.config, "tui.json")
  const backup = await Bun.file(globalConfigPath)
    .text()
    .catch(() => undefined)

  await using tmp = await tmpdir({
    init: async (dir) => {
      const localPluginPath = path.join(dir, "local-plugin.ts")
      const invalidPluginPath = path.join(dir, "invalid-plugin.ts")
      const preloadedPluginPath = path.join(dir, "preloaded-plugin.ts")
      const globalPluginPath = path.join(dir, "global-plugin.ts")
      const localSpec = pathToFileURL(localPluginPath).href
      const invalidSpec = pathToFileURL(invalidPluginPath).href
      const preloadedSpec = pathToFileURL(preloadedPluginPath).href
      const globalSpec = pathToFileURL(globalPluginPath).href
      const localThemeFile = `local-theme-${stamp}.json`
      const invalidThemeFile = `invalid-theme-${stamp}.json`
      const globalThemeFile = `global-theme-${stamp}.json`
      const preloadedThemeFile = `preloaded-theme-${stamp}.json`
      const localThemeName = localThemeFile.replace(/\.json$/, "")
      const invalidThemeName = invalidThemeFile.replace(/\.json$/, "")
      const globalThemeName = globalThemeFile.replace(/\.json$/, "")
      const preloadedThemeName = preloadedThemeFile.replace(/\.json$/, "")
      const localThemePath = path.join(dir, localThemeFile)
      const invalidThemePath = path.join(dir, invalidThemeFile)
      const globalThemePath = path.join(dir, globalThemeFile)
      const preloadedThemePath = path.join(dir, preloadedThemeFile)
      const localDest = path.join(dir, ".opencode", "themes", localThemeFile)
      const globalDest = path.join(Global.Path.config, "themes", globalThemeFile)
      const preloadedDest = path.join(dir, ".opencode", "themes", preloadedThemeFile)
      const fnMarker = path.join(dir, "function-called.txt")
      const localMarker = path.join(dir, "local-called.json")
      const invalidMarker = path.join(dir, "invalid-called.json")
      const globalMarker = path.join(dir, "global-called.json")
      const preloadedMarker = path.join(dir, "preloaded-called.json")
      const localConfigPath = path.join(dir, "tui.json")

      await Bun.write(localThemePath, JSON.stringify({ theme: { primary: "#101010" } }, null, 2))
      await Bun.write(invalidThemePath, "{ invalid json }")
      await Bun.write(globalThemePath, JSON.stringify({ theme: { primary: "#202020" } }, null, 2))
      await Bun.write(preloadedThemePath, JSON.stringify({ theme: { primary: "#f0f0f0" } }, null, 2))
      await Bun.write(preloadedDest, JSON.stringify({ theme: { primary: "#303030" } }, null, 2))

      await Bun.write(
        localPluginPath,
        `export const ignored = async (_input, options) => {
  if (!options?.fn_marker) return
  await Bun.write(options.fn_marker, "called")
}

export default {
  id: "demo.local",
  tui: async (api, options) => {
    if (!options?.marker) return
    const cfg_theme = api.tuiConfig.theme
    const cfg_diff = api.tuiConfig.diff_style
    const cfg_speed = api.tuiConfig.scroll_speed
    const cfg_accel = api.tuiConfig.scroll_acceleration?.enabled
    const cfg_submit = api.tuiConfig.keybinds?.input_submit
    const key = api.keybind.create(
      { modal: "ctrl+shift+m", screen: "ctrl+shift+o", close: "escape" },
      options.keybinds,
    )
    const kv_before = api.kv.get(options.kv_key, "missing")
    api.kv.set(options.kv_key, "stored")
    const kv_after = api.kv.get(options.kv_key, "missing")
    const diff = api.state.session.diff(options.session_id)
    const todo = api.state.session.todo(options.session_id)
    const lsp = api.state.lsp()
    const mcp = api.state.mcp()
    const depth_before = api.ui.dialog.depth
    const open_before = api.ui.dialog.open
    const size_before = api.ui.dialog.size
    api.ui.dialog.setSize("large")
    const size_after = api.ui.dialog.size
    api.ui.dialog.replace(() => null)
    const depth_after = api.ui.dialog.depth
    const open_after = api.ui.dialog.open
    api.ui.dialog.clear()
    const open_clear = api.ui.dialog.open
    const before = api.theme.has(options.theme_name)
    const set_missing = api.theme.set(options.theme_name)
    await api.theme.install(options.theme_path)
    const after = api.theme.has(options.theme_name)
    const set_installed = api.theme.set(options.theme_name)
    const first = await Bun.file(options.dest).text()
    await Bun.write(options.source, JSON.stringify({ theme: { primary: "#fefefe" } }, null, 2))
    await api.theme.install(options.theme_path)
    const second = await Bun.file(options.dest).text()
    await Bun.write(
      options.marker,
      JSON.stringify({
        before,
        set_missing,
        after,
        set_installed,
        selected: api.theme.selected,
        same: first === second,
        key_modal: key.get("modal"),
        key_close: key.get("close"),
        key_unknown: key.get("ctrl+k"),
        key_print: key.print("modal"),
        kv_before,
        kv_after,
        kv_ready: api.kv.ready,
        diff_count: diff.length,
        diff_file: diff[0]?.file,
        todo_count: todo.length,
        todo_first: todo[0]?.content,
        lsp_count: lsp.length,
        mcp_count: mcp.length,
        mcp_first: mcp[0]?.name,
        depth_before,
        open_before,
        size_before,
        size_after,
        depth_after,
        open_after,
        open_clear,
        cfg_theme,
        cfg_diff,
        cfg_speed,
        cfg_accel,
        cfg_submit,
      }),
    )
  },
}
`,
      )

      await Bun.write(
        invalidPluginPath,
        `export default {
  id: "demo.invalid",
  tui: async (api, options) => {
    if (!options?.marker) return
    const before = api.theme.has(options.theme_name)
    const set_missing = api.theme.set(options.theme_name)
    await api.theme.install(options.theme_path)
    const after = api.theme.has(options.theme_name)
    const set_installed = api.theme.set(options.theme_name)
    await Bun.write(
      options.marker,
      JSON.stringify({
        before,
        set_missing,
        after,
        set_installed,
      }),
    )
  },
}
`,
      )

      await Bun.write(
        preloadedPluginPath,
        `export default {
  id: "demo.preloaded",
  tui: async (api, options) => {
    if (!options?.marker) return
    const before = api.theme.has(options.theme_name)
    await api.theme.install(options.theme_path)
    const after = api.theme.has(options.theme_name)
    const text = await Bun.file(options.dest).text()
    await Bun.write(
      options.marker,
      JSON.stringify({
        before,
        after,
        text,
      }),
    )
  },
}
`,
      )

      await Bun.write(
        globalPluginPath,
        `export default {
  id: "demo.global",
  tui: async (api, options) => {
    if (!options?.marker) return
    await api.theme.install(options.theme_path)
    const has = api.theme.has(options.theme_name)
    const set_installed = api.theme.set(options.theme_name)
    await Bun.write(
      options.marker,
      JSON.stringify({
        has,
        set_installed,
        selected: api.theme.selected,
      }),
    )
  },
}
`,
      )

      await Bun.write(
        globalConfigPath,
        JSON.stringify(
          {
            plugin: [
              [globalSpec, { marker: globalMarker, theme_path: `./${globalThemeFile}`, theme_name: globalThemeName }],
            ],
          },
          null,
          2,
        ),
      )

      await Bun.write(
        localConfigPath,
        JSON.stringify(
          {
            plugin: [
              [
                localSpec,
                {
                  fn_marker: fnMarker,
                  marker: localMarker,
                  source: localThemePath,
                  dest: localDest,
                  theme_path: `./${localThemeFile}`,
                  theme_name: localThemeName,
                  kv_key: "plugin_state_key",
                  session_id: "ses_test",
                  keybinds: {
                    modal: "ctrl+alt+m",
                    close: "q",
                  },
                },
              ],
              [
                invalidSpec,
                {
                  marker: invalidMarker,
                  theme_path: `./${invalidThemeFile}`,
                  theme_name: invalidThemeName,
                },
              ],
              [
                preloadedSpec,
                {
                  marker: preloadedMarker,
                  dest: preloadedDest,
                  theme_path: `./${preloadedThemeFile}`,
                  theme_name: preloadedThemeName,
                },
              ],
            ],
          },
          null,
          2,
        ),
      )

      return {
        localThemeFile,
        invalidThemeFile,
        globalThemeFile,
        preloadedThemeFile,
        localThemeName,
        invalidThemeName,
        globalThemeName,
        preloadedThemeName,
        localDest,
        globalDest,
        preloadedDest,
        localPluginPath,
        invalidPluginPath,
        globalPluginPath,
        preloadedPluginPath,
        localSpec,
        invalidSpec,
        globalSpec,
        preloadedSpec,
        fnMarker,
        localMarker,
        invalidMarker,
        globalMarker,
        preloadedMarker,
      }
    },
  })
  const cwd = spyOn(process, "cwd").mockImplementation(() => tmp.path)
  const wait = spyOn(TuiConfig, "waitForDependencies").mockResolvedValue()
  const install = spyOn(Config, "installDependencies").mockResolvedValue()

  try {
    expect(addTheme(tmp.extra.preloadedThemeName, { theme: { primary: "#303030" } })).toBe(true)

    await TuiPluginRuntime.init(
      createTuiPluginApi({
        tuiConfig: {
          theme: "smoke",
          diff_style: "stacked",
          scroll_speed: 1.5,
          scroll_acceleration: { enabled: true },
          keybinds: {
            input_submit: "ctrl+enter",
          },
        },
        keybind: {
          print: (key) => `print:${key}`,
        },
        state: {
          session: {
            diff(sessionID) {
              if (sessionID !== "ses_test") return []
              return [{ file: "src/app.ts", additions: 3, deletions: 1 }]
            },
            todo(sessionID) {
              if (sessionID !== "ses_test") return []
              return [{ content: "ship it", status: "pending" }]
            },
          },
          lsp() {
            return [{ id: "ts", root: "/tmp/project", status: "connected" }]
          },
          mcp() {
            return [{ name: "github", status: "connected" }]
          },
        },
        theme: {
          has(name) {
            return allThemes()[name] !== undefined
          },
        },
      }),
    )
    const local = await row(tmp.extra.localMarker)
    const global = await row(tmp.extra.globalMarker)
    const invalid = await row(tmp.extra.invalidMarker)
    const preloaded = await row(tmp.extra.preloadedMarker)
    const fn_called = await fs
      .readFile(tmp.extra.fnMarker, "utf8")
      .then(() => true)
      .catch(() => false)
    const local_installed = await fs.readFile(tmp.extra.localDest, "utf8")
    const global_installed = await fs.readFile(tmp.extra.globalDest, "utf8")
    const preloaded_installed = await fs.readFile(tmp.extra.preloadedDest, "utf8")
    const leaked_local_to_global = await fs
      .stat(path.join(Global.Path.config, "themes", tmp.extra.localThemeFile))
      .then(() => true)
      .catch(() => false)
    const leaked_global_to_local = await fs
      .stat(path.join(tmp.path, ".opencode", "themes", tmp.extra.globalThemeFile))
      .then(() => true)
      .catch(() => false)

    return {
      local,
      global,
      invalid,
      preloaded,
      fn_called,
      local_installed,
      global_installed,
      preloaded_installed,
      leaked_local_to_global,
      leaked_global_to_local,
      local_theme: tmp.extra.localThemeName,
      global_theme: tmp.extra.globalThemeName,
    }
  } finally {
    await TuiPluginRuntime.dispose()
    cwd.mockRestore()
    wait.mockRestore()
    install.mockRestore()
    if (backup === undefined) {
      await fs.rm(globalConfigPath, { force: true })
    } else {
      await Bun.write(globalConfigPath, backup)
    }
    await fs.rm(tmp.extra.globalDest, { force: true }).catch(() => {})
  }
}

test("continues loading when a plugin is missing config metadata", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      const bad = path.join(dir, "missing-meta-plugin.ts")
      const good = path.join(dir, "next-plugin.ts")
      const bare = path.join(dir, "plain-plugin.ts")
      const badSpec = pathToFileURL(bad).href
      const goodSpec = pathToFileURL(good).href
      const bareSpec = pathToFileURL(bare).href
      const goodMarker = path.join(dir, "next-called.txt")
      const bareMarker = path.join(dir, "plain-called.txt")

      for (const [file, id] of [
        [bad, "demo.missing-meta"],
        [good, "demo.next"],
      ] as const) {
        await Bun.write(
          file,
          `export default {
  id: "${id}",
  tui: async (_api, options) => {
    if (!options?.marker) return
    await Bun.write(options.marker, "called")
  },
}
`,
        )
      }

      await Bun.write(
        bare,
        `export default {
  id: "demo.plain",
  tui: async (_api, options) => {
    await Bun.write(${JSON.stringify(bareMarker)}, options === undefined ? "undefined" : "value")
  },
}
`,
      )

      return { badSpec, goodSpec, bareSpec, goodMarker, bareMarker }
    },
  })

  process.env.OPENCODE_PLUGIN_META_FILE = path.join(tmp.path, "plugin-meta.json")
  const get = spyOn(TuiConfig, "get").mockResolvedValue({
    plugin: [
      [tmp.extra.badSpec, { marker: path.join(tmp.path, "bad.txt") }],
      [tmp.extra.goodSpec, { marker: tmp.extra.goodMarker }],
      tmp.extra.bareSpec,
    ],
    plugin_meta: {
      [tmp.extra.goodSpec]: { scope: "local", source: path.join(tmp.path, "tui.json") },
      [tmp.extra.bareSpec]: { scope: "local", source: path.join(tmp.path, "tui.json") },
    },
  })
  const wait = spyOn(TuiConfig, "waitForDependencies").mockResolvedValue()
  const cwd = spyOn(process, "cwd").mockImplementation(() => tmp.path)

  try {
    await TuiPluginRuntime.init(createTuiPluginApi())
    // bad plugin was skipped (no metadata entry)
    await expect(fs.readFile(path.join(tmp.path, "bad.txt"), "utf8")).rejects.toThrow()
    // good plugin loaded fine
    await expect(fs.readFile(tmp.extra.goodMarker, "utf8")).resolves.toBe("called")
    // bare string spec gets undefined options
    await expect(fs.readFile(tmp.extra.bareMarker, "utf8")).resolves.toBe("undefined")
  } finally {
    await TuiPluginRuntime.dispose()
    cwd.mockRestore()
    get.mockRestore()
    wait.mockRestore()
    delete process.env.OPENCODE_PLUGIN_META_FILE
  }
})

describe("tui.plugin.loader", () => {
  let data: Data

  beforeAll(async () => {
    data = await load()
  })

  test("passes keybind, kv, state, and dialog APIs to v1 plugins", () => {
    expect(data.local.key_modal).toBe("ctrl+alt+m")
    expect(data.local.key_close).toBe("q")
    expect(data.local.key_unknown).toBe("ctrl+k")
    expect(data.local.key_print).toBe("print:ctrl+alt+m")
    expect(data.local.kv_before).toBe("missing")
    expect(data.local.kv_after).toBe("stored")
    expect(data.local.kv_ready).toBe(true)
    expect(data.local.diff_count).toBe(1)
    expect(data.local.diff_file).toBe("src/app.ts")
    expect(data.local.todo_count).toBe(1)
    expect(data.local.todo_first).toBe("ship it")
    expect(data.local.lsp_count).toBe(1)
    expect(data.local.mcp_count).toBe(1)
    expect(data.local.mcp_first).toBe("github")
    expect(data.local.depth_before).toBe(0)
    expect(data.local.open_before).toBe(false)
    expect(data.local.size_before).toBe("medium")
    expect(data.local.size_after).toBe("large")
    expect(data.local.depth_after).toBe(1)
    expect(data.local.open_after).toBe(true)
    expect(data.local.open_clear).toBe(false)
    expect(data.local.cfg_theme).toBe("smoke")
    expect(data.local.cfg_diff).toBe("stacked")
    expect(data.local.cfg_speed).toBe(1.5)
    expect(data.local.cfg_accel).toBe(true)
    expect(data.local.cfg_submit).toBe("ctrl+enter")
  })

  test("installs themes in the correct scope and remains resilient", () => {
    expect(data.local.before).toBe(false)
    expect(data.local.set_missing).toBe(false)
    expect(data.local.after).toBe(true)
    expect(data.local.set_installed).toBe(true)
    expect(data.local.selected).toBe(data.local_theme)
    expect(data.local.same).toBe(true)

    expect(data.global.has).toBe(true)
    expect(data.global.set_installed).toBe(true)
    expect(data.global.selected).toBe(data.global_theme)

    expect(data.invalid.before).toBe(false)
    expect(data.invalid.set_missing).toBe(false)
    expect(data.invalid.after).toBe(false)
    expect(data.invalid.set_installed).toBe(false)

    expect(data.preloaded.before).toBe(true)
    expect(data.preloaded.after).toBe(true)
    expect(data.preloaded.text).toContain("#303030")
    expect(data.preloaded.text).not.toContain("#f0f0f0")

    expect(data.fn_called).toBe(false)
    expect(data.local_installed).toContain("#101010")
    expect(data.local_installed).not.toContain("#fefefe")
    expect(data.global_installed).toContain("#202020")
    expect(data.preloaded_installed).toContain("#303030")
    expect(data.preloaded_installed).not.toContain("#f0f0f0")
    expect(data.leaked_local_to_global).toBe(false)
    expect(data.leaked_global_to_local).toBe(false)
  })
})

test("updates installed theme when plugin metadata changes", async () => {
  await using tmp = await tmpdir<{
    spec: string
    pluginPath: string
    themePath: string
    dest: string
    themeName: string
  }>({
    init: async (dir) => {
      const pluginPath = path.join(dir, "theme-update-plugin.ts")
      const spec = pathToFileURL(pluginPath).href
      const themeFile = "theme-update.json"
      const themePath = path.join(dir, themeFile)
      const dest = path.join(dir, ".opencode", "themes", themeFile)
      const themeName = themeFile.replace(/\.json$/, "")
      const configPath = path.join(dir, "tui.json")

      await Bun.write(themePath, JSON.stringify({ theme: { primary: "#111111" } }, null, 2))
      await Bun.write(
        pluginPath,
        `export default {
  id: "demo.theme-update",
  tui: async (api, options) => {
    if (!options?.theme_path) return
    await api.theme.install(options.theme_path)
  },
}
`,
      )
      await Bun.write(
        configPath,
        JSON.stringify(
          {
            plugin: [[spec, { theme_path: `./${themeFile}` }]],
          },
          null,
          2,
        ),
      )

      return {
        spec,
        pluginPath,
        themePath,
        dest,
        themeName,
      }
    },
  })

  process.env.OPENCODE_PLUGIN_META_FILE = path.join(tmp.path, "plugin-meta.json")
  const cwd = spyOn(process, "cwd").mockImplementation(() => tmp.path)
  const wait = spyOn(TuiConfig, "waitForDependencies").mockResolvedValue()
  const install = spyOn(Config, "installDependencies").mockResolvedValue()

  const api = () =>
    createTuiPluginApi({
      theme: {
        has(name) {
          return allThemes()[name] !== undefined
        },
      },
    })

  try {
    await TuiPluginRuntime.init(api())
    await TuiPluginRuntime.dispose()
    await expect(fs.readFile(tmp.extra.dest, "utf8")).resolves.toContain("#111111")

    await Bun.write(tmp.extra.themePath, JSON.stringify({ theme: { primary: "#222222" } }, null, 2))
    await Bun.write(
      tmp.extra.pluginPath,
      `export default {
  id: "demo.theme-update",
  tui: async (api, options) => {
    if (!options?.theme_path) return
    await api.theme.install(options.theme_path)
  },
}
// v2
`,
    )
    const stamp = new Date(Date.now() + 10_000)
    await fs.utimes(tmp.extra.pluginPath, stamp, stamp)
    await fs.utimes(tmp.extra.themePath, stamp, stamp)

    await TuiPluginRuntime.init(api())
    const text = await fs.readFile(tmp.extra.dest, "utf8")
    expect(text).toContain("#222222")
    expect(text).not.toContain("#111111")
    const list = await Filesystem.readJson<Record<string, { themes?: Record<string, { dest: string }> }>>(
      process.env.OPENCODE_PLUGIN_META_FILE!,
    )
    expect(list["demo.theme-update"]?.themes?.[tmp.extra.themeName]?.dest).toBe(tmp.extra.dest)
  } finally {
    await TuiPluginRuntime.dispose()
    cwd.mockRestore()
    wait.mockRestore()
    install.mockRestore()
    delete process.env.OPENCODE_PLUGIN_META_FILE
  }
})
