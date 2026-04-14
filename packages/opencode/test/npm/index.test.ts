import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { tmpdir } from "../fixture/fixture"

const base = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-npm-"))
const xdg = path.join(base, "xdg")
const home = path.join(base, "home")
const prev = {
  HOME: process.env.HOME,
  NPM_CONFIG_USERCONFIG: process.env.NPM_CONFIG_USERCONFIG,
  XDG_CACHE_HOME: process.env.XDG_CACHE_HOME,
  XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
  XDG_DATA_HOME: process.env.XDG_DATA_HOME,
  XDG_STATE_HOME: process.env.XDG_STATE_HOME,
  npm_config_registry: process.env.npm_config_registry,
  npm_config_userconfig: process.env.npm_config_userconfig,
}

await fs.mkdir(xdg, { recursive: true })
await fs.mkdir(home, { recursive: true })

process.env.HOME = home
process.env.XDG_CACHE_HOME = path.join(xdg, "cache")
process.env.XDG_CONFIG_HOME = path.join(xdg, "config")
process.env.XDG_DATA_HOME = path.join(xdg, "data")
process.env.XDG_STATE_HOME = path.join(xdg, "state")

const seen: Array<Record<string, unknown>> = []

mock.module("@npmcli/arborist", () => ({
  Arborist: class {
    constructor(input: Record<string, unknown>) {
      seen.push(input)
    }

    async loadVirtual() {
      return undefined
    }

    async reify() {
      return {
        edgesOut: new Map([["pkg", { to: { name: "@tngtech/opencode-skainet", path: base } }]]),
      }
    }
  },
}))

const { Global } = await import("../../src/global")
const { Npm } = await import("../../src/npm")

beforeEach(async () => {
  seen.length = 0
  delete process.env.NPM_CONFIG_USERCONFIG
  delete process.env.npm_config_registry
  delete process.env.npm_config_userconfig
  await fs.rm(home, { recursive: true, force: true })
  await fs.mkdir(home, { recursive: true })
  await fs.rm(Global.Path.cache, { recursive: true, force: true })
  await fs.mkdir(Global.Path.cache, { recursive: true })
  await fs.writeFile(path.join(Global.Path.cache, "version"), "21")
})

afterAll(async () => {
  for (const [key, value] of Object.entries(prev)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  await fs.rm(base, { recursive: true, force: true })
})

describe("npm", () => {
  test("add reads scoped registry from user npmrc", async () => {
    await fs.writeFile(path.join(home, ".npmrc"), "@tngtech:registry=https://user.example/\n")

    await Npm.add("@tngtech/opencode-skainet@latest")

    expect(seen[0]?.["@tngtech:registry"]).toBe("https://user.example/")
    expect(seen[0]?.path).toBe(
      path.join(Global.Path.cache, "packages", Npm.sanitize("@tngtech/opencode-skainet@latest")),
    )
  })

  test("add keeps cache root npmrc as local config", async () => {
    await fs.writeFile(path.join(Global.Path.cache, ".npmrc"), "@tngtech:registry=https://cache.example/\n")

    await Npm.add("@tngtech/opencode-skainet@latest")

    expect(seen[0]?.["@tngtech:registry"]).toBe("https://cache.example/")
  })

  test("install reads local npmrc from install dir", async () => {
    await using tmp = await tmpdir()
    await fs.writeFile(path.join(tmp.path, ".npmrc"), "registry=https://dir.example/\n")

    await Npm.install(tmp.path)

    expect(seen[0]?.registry).toBe("https://dir.example/")
    expect(seen[0]?.path).toBe(tmp.path)
  })
})
