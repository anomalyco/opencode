import { describe, expect, test } from "bun:test"
import os from "os"
import path from "path"
import { isPathPluginSpec, parsePluginSpecifier, resolvePathPluginTarget } from "../../src/plugin/shared"

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

describe("isPathPluginSpec", () => {
  test("recognizes file:// URL", () => {
    expect(isPathPluginSpec("file:///home/user/plugin")).toBe(true)
  })

  test("recognizes relative path", () => {
    expect(isPathPluginSpec("./my-plugin")).toBe(true)
  })

  test("recognizes absolute path", () => {
    expect(isPathPluginSpec("/home/user/plugin")).toBe(true)
  })

  test("recognizes ~/ tilde path", () => {
    expect(isPathPluginSpec("~/my-plugin")).toBe(true)
  })

  test("does not treat npm package as path", () => {
    expect(isPathPluginSpec("my-package")).toBe(false)
  })

  test("does not treat scoped npm package as path", () => {
    expect(isPathPluginSpec("@opencode/my-plugin")).toBe(false)
  })
})

describe("resolvePathPluginTarget", () => {
  test("expands ~/ to home directory", async () => {
    // Create a real temp file under home dir to resolve against
    const tmpName = `opencode-test-plugin-${Date.now()}.ts`
    const tmpFile = path.join(os.homedir(), tmpName)
    await Bun.write(tmpFile, "export default {}")
    try {
      const result = await resolvePathPluginTarget(`~/${tmpName}`)
      expect(result).toBe(`file://${tmpFile}`)
    } finally {
      await Bun.file(tmpFile).exists() && (await import("fs")).promises.unlink(tmpFile)
    }
  })
})
