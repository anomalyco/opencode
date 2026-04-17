import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { mkdtemp, rm } from "fs/promises"
import { tmpdir } from "os"
import path from "path"
import { makeBareRepo } from "./fixtures/bare-repo"
import { makePackageDir, makeTarball } from "./fixtures/tarball"
import { startMockGitHub } from "./fixtures/mock-github"

let cacheRoot: string

beforeEach(async () => {
  cacheRoot = await mkdtemp(path.join(tmpdir(), "cache-"))
  process.env.OPENCODE_CACHE_PATH = cacheRoot
})

afterEach(async () => {
  if (cacheRoot) await rm(cacheRoot, { recursive: true, force: true })
  delete process.env.OPENCODE_CACHE_PATH
})

describe("plugin-load integration", () => {
  test("subdir install produces an importable plugin module", async () => {
    const bareDir = await makeBareRepo({
      pkg: {
        name: "subdir-plugin",
        version: "1.0.0",
        mainContents: 'module.exports = { marker: "subdir-ok" }\n',
      },
      subdir: "packages/foo",
    })
    const { Npm } = await import("../../src/npm")
    const spec = `git+file://${bareDir}#main::path:packages/foo`
    const result = await Npm.add(spec)
    expect(result.entrypoint).toBeTruthy()
    const mod = await import(result.entrypoint!)
    expect(mod.marker ?? mod.default?.marker).toBe("subdir-ok")
  }, 30_000)

  // Regression: pacote's git fetcher runs a prepare step when the target package.json
  // has install/build/prepare/workspaces. @npmcli/config's flat options inject npmBin =
  // <cwd>/bin/npm-cli.js, which does not exist. Without an override, pacote spawns the
  // missing path and surfaces a confusing "Cache input stream was empty" error.
  test("subdir install with prepare script does not error on missing npm-cli", async () => {
    const bareDir = await makeBareRepo({
      pkg: {
        name: "subdir-prepare-plugin",
        version: "1.0.0",
        mainContents: 'module.exports = { marker: "prepare-ok" }\n',
        scripts: { prepare: "echo prepared" },
      },
      subdir: "packages/bar",
    })
    const { Npm } = await import("../../src/npm")
    const spec = `git+file://${bareDir}#main::path:packages/bar`
    const result = await Npm.add(spec)
    expect(result.entrypoint).toBeTruthy()
    const mod = await import(result.entrypoint!)
    expect(mod.marker ?? mod.default?.marker).toBe("prepare-ok")
  }, 60_000)

  test("release asset install produces an importable plugin module", async () => {
    const pkgDir = await makePackageDir({
      name: "asset-plugin",
      version: "1.0.0",
      mainContents: 'module.exports = { marker: "asset-ok" }\n',
    })
    const tgz = await makeTarball(pkgDir)
    const server = startMockGitHub({
      releases: [
        {
          owner: "acme",
          repo: "asset",
          tag: "v1.0.0",
          assets: [{ id: 1, name: "asset.tgz", tgzPath: tgz }],
        },
      ],
    })
    process.env.TEST_GITHUB_API_BASE = server.apiBase
    try {
      const { Npm } = await import("../../src/npm")
      const result = await Npm.add("https://github.com/acme/asset/releases/download/v1.0.0/asset.tgz")
      expect(result.entrypoint).toBeTruthy()
      const mod = await import(result.entrypoint!)
      expect(mod.marker ?? mod.default?.marker).toBe("asset-ok")
    } finally {
      server.stop()
      delete process.env.TEST_GITHUB_API_BASE
    }
  }, 30_000)
})
