import { describe, expect, test } from "bun:test"
import path from "path"
import { tmpdir } from "./fixture/fixture"

const SEMVER_REGEX =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/

function isExactVersion(v: string) {
  return typeof v === "string" && SEMVER_REGEX.test(v)
}

describe("BunProc", () => {
  test("install function has correct bun add command structure", async () => {
    const content = await Bun.file(path.join(__dirname, "../src/bun/index.ts")).text()

    const match = content.match(/export async function install[\s\S]*?^  }/m)
    expect(match).toBeTruthy()

    const fn = match![0]
    expect(fn).toContain('"add"')
    expect(fn).toContain('"--force"')
    expect(fn).toContain('"--exact"')
    expect(fn).toContain('"--cwd"')
    expect(fn).not.toContain('"--registry"')
    expect(content).not.toContain("--registry=")
    expect(content).not.toContain("hasNpmRcConfig")
  })

  test("installs package, tracks provider, and returns module path", async () => {
    await using tmp = await tmpdir()
    process.env.OPENCODE_TEST_CACHE = tmp.path

    const { BunProc } = await import("../src/bun")
    const mod = await BunProc.install("zod", "latest", "anthropic")

    expect(mod).toContain("node_modules/zod")
    expect(await Bun.file(path.join(tmp.path, "node_modules", "zod", "package.json")).exists()).toBe(true)

    const pkgJson = await Bun.file(path.join(tmp.path, "package.json")).json()
    expect(pkgJson.opencode?.providers?.anthropic).toBe("zod")
    expect(isExactVersion(pkgJson.dependencies?.zod)).toBe(true)

    delete process.env.OPENCODE_TEST_CACHE
  })

  test("updates tracking and removes old package when provider switches", async () => {
    await using tmp = await tmpdir()
    process.env.OPENCODE_TEST_CACHE = tmp.path

    const { BunProc } = await import("../src/bun")

    await BunProc.install("zod", "latest", "anthropic")
    expect(await Bun.file(path.join(tmp.path, "node_modules", "zod", "package.json")).exists()).toBe(true)

    await BunProc.install("superstruct", "latest", "anthropic")

    expect(await Bun.file(path.join(tmp.path, "node_modules", "zod", "package.json")).exists()).toBe(false)
    expect(await Bun.file(path.join(tmp.path, "node_modules", "superstruct", "package.json")).exists()).toBe(true)

    const pkgJson = await Bun.file(path.join(tmp.path, "package.json")).json()
    expect(pkgJson.opencode?.providers?.anthropic).toBe("superstruct")
    expect(pkgJson.dependencies?.zod).toBeUndefined()
    expect(isExactVersion(pkgJson.dependencies?.superstruct)).toBe(true)

    delete process.env.OPENCODE_TEST_CACHE
  })

  test("removes old package even when new package is already cached", async () => {
    await using tmp = await tmpdir()
    process.env.OPENCODE_TEST_CACHE = tmp.path

    const { BunProc } = await import("../src/bun")

    await BunProc.install("zod", "latest", "provider-a")
    await BunProc.install("superstruct", "latest", "provider-b")
    await BunProc.install("superstruct", "latest", "provider-a")

    expect(await Bun.file(path.join(tmp.path, "node_modules", "zod", "package.json")).exists()).toBe(false)

    const pkgJson = await Bun.file(path.join(tmp.path, "package.json")).json()
    expect(pkgJson.opencode?.providers?.["provider-a"]).toBe("superstruct")
    expect(pkgJson.opencode?.providers?.["provider-b"]).toBe("superstruct")
    expect(pkgJson.dependencies?.zod).toBeUndefined()

    delete process.env.OPENCODE_TEST_CACHE
  })

  test("does not remove package if provider is not switching", async () => {
    await using tmp = await tmpdir()
    process.env.OPENCODE_TEST_CACHE = tmp.path

    const { BunProc } = await import("../src/bun")

    await BunProc.install("zod", "latest", "anthropic")
    await BunProc.install("zod", "latest", "anthropic")

    expect(await Bun.file(path.join(tmp.path, "node_modules", "zod", "package.json")).exists()).toBe(true)

    delete process.env.OPENCODE_TEST_CACHE
  })

  test("works without providerID (backward compatible)", async () => {
    await using tmp = await tmpdir()
    process.env.OPENCODE_TEST_CACHE = tmp.path

    const { BunProc } = await import("../src/bun")

    await BunProc.install("zod", "latest")

    expect(await Bun.file(path.join(tmp.path, "node_modules", "zod", "package.json")).exists()).toBe(true)
    const pkgJson = await Bun.file(path.join(tmp.path, "package.json")).json()
    expect(pkgJson.opencode?.providers).toBeUndefined()
    expect(isExactVersion(pkgJson.dependencies?.zod)).toBe(true)

    delete process.env.OPENCODE_TEST_CACHE
  })

  test("tracks multiple providers independently", async () => {
    await using tmp = await tmpdir()
    process.env.OPENCODE_TEST_CACHE = tmp.path

    const { BunProc } = await import("../src/bun")

    await BunProc.install("zod", "latest", "anthropic")
    await BunProc.install("superstruct", "latest", "openai")

    const pkgJson = await Bun.file(path.join(tmp.path, "package.json")).json()
    expect(pkgJson.opencode?.providers?.anthropic).toBe("zod")
    expect(pkgJson.opencode?.providers?.openai).toBe("superstruct")
    expect(await Bun.file(path.join(tmp.path, "node_modules", "zod", "package.json")).exists()).toBe(true)
    expect(await Bun.file(path.join(tmp.path, "node_modules", "superstruct", "package.json")).exists()).toBe(true)

    delete process.env.OPENCODE_TEST_CACHE
  })

  test("does not remove package if another provider still uses it", async () => {
    await using tmp = await tmpdir()
    process.env.OPENCODE_TEST_CACHE = tmp.path

    const { BunProc } = await import("../src/bun")

    await BunProc.install("zod", "latest", "anthropic")
    await BunProc.install("zod", "latest", "openai")
    await BunProc.install("superstruct", "latest", "anthropic")

    expect(await Bun.file(path.join(tmp.path, "node_modules", "zod", "package.json")).exists()).toBe(true)
    expect(await Bun.file(path.join(tmp.path, "node_modules", "superstruct", "package.json")).exists()).toBe(true)

    const pkgJson = await Bun.file(path.join(tmp.path, "package.json")).json()
    expect(pkgJson.opencode?.providers?.anthropic).toBe("superstruct")
    expect(pkgJson.opencode?.providers?.openai).toBe("zod")

    delete process.env.OPENCODE_TEST_CACHE
  })

  test("works with partial package.json structures", async () => {
    await using tmp = await tmpdir()
    process.env.OPENCODE_TEST_CACHE = tmp.path

    const { BunProc } = await import("../src/bun")

    // Test with missing opencode section
    await Bun.write(path.join(tmp.path, "package.json"), JSON.stringify({ dependencies: {} }, null, 2))
    await BunProc.install("zod", "latest", "anthropic")
    let pkgJson = await Bun.file(path.join(tmp.path, "package.json")).json()
    expect(pkgJson.opencode?.providers?.anthropic).toBe("zod")

    // Reset and test with opencode but missing providers
    const { rm } = await import("fs/promises")
    await rm(path.join(tmp.path, "node_modules"), { recursive: true, force: true })
    await Bun.write(path.join(tmp.path, "package.json"), JSON.stringify({ dependencies: {}, opencode: {} }, null, 2))
    await BunProc.install("superstruct", "latest", "openai")
    pkgJson = await Bun.file(path.join(tmp.path, "package.json")).json()
    expect(pkgJson.opencode?.providers?.openai).toBe("superstruct")

    delete process.env.OPENCODE_TEST_CACHE
  })

  test("installs exact version when specific version provided", async () => {
    await using tmp = await tmpdir()
    process.env.OPENCODE_TEST_CACHE = tmp.path

    const { BunProc } = await import("../src/bun")

    await BunProc.install("zod", "3.23.0", "anthropic")

    const pkgJson = await Bun.file(path.join(tmp.path, "package.json")).json()
    expect(pkgJson.dependencies?.zod).toBe("3.23.0")

    delete process.env.OPENCODE_TEST_CACHE
  })

  test("reinstalls when requested version differs from cached", async () => {
    await using tmp = await tmpdir()
    process.env.OPENCODE_TEST_CACHE = tmp.path

    const { BunProc } = await import("../src/bun")

    await BunProc.install("zod", "3.23.0", "anthropic")
    let pkgJson = await Bun.file(path.join(tmp.path, "package.json")).json()
    expect(pkgJson.dependencies?.zod).toBe("3.23.0")

    await BunProc.install("zod", "3.24.0", "anthropic")
    pkgJson = await Bun.file(path.join(tmp.path, "package.json")).json()
    expect(pkgJson.dependencies?.zod).toBe("3.24.0")

    delete process.env.OPENCODE_TEST_CACHE
  })

  test("skips install when cached version matches requested", async () => {
    await using tmp = await tmpdir()
    process.env.OPENCODE_TEST_CACHE = tmp.path

    const { BunProc } = await import("../src/bun")

    await BunProc.install("zod", "3.23.0", "anthropic")
    const pkgJson1 = await Bun.file(path.join(tmp.path, "package.json")).json()

    await new Promise((r) => setTimeout(r, 50))

    await BunProc.install("zod", "3.23.0", "anthropic")
    const pkgJson2 = await Bun.file(path.join(tmp.path, "package.json")).json()

    expect(pkgJson1.dependencies?.zod).toBe(pkgJson2.dependencies?.zod)
    expect(pkgJson2.dependencies?.zod).toBe("3.23.0")

    delete process.env.OPENCODE_TEST_CACHE
  })
})
