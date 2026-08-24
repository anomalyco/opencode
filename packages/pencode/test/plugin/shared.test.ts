import { describe, expect, test } from "bun:test"
import { parsePluginSpecifier } from "../../src/plugin/shared"

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
    expect(parsePluginSpecifier("@pencode/acme")).toEqual({
      pkg: "@pencode/acme",
      version: "latest",
    })
  })

  test("parses scoped npm package with version", () => {
    expect(parsePluginSpecifier("@pencode/acme@1.0.0")).toEqual({
      pkg: "@pencode/acme",
      version: "1.0.0",
    })
  })

  test("parses package with git+https url", () => {
    expect(parsePluginSpecifier("acme@git+https://github.com/pencode/acme.git")).toEqual({
      pkg: "acme",
      version: "git+https://github.com/pencode/acme.git",
    })
  })

  test("parses scoped package with git+https url", () => {
    expect(parsePluginSpecifier("@pencode/acme@git+https://github.com/pencode/acme.git")).toEqual({
      pkg: "@pencode/acme",
      version: "git+https://github.com/pencode/acme.git",
    })
  })

  test("parses package with git+ssh url containing another @", () => {
    expect(parsePluginSpecifier("acme@git+ssh://git@github.com/pencode/acme.git")).toEqual({
      pkg: "acme",
      version: "git+ssh://git@github.com/pencode/acme.git",
    })
  })

  test("parses scoped package with git+ssh url containing another @", () => {
    expect(parsePluginSpecifier("@pencode/acme@git+ssh://git@github.com/pencode/acme.git")).toEqual({
      pkg: "@pencode/acme",
      version: "git+ssh://git@github.com/pencode/acme.git",
    })
  })

  test("parses unaliased git+ssh url", () => {
    expect(parsePluginSpecifier("git+ssh://git@github.com/pencode/acme.git")).toEqual({
      pkg: "git+ssh://git@github.com/pencode/acme.git",
      version: "",
    })
  })

  test("parses npm alias using the alias name", () => {
    expect(parsePluginSpecifier("acme@npm:@pencode/acme@1.0.0")).toEqual({
      pkg: "acme",
      version: "npm:@pencode/acme@1.0.0",
    })
  })

  test("parses bare npm protocol specifier using the target package", () => {
    expect(parsePluginSpecifier("npm:@pencode/acme@1.0.0")).toEqual({
      pkg: "@pencode/acme",
      version: "1.0.0",
    })
  })

  test("parses unversioned npm protocol specifier", () => {
    expect(parsePluginSpecifier("npm:@pencode/acme")).toEqual({
      pkg: "@pencode/acme",
      version: "latest",
    })
  })
})
