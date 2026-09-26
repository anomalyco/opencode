import { describe, expect, test } from "bun:test"
import { parsePluginSpecifier, readV1Plugin } from "../../src/plugin/shared"

describe("parsePluginSpecifier", () => {
  test("parses standard npm package without version", () => {
    expect(parsePluginSpecifier("acme")).toEqual({
      pkg: "acme",
      version: "latest",
    })
  })

  test("parses standard npm package with version", () => {
    expect(parsePluginSpecifier("acme@1.0.0")).toEqual({
      pkg: "acme",
      version: "1.0.0",
    })
  })

  test("parses scoped npm package without version", () => {
    expect(parsePluginSpecifier("@opencode/acme")).toEqual({
      pkg: "@opencode/acme",
      version: "latest",
    })
  })

  test("parses scoped npm package with version", () => {
    expect(parsePluginSpecifier("@opencode/acme@1.0.0")).toEqual({
      pkg: "@opencode/acme",
      version: "1.0.0",
    })
  })

  test("parses package with git+https url", () => {
    expect(parsePluginSpecifier("acme@git+https://github.com/opencode/acme.git")).toEqual({
      pkg: "acme",
      version: "git+https://github.com/opencode/acme.git",
    })
  })

  test("parses scoped package with git+https url", () => {
    expect(parsePluginSpecifier("@opencode/acme@git+https://github.com/opencode/acme.git")).toEqual({
      pkg: "@opencode/acme",
      version: "git+https://github.com/opencode/acme.git",
    })
  })

  test("parses package with git+ssh url containing another @", () => {
    expect(parsePluginSpecifier("acme@git+ssh://git@github.com/opencode/acme.git")).toEqual({
      pkg: "acme",
      version: "git+ssh://git@github.com/opencode/acme.git",
    })
  })

  test("parses scoped package with git+ssh url containing another @", () => {
    expect(parsePluginSpecifier("@opencode/acme@git+ssh://git@github.com/opencode/acme.git")).toEqual({
      pkg: "@opencode/acme",
      version: "git+ssh://git@github.com/opencode/acme.git",
    })
  })

  test("parses unaliased git+ssh url", () => {
    expect(parsePluginSpecifier("git+ssh://git@github.com/opencode/acme.git")).toEqual({
      pkg: "git+ssh://git@github.com/opencode/acme.git",
      version: "",
    })
  })

  test("parses npm alias using the alias name", () => {
    expect(parsePluginSpecifier("acme@npm:@opencode/acme@1.0.0")).toEqual({
      pkg: "acme",
      version: "npm:@opencode/acme@1.0.0",
    })
  })

  test("parses bare npm protocol specifier using the target package", () => {
    expect(parsePluginSpecifier("npm:@opencode/acme@1.0.0")).toEqual({
      pkg: "@opencode/acme",
      version: "1.0.0",
    })
  })

  test("parses unversioned npm protocol specifier", () => {
    expect(parsePluginSpecifier("npm:@opencode/acme")).toEqual({
      pkg: "@opencode/acme",
      version: "latest",
    })
  })
})

describe("readV1Plugin", () => {
  test("reads a plugin from its default export", () => {
    const plugin = { id: "acme", server: async () => ({}) }
    expect(readV1Plugin({ default: plugin }, "acme.ts", "server", "detect")).toBe(plugin)
  })

  test("reports a default export without the requested kind in detect mode", () => {
    expect(readV1Plugin({ default: { id: "acme", setup: () => {} } }, "acme.ts", "server", "detect")).toBeUndefined()
    expect(readV1Plugin({ default: async () => ({}) }, "acme.ts", "server", "detect")).toBeUndefined()
    expect(
      readV1Plugin({ default: { id: "acme", server: async () => ({}) } }, "acme.ts", "tui", "detect"),
    ).toBeUndefined()
  })

  test("requires the requested kind in strict mode", () => {
    expect(() => readV1Plugin({ default: { id: "acme", setup: () => {} } }, "acme.ts", "server")).toThrow(
      "must default export an object with server()",
    )
    expect(() => readV1Plugin({ default: {} }, "acme.ts", "tui")).toThrow("must default export an object with tui()")
  })

  test("rejects a malformed plugin in both modes", () => {
    expect(() => readV1Plugin({ default: { server: "acme" } }, "acme.ts", "server", "detect")).toThrow(
      "has invalid server export",
    )
    expect(() =>
      readV1Plugin({ default: { server: async () => ({}), tui: async () => ({}) } }, "acme.ts", "server", "detect"),
    ).toThrow("must default export either server() or tui(), not both")
  })
})
