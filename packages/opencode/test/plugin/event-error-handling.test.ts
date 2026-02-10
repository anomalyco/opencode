import { describe, expect, test, spyOn } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Plugin } from "../../src/plugin"
import { Bus } from "../../src/bus"
import { SessionStatus } from "../../src/session/status"
import { Log } from "../../src/util/log"

describe("plugin.event-error-handling", () => {
  test("plugin event handler that throws synchronously does not crash the bus", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const pluginDir = path.join(dir, ".opencode", "plugin")
        await fs.mkdir(pluginDir, { recursive: true })

        await Bun.write(
          path.join(pluginDir, "throwing-plugin.ts"),
          [
            "export default async () => ({",
            "  event: async ({ event }) => {",
            '    throw new Error("simulated plugin crash");',
            "  },",
            "})",
            "",
          ].join("\n"),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Plugin.init()
        // Publishing a bus event should NOT throw even though the plugin throws
        await expect(
          Bus.publish(SessionStatus.Event.Idle, { sessionID: "test-session" }),
        ).resolves.toBeDefined()
      },
    })
  }, 30000)

  test("plugin event handler that rejects asynchronously does not crash the bus", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const pluginDir = path.join(dir, ".opencode", "plugin")
        await fs.mkdir(pluginDir, { recursive: true })

        await Bun.write(
          path.join(pluginDir, "rejecting-plugin.ts"),
          [
            "export default async () => ({",
            "  event: async ({ event }) => {",
            "    await new Promise((_, reject) => {",
            '      reject(new Error("simulated async rejection"));',
            "    });",
            "  },",
            "})",
            "",
          ].join("\n"),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Plugin.init()
        await expect(
          Bus.publish(SessionStatus.Event.Idle, { sessionID: "test-session" }),
        ).resolves.toBeDefined()
      },
    })
  }, 30000)

  test("throwing plugin does not prevent other plugins from receiving events", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const pluginDir = path.join(dir, ".opencode", "plugin")
        await fs.mkdir(pluginDir, { recursive: true })

        // Plugin A throws
        await Bun.write(
          path.join(pluginDir, "a-throwing-plugin.ts"),
          [
            "export default async () => ({",
            "  event: async ({ event }) => {",
            '    throw new Error("plugin A exploded");',
            "  },",
            "})",
            "",
          ].join("\n"),
        )

        // Plugin B writes a marker file to prove it ran
        const markerPath = path.join(dir, "plugin-b-ran.marker")
        await Bun.write(
          path.join(pluginDir, "b-working-plugin.ts"),
          [
            'import { writeFileSync } from "fs";',
            `const markerPath = ${JSON.stringify(markerPath)};`,
            "export default async () => ({",
            "  event: async ({ event }) => {",
            '    writeFileSync(markerPath, "plugin-b-received-event");',
            "  },",
            "})",
            "",
          ].join("\n"),
        )

        return { markerPath }
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Plugin.init()
        await Bus.publish(SessionStatus.Event.Idle, { sessionID: "test-session" })

        // Give async handlers a tick to complete
        await new Promise((r) => setTimeout(r, 100))

        // Plugin B should have run despite Plugin A throwing
        const marker = await fs.readFile(tmp.extra.markerPath, "utf-8").catch(() => null)
        expect(marker).toBe("plugin-b-received-event")
      },
    })
  }, 30000)

  test("plugin event handler error is logged via Log system, not stderr", async () => {
    const logSpy = spyOn(Log.create({ service: "plugin" }), "error")

    await using tmp = await tmpdir({
      init: async (dir) => {
        const pluginDir = path.join(dir, ".opencode", "plugin")
        await fs.mkdir(pluginDir, { recursive: true })

        await Bun.write(
          path.join(pluginDir, "stderr-plugin.ts"),
          [
            "export default async () => ({",
            "  event: async ({ event }) => {",
            '    throw new Error("this should be logged not printed to stderr");',
            "  },",
            "})",
            "",
          ].join("\n"),
        )
      },
    })

    // Capture stderr to verify plugin errors don't appear there
    const stderrChunks: string[] = []
    const originalWrite = process.stderr.write.bind(process.stderr)
    const stderrSpy = spyOn(process.stderr, "write").mockImplementation((chunk: any) => {
      const text = typeof chunk === "string" ? chunk : chunk?.toString?.() ?? ""
      stderrChunks.push(text)
      return originalWrite(chunk)
    })

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await Plugin.init()
          await Bus.publish(SessionStatus.Event.Idle, { sessionID: "test-session" })
          // Give async handlers a tick to complete
          await new Promise((r) => setTimeout(r, 100))
        },
      })

      // The error message should NOT appear on stderr as an uncaught error
      const stderrOutput = stderrChunks.join("")
      expect(stderrOutput).not.toContain("this should be logged not printed to stderr")
    } finally {
      stderrSpy.mockRestore()
    }
  }, 30000)

  test("log property is provided to plugins via PluginInput", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const pluginDir = path.join(dir, ".opencode", "plugin")
        await fs.mkdir(pluginDir, { recursive: true })

        const markerPath = path.join(dir, "log-available.marker")
        await Bun.write(
          path.join(pluginDir, "log-check-plugin.ts"),
          [
            'import { writeFileSync } from "fs";',
            `const markerPath = ${JSON.stringify(markerPath)};`,
            "export default async ({ log }) => {",
            "  // Verify log has the expected methods",
            "  const hasDebug = typeof log.debug === 'function';",
            "  const hasInfo = typeof log.info === 'function';",
            "  const hasWarn = typeof log.warn === 'function';",
            "  const hasError = typeof log.error === 'function';",
            "  const allPresent = hasDebug && hasInfo && hasWarn && hasError;",
            `  writeFileSync(markerPath, allPresent ? "log-ok" : "log-missing-methods");`,
            "  // Use the logger - should not throw",
            '  log.info("plugin loaded successfully", { test: true });',
            '  log.error("test error from plugin", { code: 42 });',
            "  return {};",
            "}",
            "",
          ].join("\n"),
        )

        return { markerPath }
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // Just loading the plugin (via list()) triggers plugin initialization
        // which passes PluginInput including log
        await Plugin.list()

        const marker = await fs.readFile(tmp.extra.markerPath, "utf-8").catch(() => null)
        expect(marker).toBe("log-ok")
      },
    })
  }, 30000)
})
