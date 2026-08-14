import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { Global } from "../src/global.js"
import { InstallFailedError, Npm } from "../src/npm.js"

const cacheDir = (spec: string) => path.join(Global.Path.cache, "packages", Npm.sanitize(spec))

describe("Npm.add", () => {
  test("installs a file: package without timing out", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-npm-install-"))
    await fs.mkdir(path.join(dir, "fixture-provider"))
    await fs.writeFile(
      path.join(dir, "fixture-provider", "package.json"),
      JSON.stringify({ name: "fixture-provider", version: "1.0.0", main: "index.js" }),
    )
    await fs.writeFile(path.join(dir, "fixture-provider", "index.js"), "export const value = 1\n")
    const spec = `fixture-provider@file:${path.join(dir, "fixture-provider")}`
    try {
      await expect(Npm.add(spec)).resolves.toMatchObject({ entrypoint: expect.any(String) })
    } finally {
      await fs.rm(cacheDir(spec), { recursive: true, force: true })
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  test("fails with InstallFailedError when the registry never responds within the timeout", async () => {
    const server = Bun.serve({ port: 0, fetch: () => new Promise(() => {}) })
    const spec = "never-resolves-package@1.0.0"
    process.env.npm_config_registry = `http://127.0.0.1:${server.port}/`
    process.env.OPENCODE_NPM_INSTALL_TIMEOUT = "1000"
    try {
      const outcome = await Npm.add(spec).then(
        () => undefined,
        (error) => error,
      )
      expect(outcome).toBeInstanceOf(InstallFailedError)
    } finally {
      delete process.env.npm_config_registry
      delete process.env.OPENCODE_NPM_INSTALL_TIMEOUT
      server.stop()
      await fs.rm(cacheDir(spec), { recursive: true, force: true })
    }
  })
})
