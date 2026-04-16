import { afterAll, afterEach, describe, expect, mock, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"

const originalCwd = process.cwd()
const originalEnv = {
  XDG_CACHE_HOME: process.env.XDG_CACHE_HOME,
  XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
  XDG_DATA_HOME: process.env.XDG_DATA_HOME,
  XDG_STATE_HOME: process.env.XDG_STATE_HOME,
  NPM_CONFIG_REGISTRY: process.env.NPM_CONFIG_REGISTRY,
  npm_config_registry: process.env.npm_config_registry,
}

const xdgRoot = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-npm-"))
process.env.XDG_CACHE_HOME = path.join(xdgRoot, "cache")
process.env.XDG_CONFIG_HOME = path.join(xdgRoot, "config")
process.env.XDG_DATA_HOME = path.join(xdgRoot, "data")
process.env.XDG_STATE_HOME = path.join(xdgRoot, "state")

type ArboristOptions = Record<string, unknown>
type ReifyOptions = Record<string, unknown>

const arboristConstructors: ArboristOptions[] = []
const arboristReifyCalls: ReifyOptions[] = []

mock.module("@npmcli/arborist", () => ({
  Arborist: class MockArborist {
    options: ArboristOptions

    constructor(options: ArboristOptions) {
      this.options = options
      arboristConstructors.push(options)
    }

    async loadVirtual() {
      return undefined
    }

    async reify(options: ReifyOptions) {
      arboristReifyCalls.push(options)
      const installPath = String(this.options.path)
      return {
        edgesOut: new Map([
          [
            "demo-plugin",
            {
              to: {
                name: "demo-plugin",
                path: path.join(installPath, "node_modules", "demo-plugin"),
              },
            },
          ],
        ]),
      }
    }
  },
}))

const { Npm } = await import("../../src/npm")
const { tmpdir } = await import("../fixture/fixture")

afterEach(() => {
  arboristConstructors.length = 0
  arboristReifyCalls.length = 0
  delete process.env.NPM_CONFIG_REGISTRY
  delete process.env.npm_config_registry
  process.chdir(originalCwd)
})

afterAll(async () => {
  process.chdir(originalCwd)

  if (originalEnv.XDG_CACHE_HOME === undefined) delete process.env.XDG_CACHE_HOME
  else process.env.XDG_CACHE_HOME = originalEnv.XDG_CACHE_HOME

  if (originalEnv.XDG_CONFIG_HOME === undefined) delete process.env.XDG_CONFIG_HOME
  else process.env.XDG_CONFIG_HOME = originalEnv.XDG_CONFIG_HOME

  if (originalEnv.XDG_DATA_HOME === undefined) delete process.env.XDG_DATA_HOME
  else process.env.XDG_DATA_HOME = originalEnv.XDG_DATA_HOME

  if (originalEnv.XDG_STATE_HOME === undefined) delete process.env.XDG_STATE_HOME
  else process.env.XDG_STATE_HOME = originalEnv.XDG_STATE_HOME

  if (originalEnv.NPM_CONFIG_REGISTRY === undefined) delete process.env.NPM_CONFIG_REGISTRY
  else process.env.NPM_CONFIG_REGISTRY = originalEnv.NPM_CONFIG_REGISTRY

  if (originalEnv.npm_config_registry === undefined) delete process.env.npm_config_registry
  else process.env.npm_config_registry = originalEnv.npm_config_registry

  await fs.rm(xdgRoot, { recursive: true, force: true })
})

async function projectFixture(registry: string) {
  return tmpdir({
    init: async (dir) => {
      await Bun.write(path.join(dir, "package.json"), JSON.stringify({ name: "fixture", version: "1.0.0" }, null, 2))
      await Bun.write(path.join(dir, ".npmrc"), `registry=${registry}\n`)
    },
  })
}

describe("npm.add", () => {
  test("uses project npm config and preserves env precedence when installing into the cache", async () => {
    await using tmp = await projectFixture("https://registry.example.test/")

    delete process.env.NPM_CONFIG_REGISTRY
    delete process.env.npm_config_registry

    await Npm.add("demo-plugin", tmp.path)

    expect(arboristConstructors).toHaveLength(1)
    expect(arboristReifyCalls).toEqual([
      {
        add: ["demo-plugin"],
        save: true,
        saveType: "prod",
      },
    ])

    const projectOptions = arboristConstructors[0]
    expect(projectOptions?.registry).toBe("https://registry.example.test/")
    expect(String(projectOptions?.path)).toContain(`${path.sep}opencode${path.sep}packages${path.sep}`)
    expect(String(projectOptions?.path)).not.toStartWith(tmp.path)

    arboristConstructors.length = 0
    arboristReifyCalls.length = 0
    process.env.NPM_CONFIG_REGISTRY = "https://env.example.test/"

    await Npm.add("demo-plugin-env", tmp.path)

    expect(arboristConstructors).toHaveLength(1)
    expect(arboristConstructors[0]?.registry).toBe("https://env.example.test/")
    expect(arboristReifyCalls).toEqual([
      {
        add: ["demo-plugin-env"],
        save: true,
        saveType: "prod",
      },
    ])
  })
})
