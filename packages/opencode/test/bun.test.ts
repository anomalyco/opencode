import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import fs from "fs/promises"
import path from "path"
import os from "os"

describe("BunProc registry configuration", () => {
  test("should not contain hardcoded registry parameters", async () => {
    const bunIndexPath = path.join(__dirname, "../src/bun/index.ts")
    const content = await fs.readFile(bunIndexPath, "utf-8")

    expect(content).not.toContain("--registry=")
    expect(content).not.toContain("hasNpmRcConfig")
    expect(content).not.toContain("NpmRc")
  })

  test("should have correct bun add command structure", async () => {
    const bunIndexPath = path.join(__dirname, "../src/bun/index.ts")
    const content = await fs.readFile(bunIndexPath, "utf-8")

    const installFunctionMatch = content.match(/export async function install[\s\S]*?^  }/m)
    expect(installFunctionMatch).toBeTruthy()

    if (installFunctionMatch) {
      const installFunction = installFunctionMatch[0]

      expect(installFunction).toContain('"add"')
      expect(installFunction).toContain('"--force"')
      expect(installFunction).toContain('"--exact"')
      expect(installFunction).toContain('"--cwd"')
      expect(installFunction).not.toContain('"--registry"')
    }
  })
})

describe("BunProc.install provider tracking", () => {
  let tempDir: string
  let originalCache: string | undefined

  beforeEach(async () => {
    tempDir = path.join(os.tmpdir(), "opencode-bun-test-" + Math.random().toString(36).slice(2))
    await fs.mkdir(tempDir, { recursive: true })
    originalCache = process.env.OPENCODE_TEST_CACHE
    process.env.OPENCODE_TEST_CACHE = tempDir
  })

  afterEach(async () => {
    if (originalCache === undefined) {
      delete process.env.OPENCODE_TEST_CACHE
    } else {
      process.env.OPENCODE_TEST_CACHE = originalCache
    }
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {})
  })

  async function readPkgJson() {
    return JSON.parse(await fs.readFile(path.join(tempDir, "package.json"), "utf-8"))
  }

  async function pkgExists(pkg: string) {
    return fs
      .stat(path.join(tempDir, "node_modules", pkg))
      .then(() => true)
      .catch(() => false)
  }

  test("should track provider in opencode.providers section", async () => {
    const { BunProc } = await import("../src/bun")

    await BunProc.install("zod", "latest", "anthropic")

    const pkgJson = await readPkgJson()
    expect(pkgJson.opencode?.providers?.anthropic).toBe("zod")
  })

  test("should install package in node_modules", async () => {
    const { BunProc } = await import("../src/bun")

    await BunProc.install("zod", "latest", "anthropic")

    expect(await pkgExists("zod")).toBe(true)
  })

  test("should update tracking when provider switches packages", async () => {
    const { BunProc } = await import("../src/bun")

    await BunProc.install("zod", "latest", "anthropic")
    let pkgJson = await readPkgJson()
    expect(pkgJson.opencode?.providers?.anthropic).toBe("zod")

    await BunProc.install("superstruct", "latest", "anthropic")
    pkgJson = await readPkgJson()
    expect(pkgJson.opencode?.providers?.anthropic).toBe("superstruct")
  })

  test("should remove old package when provider switches", async () => {
    const { BunProc } = await import("../src/bun")

    await BunProc.install("zod", "latest", "anthropic")
    expect(await pkgExists("zod")).toBe(true)

    await BunProc.install("superstruct", "latest", "anthropic")

    // Old package should be removed
    expect(await pkgExists("zod")).toBe(false)
    // New package should be installed
    expect(await pkgExists("superstruct")).toBe(true)
  })

  test("should remove old package even when new package is already cached", async () => {
    const { BunProc } = await import("../src/bun")

    // Install zod for provider-a
    await BunProc.install("zod", "latest", "provider-a")
    expect(await pkgExists("zod")).toBe(true)

    // Install superstruct for provider-b (now superstruct is cached)
    await BunProc.install("superstruct", "latest", "provider-b")
    expect(await pkgExists("superstruct")).toBe(true)

    // Switch provider-a from zod to superstruct (superstruct already cached)
    await BunProc.install("superstruct", "latest", "provider-a")

    // zod should be removed since provider-a no longer uses it
    expect(await pkgExists("zod")).toBe(false)

    // Tracking should be updated
    const pkgJson = await readPkgJson()
    expect(pkgJson.opencode?.providers?.["provider-a"]).toBe("superstruct")
    expect(pkgJson.opencode?.providers?.["provider-b"]).toBe("superstruct")
  })

  test("should not remove package if provider is not switching", async () => {
    const { BunProc } = await import("../src/bun")

    // Install zod for anthropic
    await BunProc.install("zod", "latest", "anthropic")

    // Install same package again (e.g., version check)
    await BunProc.install("zod", "latest", "anthropic")

    // Package should still exist
    expect(await pkgExists("zod")).toBe(true)
  })

  test("should work without providerID (backward compatible)", async () => {
    const { BunProc } = await import("../src/bun")

    await BunProc.install("zod", "latest")

    expect(await pkgExists("zod")).toBe(true)
    const pkgJson = await readPkgJson()
    // No provider tracking when providerID not provided
    expect(pkgJson.opencode?.providers).toBeUndefined()
  })

  test("should track multiple providers independently", async () => {
    const { BunProc } = await import("../src/bun")

    await BunProc.install("zod", "latest", "anthropic")
    await BunProc.install("superstruct", "latest", "openai")

    const pkgJson = await readPkgJson()
    expect(pkgJson.opencode?.providers?.anthropic).toBe("zod")
    expect(pkgJson.opencode?.providers?.openai).toBe("superstruct")

    expect(await pkgExists("zod")).toBe(true)
    expect(await pkgExists("superstruct")).toBe(true)
  })

  test("should not remove package if another provider still uses it", async () => {
    const { BunProc } = await import("../src/bun")

    // Both providers use zod
    await BunProc.install("zod", "latest", "anthropic")
    await BunProc.install("zod", "latest", "openai")

    // anthropic switches to superstruct
    await BunProc.install("superstruct", "latest", "anthropic")

    // zod should still exist because openai uses it
    expect(await pkgExists("zod")).toBe(true)
    expect(await pkgExists("superstruct")).toBe(true)

    const pkgJson = await readPkgJson()
    expect(pkgJson.opencode?.providers?.anthropic).toBe("superstruct")
    expect(pkgJson.opencode?.providers?.openai).toBe("zod")
  })

  test("should work when package.json exists without opencode section", async () => {
    const { BunProc } = await import("../src/bun")

    // Create package.json without opencode section
    await fs.writeFile(path.join(tempDir, "package.json"), JSON.stringify({ dependencies: {} }, null, 2))

    await BunProc.install("zod", "latest", "anthropic")

    const pkgJson = await readPkgJson()
    expect(pkgJson.opencode?.providers?.anthropic).toBe("zod")
    expect(await pkgExists("zod")).toBe(true)
  })

  test("should work when opencode section exists without providers", async () => {
    const { BunProc } = await import("../src/bun")

    // Create package.json with opencode but no providers
    await fs.writeFile(path.join(tempDir, "package.json"), JSON.stringify({ dependencies: {}, opencode: {} }, null, 2))

    await BunProc.install("zod", "latest", "anthropic")

    const pkgJson = await readPkgJson()
    expect(pkgJson.opencode?.providers?.anthropic).toBe("zod")
    expect(await pkgExists("zod")).toBe(true)
  })
})
