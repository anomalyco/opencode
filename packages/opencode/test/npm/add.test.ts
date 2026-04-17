import { describe, expect, test, afterAll, beforeAll, afterEach, beforeEach } from "bun:test"
import { mkdtemp, rm, readFile } from "fs/promises"
import { tmpdir } from "os"
import path from "path"
import { makePackageDir, makeTarball } from "./fixtures/tarball"
import { startMockGitHub, type MockServer } from "./fixtures/mock-github"

let server: MockServer
let cacheRoot: string

beforeAll(async () => {
  const pubDir = await makePackageDir({ name: "pub-plugin", version: "1.0.0" })
  const tgz = await makeTarball(pubDir)
  server = startMockGitHub({
    releases: [
      {
        owner: "acme",
        repo: "pub",
        tag: "v1.0.0",
        assets: [{ id: 1, name: "pub.tgz", tgzPath: tgz }],
      },
    ],
  })
  process.env.TEST_GITHUB_API_BASE = server.apiBase
})

afterAll(() => {
  server?.stop()
  delete process.env.TEST_GITHUB_API_BASE
})

beforeEach(async () => {
  cacheRoot = await mkdtemp(path.join(tmpdir(), "npm-cache-"))
  process.env.OPENCODE_CACHE_PATH = cacheRoot
})

afterEach(async () => {
  if (cacheRoot) await rm(cacheRoot, { recursive: true, force: true })
  delete process.env.OPENCODE_CACHE_PATH
})

describe("Npm.add", () => {
  test("installs a release asset by pre-downloading and handing Arborist a file: URL", async () => {
    const { Npm } = await import("../../src/npm")
    const result = await Npm.add("https://github.com/acme/pub/releases/download/v1.0.0/pub.tgz")
    expect(result.directory).toContain(cacheRoot)
    const pkg = JSON.parse(
      await readFile(path.join(result.directory, "package.json"), "utf8"),
    )
    expect(pkg.name).toBe("pub-plugin")
    expect(pkg.version).toBe("1.0.0")
  })

  test("installs from a local directory via absolute file: path", async () => {
    const { Npm } = await import("../../src/npm")
    const localPkg = await makePackageDir({ name: "local-plugin", version: "0.1.0" })
    const result = await Npm.add(localPkg)
    expect(result.directory).toContain(cacheRoot)
    const pkg = JSON.parse(
      await readFile(path.join(result.directory, "package.json"), "utf8"),
    )
    expect(pkg.name).toBe("local-plugin")
  })
})
