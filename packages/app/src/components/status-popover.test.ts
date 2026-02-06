import { describe, expect, test } from "bun:test"
import { parsePluginSpecifier } from "./plugin-specifier"

describe("parsePluginSpecifier", () => {
  test("parses file plugin by basename", () => {
    const result = parsePluginSpecifier("file:///path/to/prevent-sleep.ts")
    expect(result).toEqual({
      raw: "file:///path/to/prevent-sleep.ts",
      name: "prevent-sleep",
    })
  })

  test("parses file plugin index entry by directory", () => {
    const result = parsePluginSpecifier("file:///path/to/opencode-caffeinate/index.ts")
    expect(result).toEqual({
      raw: "file:///path/to/opencode-caffeinate/index.ts",
      name: "opencode-caffeinate",
    })
  })

  test("parses npm plugin with version", () => {
    const result = parsePluginSpecifier("opencode-caffeinate@0.1.3")
    expect(result).toEqual({
      raw: "opencode-caffeinate@0.1.3",
      name: "opencode-caffeinate",
      version: "0.1.3",
    })
  })

  test("parses scoped npm plugin with version", () => {
    const result = parsePluginSpecifier("@scope/plugin@1.2.3")
    expect(result).toEqual({
      raw: "@scope/plugin@1.2.3",
      name: "@scope/plugin",
      version: "1.2.3",
    })
  })

  test("parses npm plugin without version", () => {
    const result = parsePluginSpecifier("opencode-openai-codex-auth")
    expect(result).toEqual({
      raw: "opencode-openai-codex-auth",
      name: "opencode-openai-codex-auth",
    })
  })
})
