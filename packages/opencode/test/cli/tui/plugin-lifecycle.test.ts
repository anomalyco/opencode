import { expect, spyOn, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { pathToFileURL } from "url"
import { tmpdir } from "../../fixture/fixture"
import { createTuiPluginApi } from "../../fixture/tui-plugin"
import { TuiConfig } from "../../../src/config/tui"

const { TuiPluginRuntime } = await import("../../../src/cli/cmd/tui/plugin/runtime")

type Count = {
  event_add: number
  event_drop: number
  route_add: number
  route_drop: number
  command_add: number
  command_drop: number
}

test("disposes tracked event, route, and command hooks", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      const pluginPath = path.join(dir, "lifecycle-plugin.ts")
      const pluginSpec = pathToFileURL(pluginPath).href
      const marker = path.join(dir, "dispose-marker.txt")

      await Bun.write(
        pluginPath,
        `export default {
  tui: async (api, options) => {
    api.event.on("event.test", () => {})
    api.route.register([{ name: "lifecycle.route", render: () => null }])
    const off = api.command.register(() => [])
    off()
    api.lifecycle.onDispose(async () => {
      const prev = await Bun.file(options.marker).text().catch(() => "")
      await Bun.write(options.marker, prev + "custom\\n")
    })
    api.lifecycle.onDispose(async () => {
      const prev = await Bun.file(options.marker).text().catch(() => "")
      await Bun.write(options.marker, prev + "aborted:" + String(api.lifecycle.signal.aborted) + "\\n")
    })
  },
}
`,
      )

      return {
        marker,
        pluginSpec,
      }
    },
  })

  const count: Count = {
    event_add: 0,
    event_drop: 0,
    route_add: 0,
    route_drop: 0,
    command_add: 0,
    command_drop: 0,
  }
  process.env.OPENCODE_PLUGIN_META_FILE = path.join(tmp.path, "plugin-meta.json")
  const name = path.parse(new URL(tmp.extra.pluginSpec).pathname).name
  const get = spyOn(TuiConfig, "get").mockResolvedValue({
    plugin: [[tmp.extra.pluginSpec, { marker: tmp.extra.marker }]],
    plugin_meta: {
      [name]: {
        scope: "local",
        source: path.join(tmp.path, "tui.json"),
      },
    },
  })
  const wait = spyOn(TuiConfig, "waitForDependencies").mockResolvedValue()
  const cwd = spyOn(process, "cwd").mockImplementation(() => tmp.path)

  try {
    await TuiPluginRuntime.init(createTuiPluginApi({ count }))

    expect(count.event_add).toBe(1)
    expect(count.event_drop).toBe(0)
    expect(count.route_add).toBe(1)
    expect(count.route_drop).toBe(0)
    expect(count.command_add).toBe(2)
    expect(count.command_drop).toBe(1)

    await TuiPluginRuntime.dispose()

    expect(count.event_drop).toBe(1)
    expect(count.route_drop).toBe(1)
    expect(count.command_drop).toBe(2)

    await TuiPluginRuntime.dispose()

    expect(count.event_drop).toBe(1)
    expect(count.route_drop).toBe(1)
    expect(count.command_drop).toBe(2)

    const marker = await fs.readFile(tmp.extra.marker, "utf8")
    expect(marker).toContain("custom")
    expect(marker).toContain("aborted:true")
  } finally {
    await TuiPluginRuntime.dispose()
    cwd.mockRestore()
    get.mockRestore()
    wait.mockRestore()
    delete process.env.OPENCODE_PLUGIN_META_FILE
  }
})

test("rolls back failed plugin exports and continues loading", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      const badPath = path.join(dir, "bad-plugin.ts")
      const badSpec = pathToFileURL(badPath).href
      const goodPath = path.join(dir, "good-plugin.ts")
      const goodSpec = pathToFileURL(goodPath).href
      const badMarker = path.join(dir, "bad-cleanup.txt")
      const goodMarker = path.join(dir, "good-called.txt")

      await Bun.write(
        badPath,
        `export default {
  tui: async (api, options) => {
    api.route.register([{ name: "bad.route", render: () => null }])
    api.lifecycle.onDispose(async () => {
      await Bun.write(options.bad_marker, "cleaned")
    })
    throw new Error("bad plugin")
  },
}
`,
      )

      await Bun.write(
        goodPath,
        `export default {
  tui: async (_api, options) => {
    await Bun.write(options.good_marker, "called")
  },
}
`,
      )

      return {
        badSpec,
        goodSpec,
        badMarker,
        goodMarker,
      }
    },
  })

  const count: Count = {
    event_add: 0,
    event_drop: 0,
    route_add: 0,
    route_drop: 0,
    command_add: 0,
    command_drop: 0,
  }
  process.env.OPENCODE_PLUGIN_META_FILE = path.join(tmp.path, "plugin-meta.json")
  const badName = path.parse(new URL(tmp.extra.badSpec).pathname).name
  const goodName = path.parse(new URL(tmp.extra.goodSpec).pathname).name
  const get = spyOn(TuiConfig, "get").mockResolvedValue({
    plugin: [
      [tmp.extra.badSpec, { bad_marker: tmp.extra.badMarker }],
      [tmp.extra.goodSpec, { good_marker: tmp.extra.goodMarker }],
    ],
    plugin_meta: {
      [badName]: {
        scope: "local",
        source: path.join(tmp.path, "tui.json"),
      },
      [goodName]: {
        scope: "local",
        source: path.join(tmp.path, "tui.json"),
      },
    },
  })
  const wait = spyOn(TuiConfig, "waitForDependencies").mockResolvedValue()
  const cwd = spyOn(process, "cwd").mockImplementation(() => tmp.path)

  try {
    await TuiPluginRuntime.init(createTuiPluginApi({ count }))

    await expect(fs.readFile(tmp.extra.badMarker, "utf8")).resolves.toBe("cleaned")
    await expect(fs.readFile(tmp.extra.goodMarker, "utf8")).resolves.toBe("called")
    expect(count.route_add).toBe(1)
    expect(count.route_drop).toBe(1)
  } finally {
    await TuiPluginRuntime.dispose()
    cwd.mockRestore()
    get.mockRestore()
    wait.mockRestore()
    delete process.env.OPENCODE_PLUGIN_META_FILE
  }
})

test("registers slots via api and ignores manual slot plugin id", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      const pluginPath = path.join(dir, "slot-plugin.ts")
      const pluginSpec = pathToFileURL(pluginPath).href
      const marker = path.join(dir, "slot-setup.txt")

      await Bun.write(
        pluginPath,
        `import fs from "fs"

const mark = (label) => {
  fs.appendFileSync(${JSON.stringify(marker)}, label + "\\n")
}

export default {
  tui: async (api) => {
    const one = api.slots.register({
      id: 1,
      setup: () => {
        mark("one")
      },
      slots: {
        home_logo() {
          return null
        },
      },
    })
    const two = api.slots.register({
      id: 2,
      setup: () => {
        mark("two")
      },
      slots: {
        home_bottom() {
          return null
        },
      },
    })
    mark("id:" + one)
    mark("id:" + two)
  },
}
`,
      )

      return {
        pluginSpec,
        marker,
      }
    },
  })

  process.env.OPENCODE_PLUGIN_META_FILE = path.join(tmp.path, "plugin-meta.json")
  const name = path.parse(new URL(tmp.extra.pluginSpec).pathname).name
  const get = spyOn(TuiConfig, "get").mockResolvedValue({
    plugin: [tmp.extra.pluginSpec],
    plugin_meta: {
      [name]: {
        scope: "local",
        source: path.join(tmp.path, "tui.json"),
      },
    },
  })
  const wait = spyOn(TuiConfig, "waitForDependencies").mockResolvedValue()
  const cwd = spyOn(process, "cwd").mockImplementation(() => tmp.path)
  const err = spyOn(console, "error").mockImplementation(() => {})

  try {
    await TuiPluginRuntime.init(createTuiPluginApi())

    const marker = await fs.readFile(tmp.extra.marker, "utf8")
    expect(marker).toContain("one")
    expect(marker).toContain("two")
    expect(marker).toContain(`id:${name}`)
    expect(marker).toContain(`id:${name}:1`)

    const hit = err.mock.calls.find(
      (item) => typeof item[0] === "string" && item[0].includes("failed to initialize tui plugin export"),
    )
    expect(hit).toBeUndefined()
  } finally {
    await TuiPluginRuntime.dispose()
    err.mockRestore()
    cwd.mockRestore()
    get.mockRestore()
    wait.mockRestore()
    delete process.env.OPENCODE_PLUGIN_META_FILE
  }
})

test(
  "times out hanging plugin cleanup on dispose",
  async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const pluginPath = path.join(dir, "timeout-plugin.ts")
        const pluginSpec = pathToFileURL(pluginPath).href

        await Bun.write(
          pluginPath,
          `export default {
  tui: async (api) => {
    api.lifecycle.onDispose(() => new Promise(() => {}))
  },
}
`,
        )

        return {
          pluginSpec,
        }
      },
    })

    const count: Count = {
      event_add: 0,
      event_drop: 0,
      route_add: 0,
      route_drop: 0,
      command_add: 0,
      command_drop: 0,
    }
    process.env.OPENCODE_PLUGIN_META_FILE = path.join(tmp.path, "plugin-meta.json")
    const name = path.parse(new URL(tmp.extra.pluginSpec).pathname).name
    const get = spyOn(TuiConfig, "get").mockResolvedValue({
      plugin: [tmp.extra.pluginSpec],
      plugin_meta: {
        [name]: {
          scope: "local",
          source: path.join(tmp.path, "tui.json"),
        },
      },
    })
    const wait = spyOn(TuiConfig, "waitForDependencies").mockResolvedValue()
    const cwd = spyOn(process, "cwd").mockImplementation(() => tmp.path)

    try {
      await TuiPluginRuntime.init(createTuiPluginApi({ count }))

      const done = await new Promise<string>((resolve) => {
        const timer = setTimeout(() => {
          resolve("timeout")
        }, 7000)
        TuiPluginRuntime.dispose().then(() => {
          clearTimeout(timer)
          resolve("done")
        })
      })
      expect(done).toBe("done")
    } finally {
      await TuiPluginRuntime.dispose()
      cwd.mockRestore()
      get.mockRestore()
      wait.mockRestore()
      delete process.env.OPENCODE_PLUGIN_META_FILE
    }
  },
  { timeout: 15000 },
)
