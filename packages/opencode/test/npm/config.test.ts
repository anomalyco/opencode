import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { NpmConfig } from "../../src/npm/config"
import { tmpdir } from "../fixture/fixture"

function env(next: Record<string, string | undefined>) {
  const prev = Object.fromEntries(Object.keys(next).map((key) => [key, process.env[key]]))

  for (const [key, value] of Object.entries(next)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }

  return () => {
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

describe("NpmConfig", () => {
  test("returns selected config file paths in precedence order", async () => {
    await using tmp = await tmpdir()
    const global = path.join(tmp.path, "global.npmrc")
    const user = path.join(tmp.path, "user.npmrc")
    const root = path.join(tmp.path, ".npmrc")
    const child = path.join(tmp.path, "repo", ".npmrc")
    const pkg = path.join(tmp.path, "repo", "package.json")
    const dir = path.join(tmp.path, "repo", ".opencode")

    await fs.mkdir(dir, { recursive: true })
    await Bun.write(global, "registry=https://global.example/\n")
    await Bun.write(user, "registry=https://user.example/\n")
    await Bun.write(root, "registry=https://root.example/\n")
    await Bun.write(child, "registry=https://child.example/\n")
    await Bun.write(pkg, '{"name":"repo","version":"1.0.0"}\n')

    const restore = env({
      npm_config_globalconfig: global,
      npm_config_userconfig: user,
    })

    try {
      expect(await NpmConfig.paths(dir)).toEqual([child, user, global])
    } finally {
      restore()
    }
  })

  test("merges config relative to a directory with env last", async () => {
    await using tmp = await tmpdir()
    const global = path.join(tmp.path, "global.npmrc")
    const user = path.join(tmp.path, "user.npmrc")
    const root = path.join(tmp.path, ".npmrc")
    const child = path.join(tmp.path, "repo", ".npmrc")
    const pkg = path.join(tmp.path, "repo", "package.json")
    const dir = path.join(tmp.path, "repo", ".opencode")

    await fs.mkdir(dir, { recursive: true })
    await Bun.write(global, "registry=https://global.example/\nignore-scripts=false\n")
    await Bun.write(user, "registry=https://user.example/\nignore-scripts=false\n")
    await Bun.write(root, "registry=https://root.example/\nignore-scripts=false\n")
    await Bun.write(child, "ignore-scripts=true\nbin-links=false\n@scope:registry=https://scope.example/\n")
    await Bun.write(pkg, '{"name":"repo","version":"1.0.0"}\n')

    const restore = env({
      npm_config_globalconfig: global,
      npm_config_userconfig: user,
      npm_config_ignore_scripts: "false",
      npm_config_registry: "https://env.example/",
    })

    try {
      const cfg = await NpmConfig.config(dir)
      expect(cfg.registry).toBe("https://env.example/")
      expect(cfg.ignoreScripts).toBe(false)
      expect(cfg.binLinks).toBe(false)
      expect(cfg["@scope:registry"]).toBe("https://scope.example/")
    } finally {
      restore()
    }
  })

  test("reloads config on each call", async () => {
    await using tmp = await tmpdir()
    const global = path.join(tmp.path, "global.npmrc")
    const user = path.join(tmp.path, "user.npmrc")
    const local = path.join(tmp.path, "repo", ".npmrc")
    const pkg = path.join(tmp.path, "repo", "package.json")
    const dir = path.join(tmp.path, "repo", ".opencode")

    await fs.mkdir(dir, { recursive: true })
    await Bun.write(global, "registry=https://global.example/\n")
    await Bun.write(user, "registry=https://user.example/\n")
    await Bun.write(local, "ignore-scripts=true\n")
    await Bun.write(pkg, '{"name":"repo","version":"1.0.0"}\n')

    const restore = env({
      npm_config_globalconfig: global,
      npm_config_userconfig: user,
    })

    try {
      const first = await NpmConfig.config(dir)
      await Bun.write(local, "ignore-scripts=false\n")
      const second = await NpmConfig.config(dir)
      expect(first.ignoreScripts).toBe(true)
      expect(second.ignoreScripts).toBe(false)
    } finally {
      restore()
    }
  })
})
