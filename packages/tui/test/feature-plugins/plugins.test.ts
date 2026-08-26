import type { PluginInfo, PluginUpdateInfo } from "@opencode-ai/client"
import { describe, expect, test } from "bun:test"
import { matchesPluginUpdate, pluginServerKey } from "../../src/feature-plugins/system/plugins-model"

const builtin = (id: string): PluginInfo => ({ id, source: { type: "builtin" }, status: "active", tui: false })

describe("plugin update row identity", () => {
  test("does not join unrelated built-in plugins by source type", () => {
    const update: PluginUpdateInfo = {
      name: "fixture.second",
      source: { type: "builtin" },
      status: "not-updateable",
    }

    expect(matchesPluginUpdate(builtin("fixture.first"), update)).toBe(false)
    expect(matchesPluginUpdate(builtin("fixture.second"), update)).toBe(true)
  })

  test("joins package and local plugins only by their exact source", () => {
    const pkg = {
      id: "fixture.package",
      source: { type: "package", package: "@fixture/package@latest" },
      status: "active",
      tui: false,
    } satisfies PluginInfo
    const local = {
      id: "fixture.local",
      source: { type: "local", path: "/fixture/local.ts" },
      status: "active",
      tui: false,
    } satisfies PluginInfo

    expect(
      matchesPluginUpdate(pkg, {
        name: "@fixture/package@latest",
        source: { type: "package", package: "@fixture/package@latest" },
        status: "available",
      }),
    ).toBe(true)
    expect(
      matchesPluginUpdate(pkg, {
        name: "fixture.package",
        source: { type: "package", package: "@fixture/other@latest" },
        status: "available",
      }),
    ).toBe(false)
    expect(
      matchesPluginUpdate(local, {
        name: "/fixture/other.ts",
        source: { type: "local", path: "/fixture/other.ts" },
        status: "not-updateable",
      }),
    ).toBe(false)
  })

  test("derives stable keys only from runtime identity", () => {
    const plugin = builtin("fixture.stable")

    expect(pluginServerKey(plugin)).toBe("server:fixture.stable")
    expect(pluginServerKey(plugin)).toBe(pluginServerKey({ ...plugin }))
  })
})
