import { describe, expect, spyOn, test } from "bun:test"
import * as fs from "fs/promises"
import path from "path"
import { tmpdir } from "./fixture/fixture"
import { BunProc } from "../src/bun"
import { PackageRegistry } from "../src/bun/registry"
import { Global } from "../src/global"
import { Process } from "../src/util/process"

const SEMVER_REGEX =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/

describe("BunProc.install - command structure", () => {
  test("uses correct bun add flags", async () => {
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
  })

  test("throws on nonexistent package without corrupting state", async () => {
    await using tmp = await tmpdir()
    process.env.OPENCODE_TEST_CACHE = tmp.path
    const { BunProc } = await import("../src/bun")

    await Bun.write(path.join(tmp.path, "package.json"), JSON.stringify({ dependencies: { zod: "3.23.0" } }))

    await expect(
      BunProc.install("@nonexistent-pkg-xyz/does-not-exist", "1.0.0", { provider: "test" }),
    ).rejects.toThrow()

    const pkg = await Bun.file(path.join(tmp.path, "package.json")).json()
    expect(pkg.dependencies?.zod).toBe("3.23.0")
    expect(pkg.dependencies?.["@nonexistent-pkg-xyz/does-not-exist"]).toBeUndefined()
    expect(pkg.opencode?.providers?.test).toBeUndefined()

    delete process.env.OPENCODE_TEST_CACHE
  })
})

describe("BunProc.install - version=latest", () => {
  test("installs and tracks provider", async () => {
    await using tmp = await tmpdir()
    process.env.OPENCODE_TEST_CACHE = tmp.path
    const { BunProc } = await import("../src/bun")

    const mod = await BunProc.install("zod", "latest", { provider: "anthropic" })

    expect(mod).toContain(path.join("node_modules", "zod"))
    expect(await Bun.file(path.join(tmp.path, "node_modules", "zod", "package.json")).exists()).toBe(true)

    const pkg = await Bun.file(path.join(tmp.path, "package.json")).json()
    expect(pkg.opencode?.providers?.anthropic).toBe("zod")
    expect(SEMVER_REGEX.test(pkg.dependencies?.zod)).toBe(true)

    delete process.env.OPENCODE_TEST_CACHE
  })

  test("skips when not outdated and updates provider tracking", async () => {
    await using tmp = await tmpdir()
    process.env.OPENCODE_TEST_CACHE = tmp.path
    const { BunProc } = await import("../src/bun")

    await BunProc.install("zod", "latest", { provider: "anthropic" })

    const pkgAfterFirst = await Bun.file(path.join(tmp.path, "package.json")).json()
    const versionAfterFirst = pkgAfterFirst.dependencies?.zod

    await BunProc.install("zod", "latest", { provider: "anthropic" })
    await BunProc.install("zod", "latest", { provider: "openai" })

    expect(await Bun.file(path.join(tmp.path, "node_modules", "zod", "package.json")).exists()).toBe(true)

    const pkg = await Bun.file(path.join(tmp.path, "package.json")).json()
    expect(pkg.dependencies?.zod).toBe(versionAfterFirst)
    expect(pkg.opencode?.providers?.anthropic).toBe("zod")
    expect(pkg.opencode?.providers?.openai).toBe("zod")

    delete process.env.OPENCODE_TEST_CACHE
  })

  test("reinstalls when node_modules missing", async () => {
    await using tmp = await tmpdir()
    process.env.OPENCODE_TEST_CACHE = tmp.path
    const { BunProc } = await import("../src/bun")

    await BunProc.install("zod", "latest", { provider: "anthropic" })

    const pkgAfterFirst = await Bun.file(path.join(tmp.path, "package.json")).json()
    const versionAfterFirst = pkgAfterFirst.dependencies?.zod

    await fs.rm(path.join(tmp.path, "node_modules"), { recursive: true, force: true })

    await BunProc.install("zod", "latest", { provider: "anthropic" })

    expect(await Bun.file(path.join(tmp.path, "node_modules", "zod", "package.json")).exists()).toBe(true)

    const pkg = await Bun.file(path.join(tmp.path, "package.json")).json()
    expect(pkg.dependencies?.zod).toBe(versionAfterFirst)

    delete process.env.OPENCODE_TEST_CACHE
  })

  test("reinstalls when outdated", async () => {
    await using tmp = await tmpdir()
    process.env.OPENCODE_TEST_CACHE = tmp.path
    const { BunProc } = await import("../src/bun")

    await fs.mkdir(path.join(tmp.path, "node_modules", "zod"), { recursive: true })
    await Bun.write(path.join(tmp.path, "node_modules", "zod", "package.json"), JSON.stringify({ version: "3.20.0" }))
    await Bun.write(path.join(tmp.path, "package.json"), JSON.stringify({ dependencies: { zod: "3.20.0" } }))

    await BunProc.install("zod", "latest", { provider: "anthropic" })

    const pkg = await Bun.file(path.join(tmp.path, "package.json")).json()
    expect(SEMVER_REGEX.test(pkg.dependencies?.zod)).toBe(true)
    expect(pkg.dependencies?.zod).not.toBe("3.20.0")

    delete process.env.OPENCODE_TEST_CACHE
  })

  test("installs when stale node_modules (no cached)", async () => {
    await using tmp = await tmpdir()
    process.env.OPENCODE_TEST_CACHE = tmp.path
    const { BunProc } = await import("../src/bun")

    await fs.mkdir(path.join(tmp.path, "node_modules", "zod"), { recursive: true })
    await Bun.write(path.join(tmp.path, "node_modules", "zod", "package.json"), JSON.stringify({ version: "3.22.0" }))
    await Bun.write(path.join(tmp.path, "package.json"), JSON.stringify({}))

    await BunProc.install("zod", "latest", { provider: "anthropic" })

    expect(await Bun.file(path.join(tmp.path, "node_modules", "zod", "package.json")).exists()).toBe(true)

    const pkg = await Bun.file(path.join(tmp.path, "package.json")).json()
    expect(SEMVER_REGEX.test(pkg.dependencies?.zod)).toBe(true)
    expect(pkg.opencode?.providers?.anthropic).toBe("zod")

    delete process.env.OPENCODE_TEST_CACHE
  })
})

describe("BunProc.install - version=exact", () => {
  test("installs specific version", async () => {
    await using tmp = await tmpdir()
    process.env.OPENCODE_TEST_CACHE = tmp.path
    const { BunProc } = await import("../src/bun")

    await BunProc.install("zod", "3.23.0", { provider: "anthropic" })

    expect(await Bun.file(path.join(tmp.path, "node_modules", "zod", "package.json")).exists()).toBe(true)

    const pkg = await Bun.file(path.join(tmp.path, "package.json")).json()
    expect(pkg.dependencies?.zod).toBe("3.23.0")
    expect(pkg.opencode?.providers?.anthropic).toBe("zod")

    delete process.env.OPENCODE_TEST_CACHE
  })

  test("skips when cached matches and updates provider tracking", async () => {
    await using tmp = await tmpdir()
    process.env.OPENCODE_TEST_CACHE = tmp.path
    const { BunProc } = await import("../src/bun")

    await BunProc.install("zod", "3.23.0", { provider: "anthropic" })
    await BunProc.install("zod", "3.23.0", { provider: "anthropic" })
    await BunProc.install("zod", "3.23.0", { provider: "openai" })

    expect(await Bun.file(path.join(tmp.path, "node_modules", "zod", "package.json")).exists()).toBe(true)

    const pkg = await Bun.file(path.join(tmp.path, "package.json")).json()
    expect(pkg.dependencies?.zod).toBe("3.23.0")
    expect(pkg.opencode?.providers?.anthropic).toBe("zod")
    expect(pkg.opencode?.providers?.openai).toBe("zod")

    delete process.env.OPENCODE_TEST_CACHE
  })

  test("reinstalls when version differs", async () => {
    await using tmp = await tmpdir()
    process.env.OPENCODE_TEST_CACHE = tmp.path
    const { BunProc } = await import("../src/bun")

    await BunProc.install("zod", "3.23.0", { provider: "anthropic" })
    await BunProc.install("zod", "3.24.0", { provider: "anthropic" })

    expect(await Bun.file(path.join(tmp.path, "node_modules", "zod", "package.json")).exists()).toBe(true)

    const pkg = await Bun.file(path.join(tmp.path, "package.json")).json()
    expect(pkg.dependencies?.zod).toBe("3.24.0")
    expect(pkg.opencode?.providers?.anthropic).toBe("zod")

    delete process.env.OPENCODE_TEST_CACHE
  })

  test("reinstalls when node_modules missing", async () => {
    await using tmp = await tmpdir()
    process.env.OPENCODE_TEST_CACHE = tmp.path
    const { BunProc } = await import("../src/bun")

    await BunProc.install("zod", "3.23.0", { provider: "anthropic" })
    await fs.rm(path.join(tmp.path, "node_modules"), { recursive: true, force: true })

    await BunProc.install("zod", "3.23.0", { provider: "anthropic" })

    expect(await Bun.file(path.join(tmp.path, "node_modules", "zod", "package.json")).exists()).toBe(true)

    delete process.env.OPENCODE_TEST_CACHE
  })

  test("installs when stale node_modules exists", async () => {
    await using tmp = await tmpdir()
    process.env.OPENCODE_TEST_CACHE = tmp.path
    const { BunProc } = await import("../src/bun")

    await fs.mkdir(path.join(tmp.path, "node_modules", "zod"), { recursive: true })
    await Bun.write(path.join(tmp.path, "node_modules", "zod", "package.json"), JSON.stringify({ version: "3.22.0" }))
    await Bun.write(path.join(tmp.path, "package.json"), JSON.stringify({}))

    await BunProc.install("zod", "3.23.0", { provider: "anthropic" })

    expect(await Bun.file(path.join(tmp.path, "node_modules", "zod", "package.json")).exists()).toBe(true)

    const pkg = await Bun.file(path.join(tmp.path, "package.json")).json()
    expect(pkg.dependencies?.zod).toBe("3.23.0")
    expect(pkg.opencode?.providers?.anthropic).toBe("zod")

    delete process.env.OPENCODE_TEST_CACHE
  })

  test("reinstalls when cached differs and node_modules missing", async () => {
    await using tmp = await tmpdir()
    process.env.OPENCODE_TEST_CACHE = tmp.path
    const { BunProc } = await import("../src/bun")

    await Bun.write(path.join(tmp.path, "package.json"), JSON.stringify({ dependencies: { zod: "3.22.0" } }))

    await BunProc.install("zod", "3.23.0", { provider: "anthropic" })

    expect(await Bun.file(path.join(tmp.path, "node_modules", "zod", "package.json")).exists()).toBe(true)
    const pkg = await Bun.file(path.join(tmp.path, "package.json")).json()
    expect(pkg.dependencies?.zod).toBe("3.23.0")

    delete process.env.OPENCODE_TEST_CACHE
  })
})

describe("BunProc.install - provider tracking", () => {
  test("works without provider (backward compat)", async () => {
    await using tmp = await tmpdir()
    process.env.OPENCODE_TEST_CACHE = tmp.path
    const { BunProc } = await import("../src/bun")

    await BunProc.install("zod", "latest")

    const pkg = await Bun.file(path.join(tmp.path, "package.json")).json()
    expect(pkg.opencode?.providers).toBeUndefined()
    expect(SEMVER_REGEX.test(pkg.dependencies?.zod)).toBe(true)

    delete process.env.OPENCODE_TEST_CACHE
  })

  test("tracks multiple providers independently", async () => {
    await using tmp = await tmpdir()
    process.env.OPENCODE_TEST_CACHE = tmp.path
    const { BunProc } = await import("../src/bun")

    await BunProc.install("zod", "latest", { provider: "anthropic" })
    await BunProc.install("superstruct", "latest", { provider: "openai" })

    const pkg = await Bun.file(path.join(tmp.path, "package.json")).json()
    expect(pkg.opencode?.providers?.anthropic).toBe("zod")
    expect(pkg.opencode?.providers?.openai).toBe("superstruct")

    delete process.env.OPENCODE_TEST_CACHE
  })

  test("handles partial package.json", async () => {
    await using tmp = await tmpdir()
    process.env.OPENCODE_TEST_CACHE = tmp.path
    const { BunProc } = await import("../src/bun")

    await Bun.write(path.join(tmp.path, "package.json"), JSON.stringify({ dependencies: {} }))
    await BunProc.install("zod", "latest", { provider: "anthropic" })

    let pkg = await Bun.file(path.join(tmp.path, "package.json")).json()
    expect(pkg.opencode?.providers?.anthropic).toBe("zod")

    await fs.rm(path.join(tmp.path, "node_modules"), { recursive: true, force: true })
    await Bun.write(path.join(tmp.path, "package.json"), JSON.stringify({ opencode: {} }))
    await BunProc.install("superstruct", "latest", { provider: "openai" })

    pkg = await Bun.file(path.join(tmp.path, "package.json")).json()
    expect(pkg.opencode?.providers?.openai).toBe("superstruct")

    delete process.env.OPENCODE_TEST_CACHE
  })
})

describe("BunProc.install - cleanup (reference counting)", () => {
  test("removes old package on switch", async () => {
    await using tmp = await tmpdir()
    process.env.OPENCODE_TEST_CACHE = tmp.path
    const { BunProc } = await import("../src/bun")

    await BunProc.install("zod", "latest", { provider: "anthropic" })
    await BunProc.install("superstruct", "latest", { provider: "anthropic" })

    expect(await Bun.file(path.join(tmp.path, "node_modules", "zod", "package.json")).exists()).toBe(false)
    expect(await Bun.file(path.join(tmp.path, "node_modules", "superstruct", "package.json")).exists()).toBe(true)

    const pkg = await Bun.file(path.join(tmp.path, "package.json")).json()
    expect(pkg.opencode?.providers?.anthropic).toBe("superstruct")
    expect(pkg.dependencies?.zod).toBeUndefined()

    delete process.env.OPENCODE_TEST_CACHE
  })

  test("removes old package when new already cached", async () => {
    await using tmp = await tmpdir()
    process.env.OPENCODE_TEST_CACHE = tmp.path
    const { BunProc } = await import("../src/bun")

    await BunProc.install("zod", "latest", { provider: "provider-a" })
    await BunProc.install("superstruct", "latest", { provider: "provider-b" })
    await BunProc.install("superstruct", "latest", { provider: "provider-a" })

    expect(await Bun.file(path.join(tmp.path, "node_modules", "zod", "package.json")).exists()).toBe(false)

    const pkg = await Bun.file(path.join(tmp.path, "package.json")).json()
    expect(pkg.opencode?.providers?.["provider-a"]).toBe("superstruct")
    expect(pkg.opencode?.providers?.["provider-b"]).toBe("superstruct")

    delete process.env.OPENCODE_TEST_CACHE
  })

  test("keeps package if another provider uses it", async () => {
    await using tmp = await tmpdir()
    process.env.OPENCODE_TEST_CACHE = tmp.path
    const { BunProc } = await import("../src/bun")

    await BunProc.install("zod", "latest", { provider: "anthropic" })
    await BunProc.install("zod", "latest", { provider: "openai" })
    await BunProc.install("superstruct", "latest", { provider: "anthropic" })

    expect(await Bun.file(path.join(tmp.path, "node_modules", "zod", "package.json")).exists()).toBe(true)

    const pkg = await Bun.file(path.join(tmp.path, "package.json")).json()
    expect(pkg.opencode?.providers?.anthropic).toBe("superstruct")
    expect(pkg.opencode?.providers?.openai).toBe("zod")

    delete process.env.OPENCODE_TEST_CACHE
  })
})

describe("PackageRegistry.isOutdated", () => {
  test("returns true when cachedVersion undefined", async () => {
    const { PackageRegistry } = await import("../src/bun/registry")

    const result = await PackageRegistry.isOutdated("zod", undefined)
    expect(result).toBe(true)
  })

  test("returns false when registry unavailable", async () => {
    const { PackageRegistry } = await import("../src/bun/registry")

    const result = await PackageRegistry.isOutdated("@nonexistent-pkg-xyz/does-not-exist", "1.0.0")
    expect(result).toBe(false)
  })

  test("returns true when cached is older", async () => {
    const { PackageRegistry } = await import("../src/bun/registry")

    const result = await PackageRegistry.isOutdated("zod", "3.20.0")
    expect(result).toBe(true)
  })

  test("returns false when cached matches latest", async () => {
    const { PackageRegistry } = await import("../src/bun/registry")

    const latest = await PackageRegistry.info("zod", "version")
    expect(latest).toBeTruthy()

    const result = await PackageRegistry.isOutdated("zod", latest!)
    expect(result).toBe(false)
  })

  test("returns false when range satisfied by latest", async () => {
    const { PackageRegistry } = await import("../src/bun/registry")

    const result = await PackageRegistry.isOutdated("zod", ">=3.0.0")
    expect(result).toBe(false)
  })

  test("returns true when range not satisfied by latest", async () => {
    const { PackageRegistry } = await import("../src/bun/registry")

    const result = await PackageRegistry.isOutdated("zod", "^0.0.1")
    expect(result).toBe(true)
  })
})

describe("BunProc install pinning", () => {
  test("uses pinned cache without touching registry", async () => {
    const pkg = `pin-test-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    const ver = "1.2.3"
    const mod = path.join(Global.Path.cache, "node_modules", pkg)
    const data = path.join(Global.Path.cache, "package.json")

    await fs.mkdir(mod, { recursive: true })
    await Bun.write(path.join(mod, "package.json"), JSON.stringify({ name: pkg, version: ver }, null, 2))

    const src = await fs.readFile(data, "utf8").catch(() => "")
    const json = src ? ((JSON.parse(src) as { dependencies?: Record<string, string> }) ?? {}) : {}
    const deps = json.dependencies ?? {}
    deps[pkg] = ver
    await Bun.write(data, JSON.stringify({ ...json, dependencies: deps }, null, 2))

    const stale = spyOn(PackageRegistry, "isOutdated").mockImplementation(async () => {
      throw new Error("unexpected registry check")
    })
    const run = spyOn(Process, "run").mockImplementation(async () => {
      throw new Error("unexpected process.run")
    })

    try {
      const out = await BunProc.install(pkg, ver)
      expect(out).toBe(mod)
      expect(stale).not.toHaveBeenCalled()
      expect(run).not.toHaveBeenCalled()
    } finally {
      stale.mockRestore()
      run.mockRestore()

      await fs.rm(mod, { recursive: true, force: true })
      const end = await fs
        .readFile(data, "utf8")
        .then((item) => JSON.parse(item) as { dependencies?: Record<string, string> })
        .catch(() => undefined)
      if (end?.dependencies) {
        delete end.dependencies[pkg]
        await Bun.write(data, JSON.stringify(end, null, 2))
      }
    }
  })

  test("passes --ignore-scripts when requested", async () => {
    const pkg = `ignore-test-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    const ver = "4.5.6"
    const mod = path.join(Global.Path.cache, "node_modules", pkg)
    const data = path.join(Global.Path.cache, "package.json")

    const run = spyOn(Process, "run").mockImplementation(async () => ({
      code: 0,
      stdout: Buffer.alloc(0),
      stderr: Buffer.alloc(0),
    }))

    try {
      await fs.rm(mod, { recursive: true, force: true })
      await BunProc.install(pkg, ver, { ignoreScripts: true })

      expect(run).toHaveBeenCalled()
      const call = run.mock.calls[0]?.[0]
      expect(call).toContain("--ignore-scripts")
      expect(call).toContain(`${pkg}@${ver}`)
    } finally {
      run.mockRestore()
      await fs.rm(mod, { recursive: true, force: true })

      const end = await fs
        .readFile(data, "utf8")
        .then((item) => JSON.parse(item) as { dependencies?: Record<string, string> })
        .catch(() => undefined)
      if (end?.dependencies) {
        delete end.dependencies[pkg]
        await Bun.write(data, JSON.stringify(end, null, 2))
      }
    }
  })
})
