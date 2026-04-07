import { expect, spyOn, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { pathToFileURL } from "url"
import { tmpdir } from "../../fixture/fixture"
import { createTuiPluginApi } from "../../fixture/tui-plugin"
import { mockTuiRuntime } from "../../fixture/tui-runtime"
import { TuiConfig } from "../../../src/config/tui"

const { TuiPluginRuntime } = await import("../../../src/cli/cmd/tui/plugin/runtime")

test("runs onDispose callbacks with aborted signal and is idempotent", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      const file = path.join(dir, "plugin.ts")
      const spec = pathToFileURL(file).href
      const marker = path.join(dir, "marker.txt")

      await Bun.write(
        file,
        `export default {
  id: "demo.lifecycle",
  tui: async (api, options) => {
    api.event.on("event.test", () => {})
    api.route.register([{ name: "lifecycle.route", render: () => null }])
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

      return { spec, marker }
    },
  })

  const restore = mockTuiRuntime(tmp.path, [[tmp.extra.spec, { marker: tmp.extra.marker }]])

  try {
    await TuiPluginRuntime.init(createTuiPluginApi())
    await TuiPluginRuntime.dispose()

    const marker = await fs.readFile(tmp.extra.marker, "utf8")
    expect(marker).toContain("custom")
    expect(marker).toContain("aborted:true")

    // second dispose is a no-op
    await TuiPluginRuntime.dispose()
    const after = await fs.readFile(tmp.extra.marker, "utf8")
    expect(after).toBe(marker)
  } finally {
    await TuiPluginRuntime.dispose()
    restore()
  }
})

test("rolls back failed plugin and continues loading next", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      const bad = path.join(dir, "bad-plugin.ts")
      const good = path.join(dir, "good-plugin.ts")
      const badSpec = pathToFileURL(bad).href
      const goodSpec = pathToFileURL(good).href
      const badMarker = path.join(dir, "bad-cleanup.txt")
      const goodMarker = path.join(dir, "good-called.txt")

      await Bun.write(
        bad,
        `export default {
  id: "demo.bad",
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
        good,
        `export default {
  id: "demo.good",
  tui: async (_api, options) => {
    await Bun.write(options.good_marker, "called")
  },
}
`,
      )

      return { badSpec, goodSpec, badMarker, goodMarker }
    },
  })

  const restore = mockTuiRuntime(tmp.path, [
    [tmp.extra.badSpec, { bad_marker: tmp.extra.badMarker }],
    [tmp.extra.goodSpec, { good_marker: tmp.extra.goodMarker }],
  ])

  try {
    await TuiPluginRuntime.init(createTuiPluginApi())
    // bad plugin's onDispose ran during rollback
    await expect(fs.readFile(tmp.extra.badMarker, "utf8")).resolves.toBe("cleaned")
    // good plugin still loaded
    await expect(fs.readFile(tmp.extra.goodMarker, "utf8")).resolves.toBe("called")
  } finally {
    await TuiPluginRuntime.dispose()
    restore()
  }
})

test("assigns sequential slot ids scoped to plugin", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      const file = path.join(dir, "slot-plugin.ts")
      const spec = pathToFileURL(file).href
      const marker = path.join(dir, "slot-setup.txt")

      await Bun.write(
        file,
        `import fs from "fs"

const mark = (label) => {
  fs.appendFileSync(${JSON.stringify(marker)}, label + "\\n")
}

export default {
  id: "demo.slot",
  tui: async (api) => {
    const one = api.slots.register({
      id: 1,
      setup: () => { mark("one") },
      slots: { home_logo() { return null } },
    })
    const two = api.slots.register({
      id: 2,
      setup: () => { mark("two") },
      slots: { home_bottom() { return null } },
    })
    mark("id:" + one)
    mark("id:" + two)
  },
}
`,
      )

      return { spec, marker }
    },
  })

  const restore = mockTuiRuntime(tmp.path, [tmp.extra.spec])
  const err = spyOn(console, "error").mockImplementation(() => {})

  try {
    await TuiPluginRuntime.init(createTuiPluginApi())

    const marker = await fs.readFile(tmp.extra.marker, "utf8")
    expect(marker).toContain("one")
    expect(marker).toContain("two")
    expect(marker).toContain("id:demo.slot")
    expect(marker).toContain("id:demo.slot:1")

    // no initialization failures
    const hit = err.mock.calls.find(
      (item) => typeof item[0] === "string" && item[0].includes("failed to initialize tui plugin"),
    )
    expect(hit).toBeUndefined()
  } finally {
    await TuiPluginRuntime.dispose()
    err.mockRestore()
    restore()
  }
})

test(
  "times out hanging plugin cleanup on dispose",
  async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const file = path.join(dir, "timeout-plugin.ts")
        const spec = pathToFileURL(file).href

        await Bun.write(
          file,
          `export default {
  id: "demo.timeout",
  tui: async (api) => {
    api.lifecycle.onDispose(() => new Promise(() => {}))
  },
}
`,
        )

        return { spec }
      },
    })

    const restore = mockTuiRuntime(tmp.path, [tmp.extra.spec])

    try {
      await TuiPluginRuntime.init(createTuiPluginApi())

      const done = await new Promise<string>((resolve) => {
        const timer = setTimeout(() => resolve("timeout"), 7000)
        TuiPluginRuntime.dispose().then(() => {
          clearTimeout(timer)
          resolve("done")
        })
      })
      expect(done).toBe("done")
    } finally {
      await TuiPluginRuntime.dispose()
      restore()
    }
  },
  { timeout: 15000 },
)
