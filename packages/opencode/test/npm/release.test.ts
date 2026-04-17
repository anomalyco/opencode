import { describe, expect, test, afterAll, beforeAll, afterEach } from "bun:test"
import { mkdtemp, readFile, rm } from "fs/promises"
import { tmpdir } from "os"
import path from "path"
import { makePackageDir, makeTarball } from "./fixtures/tarball"
import { startMockGitHub, type MockServer } from "./fixtures/mock-github"

let server: MockServer
let publicTgz: string
let privateTgz: string
let cacheRoot: string

beforeAll(async () => {
  const pubDir = await makePackageDir({ name: "pub", version: "1.0.0" })
  publicTgz = await makeTarball(pubDir)
  const privDir = await makePackageDir({ name: "priv", version: "1.0.0" })
  privateTgz = await makeTarball(privDir)
  server = startMockGitHub({
    releases: [
      {
        owner: "acme",
        repo: "pub",
        tag: "v1.0.0",
        assets: [{ id: 100, name: "pub.tgz", tgzPath: publicTgz }],
      },
      {
        owner: "acme",
        repo: "priv",
        tag: "v1.0.0",
        assets: [{ id: 200, name: "priv.tgz", tgzPath: privateTgz, requiresAuth: true }],
      },
    ],
  })
  process.env.TEST_GITHUB_API_BASE = server.apiBase
})

afterAll(() => {
  server?.stop()
  delete process.env.TEST_GITHUB_API_BASE
})

afterEach(async () => {
  if (cacheRoot) await rm(cacheRoot, { recursive: true, force: true })
  server.requests.length = 0
})

async function freshCache() {
  cacheRoot = await mkdtemp(path.join(tmpdir(), "npm-cache-"))
  return cacheRoot
}

describe("preResolveReleaseAsset", () => {
  test("public asset downloads anonymously and caches", async () => {
    const { preResolveReleaseAsset } = await import("../../src/npm/release")
    const cache = await freshCache()
    const local = await preResolveReleaseAsset(
      { kind: "release", owner: "acme", repo: "pub", tag: "v1.0.0", asset: "pub.tgz" },
      { cacheRoot: cache, token: undefined },
    )
    expect(local).toMatch(/\.tgz$/)
    const bytes = await readFile(local)
    expect(bytes.byteLength).toBeGreaterThan(0)
    // No Authorization header was sent for the public asset
    const authHeaders = server.requests
      .filter((r) => r.url.startsWith("/api/"))
      .map((r) => r.headers.authorization)
      .filter(Boolean)
    expect(authHeaders).toEqual([])
  })

  test("private asset with GITHUB_TOKEN env sends Bearer header and downloads", async () => {
    const { preResolveReleaseAsset } = await import("../../src/npm/release")
    const cache = await freshCache()
    process.env.GITHUB_TOKEN = "env-token-xyz"
    try {
      const local = await preResolveReleaseAsset(
        { kind: "release", owner: "acme", repo: "priv", tag: "v1.0.0", asset: "priv.tgz" },
        { cacheRoot: cache },
      )
      const bytes = await readFile(local)
      expect(bytes.byteLength).toBeGreaterThan(0)
      // Bearer token was sent to the API endpoint
      const apiReq = server.requests.find((r) => r.url.includes("/releases/assets/"))
      expect(apiReq?.headers.authorization).toBe("Bearer env-token-xyz")
      // Accept header was application/octet-stream
      expect(apiReq?.headers.accept).toBe("application/octet-stream")
    } finally {
      delete process.env.GITHUB_TOKEN
    }
  })

  test("private asset with no auth fails with class-1 error message", async () => {
    const { preResolveReleaseAsset } = await import("../../src/npm/release")
    const cache = await freshCache()
    await expect(
      preResolveReleaseAsset(
        { kind: "release", owner: "acme", repo: "priv", tag: "v1.0.0", asset: "priv.tgz" },
        { cacheRoot: cache, token: undefined },
      ),
    ).rejects.toThrow(/release asset not found, or missing\/insufficient GitHub authentication/)
  })

  test("asset name not in release fails with class-2 error message", async () => {
    const { preResolveReleaseAsset } = await import("../../src/npm/release")
    const cache = await freshCache()
    await expect(
      preResolveReleaseAsset(
        { kind: "release", owner: "acme", repo: "pub", tag: "v1.0.0", asset: "nonexistent.tgz" },
        { cacheRoot: cache, token: undefined },
      ),
    ).rejects.toThrow(/authenticated metadata lookup confirmed asset missing/)
  })

  test("cache hit returns same path without re-fetching", async () => {
    const { preResolveReleaseAsset } = await import("../../src/npm/release")
    const cache = await freshCache()
    const first = await preResolveReleaseAsset(
      { kind: "release", owner: "acme", repo: "pub", tag: "v1.0.0", asset: "pub.tgz" },
      { cacheRoot: cache, token: undefined },
    )
    server.requests.length = 0
    const second = await preResolveReleaseAsset(
      { kind: "release", owner: "acme", repo: "pub", tag: "v1.0.0", asset: "pub.tgz" },
      { cacheRoot: cache, token: undefined },
    )
    expect(second).toBe(first)
    expect(server.requests.length).toBe(0)
  })

  test("atomic write leaves only asset.tgz, no .tmp file, on success", async () => {
    const { preResolveReleaseAsset } = await import("../../src/npm/release")
    const cache = await freshCache()
    const local = await preResolveReleaseAsset(
      { kind: "release", owner: "acme", repo: "pub", tag: "v1.0.0", asset: "pub.tgz" },
      { cacheRoot: cache, token: undefined },
    )
    const dir = path.dirname(local)
    const { readdir } = await import("fs/promises")
    const entries = await readdir(dir)
    expect(entries.filter((e) => e.endsWith(".tmp"))).toEqual([])
    expect(entries).toContain("asset.tgz")
  })
})
