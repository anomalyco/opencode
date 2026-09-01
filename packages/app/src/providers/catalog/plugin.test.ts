import { describe, expect, test } from "bun:test"
import type { PluginInfo } from "@opencode-ai/client"
import { pluginLabels } from "./plugin"

describe("pluginLabels", () => {
  test("omits built-in plugins", () => {
    const plugins: PluginInfo[] = [
      { id: "opencode.internal", source: { type: "builtin" }, state: { status: "active" }, features: { server: true } },
      {
        id: "package-plugin",
        source: { type: "package", target: "example" },
        state: { status: "active" },
        features: { server: true },
      },
      {
        id: "local-plugin",
        source: { type: "local", path: "/tmp/plugin.ts" },
        state: { status: "active" },
        features: { server: true },
      },
      { id: "sdk-plugin", source: { type: "sdk" }, state: { status: "active" }, features: { server: true } },
    ]

    expect(pluginLabels(plugins)).toEqual(["package-plugin", "local-plugin", "sdk-plugin"])
  })
})
