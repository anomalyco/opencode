import { describe, expect, test } from "bun:test"
import { checkPluginCompatibility, parsePluginSpecifier } from "../../src/plugin/shared"

describe("checkPluginCompatibility", () => {
  const pkg = { dir: "/tmp/acme", pkg: "/tmp/acme/package.json", json: { engines: { opencode: ">=1.18.0" } } }

  test("accepts a prerelease build newer than the required range", async () => {
    await expect(checkPluginCompatibility("acme", "1.18.34-quickundo", pkg)).resolves.toBeUndefined()
  })

  test("rejects a prerelease build older than the required range", async () => {
    await expect(checkPluginCompatibility("acme", "1.17.0-beta", pkg)).rejects.toThrow(
      "Plugin requires opencode >=1.18.0 but running 1.17.0-beta",
    )
  })
})

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
