import { describe, expect, test } from "bun:test"
import { pluginSpec } from "./plugin-spec"

describe("pluginSpec", () => {
  test("parses npm package with version", () => {
    expect(pluginSpec("oh-my-opencode@2.4.3")).toEqual({
      name: "oh-my-opencode",
      version: "2.4.3",
    })
  })

  test("parses scoped npm package with version", () => {
    expect(pluginSpec("@scope/plugin@1.0.0")).toEqual({
      name: "@scope/plugin",
      version: "1.0.0",
    })
  })

  test("defaults npm package to latest when version is missing", () => {
    expect(pluginSpec("@scope/plugin")).toEqual({
      name: "@scope/plugin",
      version: "latest",
    })
  })

  test("parses file plugin and keeps raw specifier", () => {
    expect(pluginSpec("file:///project/.opencode/plugins/custom-plugin.ts")).toEqual({
      name: "custom-plugin",
      raw: "file:///project/.opencode/plugins/custom-plugin.ts",
    })
  })

  test("uses parent directory name when filename is index", () => {
    expect(pluginSpec("file:///project/.opencode/plugins/my-plugin/index.js")).toEqual({
      name: "my-plugin",
      raw: "file:///project/.opencode/plugins/my-plugin/index.js",
    })
  })
})
