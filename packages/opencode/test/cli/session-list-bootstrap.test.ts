import { afterEach, expect } from "bun:test"
import { existsSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Effect } from "effect"
import { fileURLToPath } from "url"
import { disposeAllInstances } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { cliIt } from "../lib/cli-process"

const it = testEffect(LayerNode.compile(FSUtil.node))

afterEach(async () => {
  await disposeAllInstances()
})

it.live("session list skips InstanceBootstrap in source", () =>
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const source = yield* fs.readFileString(fileURLToPath(new URL("../../src/cli/cmd/session.ts", import.meta.url)))
    const list = source.slice(source.indexOf("SessionListCommand"), source.indexOf("formatSessionTable"))
    expect(list).toContain("instance: false")
    expect(list).toContain("fromDirectory")
    expect(list).toContain("projectID")
  }),
)

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
