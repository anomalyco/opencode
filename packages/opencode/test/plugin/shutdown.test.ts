import { describe, expect, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Plugin } from "../../src/plugin"

describe("plugin.shutdown", () => {
  test("shutdown hook is called on instance dispose", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const pluginDir = path.join(dir, ".opencode", "plugin")
        await fs.mkdir(pluginDir, { recursive: true })

        // Write a plugin that creates a marker file when shutdown is called
        const marker = path.join(dir, "shutdown-called")
        await Bun.write(
          path.join(pluginDir, "shutdown-test.ts"),
          [
            `import fs from "fs"`,
            `export default async () => ({`,
            `  async shutdown() {`,
            `    fs.writeFileSync(${JSON.stringify(marker)}, "shutdown")`,
            `  },`,
            `})`,
            ``,
          ].join("\n"),
        )
        return { marker }
      },
    })

    const marker = tmp.extra.marker

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // Initialize plugins so the state is populated (and dispose callback registered)
        const hooks = await Plugin.list()
        expect(hooks.length).toBeGreaterThan(0)
        expect(hooks.some((h) => typeof h.shutdown === "function")).toBe(true)

        // Verify marker doesn't exist yet
        const existsBefore = await fs
          .stat(marker)
          .then(() => true)
          .catch(() => false)
        expect(existsBefore).toBe(false)

        // Trigger dispose — this should call shutdown hooks
        await Instance.dispose()

        // Verify the shutdown hook wrote the marker file
        const contents = await fs.readFile(marker, "utf-8")
        expect(contents).toBe("shutdown")
      },
    })
  }, 30000)

  test("shutdown hook errors do not prevent other hooks from running", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const pluginDir = path.join(dir, ".opencode", "plugin")
        await fs.mkdir(pluginDir, { recursive: true })

        const marker1 = path.join(dir, "first-shutdown-called")
        const marker2 = path.join(dir, "second-shutdown-called")

        // Plugin aaa loads first (alphabetical), writes marker, then throws
        await Bun.write(
          path.join(pluginDir, "aaa-shutdown-error.ts"),
          [
            `import fs from "fs"`,
            `export default async () => ({`,
            `  async shutdown() {`,
            `    fs.writeFileSync(${JSON.stringify(marker1)}, "first")`,
            `    throw new Error("shutdown failed on purpose")`,
            `  },`,
            `})`,
            ``,
          ].join("\n"),
        )

        // Plugin zzz loads second (alphabetical), writes marker
        await Bun.write(
          path.join(pluginDir, "zzz-shutdown-ok.ts"),
          [
            `import fs from "fs"`,
            `export default async () => ({`,
            `  async shutdown() {`,
            `    fs.writeFileSync(${JSON.stringify(marker2)}, "second")`,
            `  },`,
            `})`,
            ``,
          ].join("\n"),
        )

        return { marker1, marker2 }
      },
    })

    const { marker1, marker2 } = tmp.extra

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // Initialize plugins
        const hooks = await Plugin.list()
        expect(hooks.length).toBeGreaterThan(0)

        // Trigger dispose
        await Instance.dispose()

        // The first hook ran (wrote its marker before throwing)
        const first = await fs.readFile(marker1, "utf-8")
        expect(first).toBe("first")

        // The second hook should also have run despite the first throwing
        const second = await fs.readFile(marker2, "utf-8")
        expect(second).toBe("second")
      },
    })
  }, 30000)
})
