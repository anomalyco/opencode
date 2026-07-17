import { afterEach, expect } from "bun:test"
import { existsSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { Effect } from "effect"
import { disposeAllInstances } from "../fixture/fixture"
import { cliIt } from "../lib/cli-process"

afterEach(async () => {
  await disposeAllInstances()
})

cliIt.live(
  "session list does not run InstanceBootstrap plugins",
  ({ opencode, home }) =>
    Effect.gen(function* () {
      const marker = path.join(home, "bootstrap-marker")
      const plugin = path.join(home, "bootstrap-plugin.ts")
      yield* Effect.promise(() =>
        Bun.write(
          plugin,
          [
            `const MARKER = ${JSON.stringify(marker)}`,
            "export default async () => ({",
            "  config: async () => {",
            '    await Bun.write(MARKER, "ran")',
            "  },",
            "})",
            "",
          ].join("\n"),
        ),
      )

      const config = {
        $schema: "https://opencode.ai/config.json",
        plugin: [pathToFileURL(plugin).href],
      }

      const listed = yield* opencode.spawn(["session", "list"], {
        env: {
          OPENCODE_CONFIG_CONTENT: JSON.stringify(config),
          OPENCODE_PURE: "0",
        },
        timeoutMs: 15_000,
      })
      opencode.expectExit(listed, 0, "session list")
      expect(existsSync(marker)).toBe(false)

      const agents = yield* opencode.spawn(["agent", "list"], {
        env: {
          OPENCODE_CONFIG_CONTENT: JSON.stringify(config),
          OPENCODE_PURE: "0",
        },
        timeoutMs: 60_000,
      })
      opencode.expectExit(agents, 0, "agent list")
      expect(existsSync(marker)).toBe(true)
    }),
  90_000,
)
