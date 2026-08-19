import { afterEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { checkPluginCompatibility, parsePluginSpecifier } from "../../src/plugin/shared"

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

describe("checkPluginCompatibility", () => {
  const dirs: string[] = []

  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
  })

  async function tmpPlugin(json?: string) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-plugin-"))
    dirs.push(dir)
    if (json !== undefined) await fs.writeFile(path.join(dir, "package.json"), json)
    return dir
  }

  test("throws when package.json cannot be read", async () => {
    const dir = await tmpPlugin()
    await expect(checkPluginCompatibility(dir, "1.18.0")).rejects.toThrow(/Unable to read plugin package\.json/)
  })

  test("throws when package.json is malformed", async () => {
    const dir = await tmpPlugin("{ not json")
    await expect(checkPluginCompatibility(dir, "1.18.0")).rejects.toThrow(/Unable to read plugin package\.json/)
  })

  test("throws when engines.opencode is unsatisfied", async () => {
    const dir = await tmpPlugin(JSON.stringify({ name: "acme", engines: { opencode: ">=99.0.0" } }))
    await expect(checkPluginCompatibility(dir, "1.18.0")).rejects.toThrow(/Plugin requires opencode >=99\.0\.0/)
  })

  test("passes when engines.opencode is satisfied", async () => {
    const dir = await tmpPlugin(JSON.stringify({ name: "acme", engines: { opencode: ">=1.0.0" } }))
    await expect(checkPluginCompatibility(dir, "1.18.0")).resolves.toBeUndefined()
  })

  test("skips the gate for major version 0 builds", async () => {
    const dir = await tmpPlugin()
    await expect(checkPluginCompatibility(dir, "0.0.0-dev")).resolves.toBeUndefined()
  })
})
