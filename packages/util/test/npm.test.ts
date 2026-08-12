import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { InstallFailedError, Npm } from "../src/npm.js"

describe("Npm.install", () => {
  test("installs file: dependencies without timing out", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-npm-install-"))
    await fs.writeFile(
      path.join(dir, "package.json"),
      JSON.stringify({
        name: "fixture",
        version: "1.0.0",
        dependencies: { "fixture-provider": "file:./fixture-provider" },
      }),
    )
    await fs.mkdir(path.join(dir, "fixture-provider"))
    await fs.writeFile(
      path.join(dir, "fixture-provider", "package.json"),
      JSON.stringify({ name: "fixture-provider", version: "1.0.0", main: "index.js" }),
    )
    await fs.writeFile(path.join(dir, "fixture-provider", "index.js"), "export const value = 1\n")
    try {
      await expect(Npm.install(dir)).resolves.toBeUndefined()
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  test("fails with InstallFailedError when the registry never responds within the timeout", async () => {
    const server = Bun.serve({ port: 0, fetch: () => new Promise(() => {}) })
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-npm-timeout-"))
    await fs.writeFile(path.join(dir, "package.json"), JSON.stringify({ name: "fixture", version: "1.0.0" }))
    process.env.npm_config_registry = `http://127.0.0.1:${server.port}/`
    process.env.OPENCODE_NPM_INSTALL_TIMEOUT = "1000"
    try {
      const outcome = await Npm.install(dir, {
        add: [{ name: "never-resolves-package", version: "1.0.0" }],
      }).then(
        () => undefined,
        (error) => error,
      )
      expect(outcome).toBeInstanceOf(InstallFailedError)
    } finally {
      delete process.env.npm_config_registry
      delete process.env.OPENCODE_NPM_INSTALL_TIMEOUT
      server.stop()
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})
