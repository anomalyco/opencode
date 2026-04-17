import { describe, expect, test, afterAll, beforeAll, afterEach, beforeEach } from "bun:test"
import { mkdtemp, rm, writeFile } from "fs/promises"
import { tmpdir } from "os"
import path from "path"
import { makePackageDir, makeTarball } from "./fixtures/tarball"
import { startMockGitHub, type MockServer } from "./fixtures/mock-github"

let server: MockServer
let tempHome: string
let cacheRoot: string
let originalHome: string | undefined

beforeAll(async () => {
  const pkgDir = await makePackageDir({ name: "pkg", version: "1.0.0" })
  const tgz = await makeTarball(pkgDir)
  const peerDir = await makePackageDir({ name: "peer-pkg", version: "2.0.0" })
  const peerTgz = await makeTarball(peerDir)
  const peerSrcDir = await makePackageDir({ name: "peer-src", version: "1.0.0" })
  const peerSrcTgz = await makeTarball(peerSrcDir)
  server = startMockGitHub({
    packuments: [
      {
        scope: "@test",
        name: "pkg",
        tarballPath: tgz,
        version: "1.0.0",
        requireAuthToken: "fake-npmrc-token",
      },
      {
        scope: "@test",
        name: "peer-pkg",
        tarballPath: peerTgz,
        version: "2.0.0",
        requireAuthToken: "fake-npmrc-token",
      },
      {
        scope: "@test",
        name: "peer-src",
        tarballPath: peerSrcTgz,
        version: "1.0.0",
        requireAuthToken: "fake-npmrc-token",
        peerDependencies: { "@test/peer-pkg": "2.0.0" },
      },
    ],
  })
})

afterAll(() => {
  server?.stop()
})

beforeEach(async () => {
  tempHome = await mkdtemp(path.join(tmpdir(), "home-"))
  cacheRoot = await mkdtemp(path.join(tmpdir(), "cache-"))
  originalHome = process.env.HOME
  process.env.HOME = tempHome
  process.env.OPENCODE_CACHE_PATH = cacheRoot
  await writeFile(
    path.join(tempHome, ".npmrc"),
    [`@test:registry=${server.registryBase}/`, `//localhost:${server.port}/:_authToken=fake-npmrc-token`, ""].join(
      "\n",
    ),
  )
})

afterEach(async () => {
  if (tempHome) await rm(tempHome, { recursive: true, force: true })
  if (cacheRoot) await rm(cacheRoot, { recursive: true, force: true })
  if (originalHome !== undefined) process.env.HOME = originalHome
  else delete process.env.HOME
  delete process.env.OPENCODE_CACHE_PATH
})

describe("Arborist reads user ~/.npmrc", () => {
  test("scoped registry install sends _authToken from .npmrc", async () => {
    const { Npm } = await import("../../src/npm")
    await Npm.add("@test/pkg@1.0.0")
    const packumentReq = server.requests.find((r) => r.url.includes("/registry/@test"))
    expect(packumentReq).toBeTruthy()
    expect(packumentReq?.headers.authorization).toContain("fake-npmrc-token")
  })

  // Regression: Arborist installs peerDependencies by default. For plugin caches this means
  // @opentui/solid (which has solid-js as a peer) would drag in a second solid-js copy,
  // breaking context/signal propagation. Npm.add sets legacyPeerDeps: true to prevent that.
  test("Npm.add does not install peerDependencies", async () => {
    const { Npm } = await import("../../src/npm")
    await Npm.add("@test/peer-src@1.0.0")
    const requests = server.requests.map((r) => r.url)
    // Fetched the primary package
    expect(requests.some((u) => u.includes("peer-src"))).toBe(true)
    // Did NOT fetch the peer
    expect(requests.some((u) => u.includes("peer-pkg"))).toBe(false)
  })
})
